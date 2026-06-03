"""APScheduler — in-process scheduler that recomputes intel periodically.

Runs five tiers with **staggered first runs** so they don't all fire on boot:

  +0:30s   job_external    — external signals (weather + holidays), then every 6h
  +2 min   job_anomalies   — anomaly detection, then every 5 min
  +5 min   job_hourly      — retailer health + delivery risk + recs + feed, then every 60 min
  +10 min  job_forecasts   — stock-exhaustion forecast, then every 15 min
  06:00 UTC daily          — executive summary + 30-day retention cleanup

`run_initial_pass()` is **not** invoked at startup — the staggered scheduler
covers the cold-start case. It remains available for `POST /api/intel/recompute`.

Tenant fan-out: each tier iterates over all manufacturer_ids so when new
tenants onboard, they're picked up automatically.

Production safety:
  * INTEL_SCHEDULER_ENABLED env var (default "true") — emergency kill switch
    if the intel layer is OOM'ing the pod, set to "false".
  * INTEL_INITIAL_PASS_DELAY_SEC (default 90) — delay applied inside
    run_initial_pass() when invoked manually (e.g. /api/intel/recompute).
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from core import db, logger
from services.intel.anomalies import detect_anomalies
from services.intel.delivery_risk import compute_delivery_risk
from services.intel.external_signals import refresh_external_signals
from services.intel.forecasts import compute_stock_exhaustion
from services.intel.narrator import generate_exec_summary, generate_feed
from services.intel.recommendations import generate_recommendations
from services.intel.retailer_health import score_retailers

scheduler = AsyncIOScheduler(timezone="UTC")


def _intel_enabled() -> bool:
    return os.environ.get("INTEL_SCHEDULER_ENABLED", "true").lower() not in {"false", "0", "no"}


def _initial_pass_delay() -> int:
    try:
        return max(0, int(os.environ.get("INTEL_INITIAL_PASS_DELAY_SEC", "90")))
    except ValueError:
        return 90


async def _tenants() -> list[str]:
    return [m["id"] async for m in db.manufacturers.find({}, {"_id": 0, "id": 1})]


async def job_anomalies():
    for tid in await _tenants():
        try:
            await detect_anomalies(tid)
        except Exception:
            logger.exception("anomaly job failed for %s", tid)


async def job_forecasts():
    for tid in await _tenants():
        try:
            await compute_stock_exhaustion(tid)
        except Exception:
            logger.exception("forecast job failed for %s", tid)


async def job_hourly():
    for tid in await _tenants():
        try:
            await score_retailers(tid)
            await compute_delivery_risk(tid)
            await generate_recommendations(tid)
            # Pre-warm only the manufacturer narration. Distributor / retailer
            # narrations are lazy-generated on first read (cheap LLM call,
            # 30-min cache). With many distributors this prevents a huge
            # scheduler-driven LLM fan-out.
            await generate_feed(tid, role="manufacturer", entity_id=tid, ttl_seconds=300)
        except Exception:
            logger.exception("hourly job failed for %s", tid)


async def job_external():
    for tid in await _tenants():
        try:
            await refresh_external_signals(tid)
        except Exception:
            logger.exception("external signals job failed for %s", tid)


async def job_daily():
    """Daily exec summary + 30-day retention cleanup."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    for coll in ("intel_insights", "intel_alerts", "intel_recommendations"):
        try:
            await db[coll].delete_many({"created_at": {"$lt": cutoff}})
        except Exception:
            logger.exception("retention cleanup failed on %s", coll)
    for tid in await _tenants():
        try:
            await generate_exec_summary(tid, role="manufacturer", entity_id=tid, ttl_seconds=60)
        except Exception:
            logger.exception("exec summary failed for %s", tid)


