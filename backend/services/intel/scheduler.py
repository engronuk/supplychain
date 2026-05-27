"""APScheduler — in-process scheduler that recomputes intel periodically.

Runs four tiers:
  * every 5 min: anomaly detection
  * every 15 min: stock-exhaustion forecast
  * every 60 min: retailer health + delivery risk + recommendations + ecosystem feed
  * every 6 hours: external signals (weather + holidays)
  * daily at 06:00 UTC: executive summary + 30-day retention cleanup

Tenant fan-out: each tier iterates over all manufacturer_ids so when new
tenants onboard, they're picked up automatically.
"""
from __future__ import annotations

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
    scheduler.add_job(job_anomalies, IntervalTrigger(minutes=5), id="intel_anomalies",
                      max_instances=1, coalesce=True)
    scheduler.add_job(job_forecasts, IntervalTrigger(minutes=15), id="intel_forecasts",
                      max_instances=1, coalesce=True)
    scheduler.add_job(job_hourly, IntervalTrigger(minutes=60), id="intel_hourly",
                      max_instances=1, coalesce=True)
    scheduler.add_job(job_external, IntervalTrigger(hours=6), id="intel_external",
                      max_instances=1, coalesce=True, next_run_time=datetime.now(timezone.utc) + timedelta(seconds=10))
    scheduler.add_job(job_daily, CronTrigger(hour=6, minute=0), id="intel_daily",
                      max_instances=1, coalesce=True)
    scheduler.start()
    logger.info("Intel scheduler started.")


def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Intel scheduler stopped.")


async def run_initial_pass():
    """Force a first computation on startup so the dashboard isn't empty."""
    for tid in await _tenants():
        try:
            await refresh_external_signals(tid)
            await compute_stock_exhaustion(tid)
            await detect_anomalies(tid)
            await score_retailers(tid)
            await compute_delivery_risk(tid)
            await generate_recommendations(tid)
            # Pre-generate the manufacturer narration only; distributor/retailer
            # views are lazy-generated on first hit of /intel/feed.
            await generate_feed(tid, role="manufacturer", entity_id=tid, ttl_seconds=300)
            await generate_exec_summary(tid, role="manufacturer", entity_id=tid, ttl_seconds=1800)
        except Exception:
            logger.exception("initial intel pass failed for %s", tid)