def start_scheduler():
    if scheduler.running:
        return
    if not _intel_enabled():
        logger.warning("Intel scheduler disabled via INTEL_SCHEDULER_ENABLED=false")
        return

    # Staggered first-run times — heavy jobs start later so the pod's startup
    # CPU/memory budget isn't blown by everything firing at once. Subsequent
    # runs follow the regular interval cadence.
    now = datetime.now(timezone.utc)

    # Lightweight job — fires first, ~30s after boot
    scheduler.add_job(
        job_external, IntervalTrigger(hours=6), id="intel_external",
        max_instances=1, coalesce=True,
        next_run_time=now + timedelta(seconds=30),
    )
    # Anomalies (medium weight) — every 5 min, first run T+2 min
    scheduler.add_job(
        job_anomalies, IntervalTrigger(minutes=5), id="intel_anomalies",
        max_instances=1, coalesce=True,
        next_run_time=now + timedelta(minutes=2),
    )
    # Hourly bundle (heaviest LLM work) — every 60 min, first run T+5 min
    scheduler.add_job(
        job_hourly, IntervalTrigger(minutes=60), id="intel_hourly",
        max_instances=1, coalesce=True,
        next_run_time=now + timedelta(minutes=5),
    )
    # Forecasts (heaviest DB scan) — every 15 min, first run T+10 min
    scheduler.add_job(
        job_forecasts, IntervalTrigger(minutes=15), id="intel_forecasts",
        max_instances=1, coalesce=True,
        next_run_time=now + timedelta(minutes=10),
    )
    # Daily exec summary + retention cleanup — fixed 06:00 UTC
    scheduler.add_job(
        job_daily, CronTrigger(hour=6, minute=0), id="intel_daily",
        max_instances=1, coalesce=True,
    )

    scheduler.start()
    logger.info(
        "Intel scheduler started. First runs: external=+30s, anomalies=+2m, "
        "hourly=+5m, forecasts=+10m, daily=06:00 UTC"
    )


def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Intel scheduler stopped.")


async def run_initial_pass():
    """Force a first computation on startup so the dashboard isn't empty.

    Defers actual work by INTEL_INITIAL_PASS_DELAY_SEC (default 90s) so the
    pod can pass its readiness probe and start serving real traffic BEFORE
    the heavy intel computation hits the event loop. Without this delay,
    cold-start CPU/memory spikes on large tenants (3k+ retailers) can
    trigger a Kubernetes OOM kill -> crash loop.
    """
    if not _intel_enabled():
        return
    delay = _initial_pass_delay()
    if delay > 0:
        logger.info("Deferring intel initial pass by %ss", delay)
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            return

    for tid in await _tenants():
        try:
            await refresh_external_signals(tid)
        except Exception:
            logger.exception("initial external signals failed for %s", tid)
        # Yield between heavy steps so liveness/healthcheck probes keep working
        await asyncio.sleep(0)
        try:
            await compute_stock_exhaustion(tid)
        except Exception:
            logger.exception("initial forecasts failed for %s", tid)
        await asyncio.sleep(0)
        try:
            await detect_anomalies(tid)
        except Exception:
            logger.exception("initial anomalies failed for %s", tid)
        await asyncio.sleep(0)
        try:
            await score_retailers(tid)
        except Exception:
            logger.exception("initial retailer health failed for %s", tid)
        await asyncio.sleep(0)
        try:
            await compute_delivery_risk(tid)
        except Exception:
            logger.exception("initial delivery risk failed for %s", tid)
        await asyncio.sleep(0)
        try:
            await generate_recommendations(tid)
        except Exception:
            logger.exception("initial recommendations failed for %s", tid)
        await asyncio.sleep(0)
        try:
            # Pre-generate the manufacturer narration only; distributor/retailer
            # views are lazy-generated on first hit of /intel/feed.
            await generate_feed(tid, role="manufacturer", entity_id=tid, ttl_seconds=300)
        except Exception:
            logger.exception("initial feed narration failed for %s", tid)
        await asyncio.sleep(0)
        try:
            await generate_exec_summary(tid, role="manufacturer", entity_id=tid, ttl_seconds=1800)
        except Exception:
            logger.exception("initial exec summary failed for %s", tid)
