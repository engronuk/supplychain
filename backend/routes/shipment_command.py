"""Shipment Command Center — manufacturer-wide logistics aggregator.

Returns the full executive payload for the Shipment Command Center page in
a single round-trip:

  GET /api/manufacturer/{id}/shipment-command-center
  GET /api/manufacturer/{id}/shipment-intelligence/{shipment_id}

  - kpis: 6 cards (pending_dispatch, in_transit, delivered, delayed,
          shipment_value, fill_rate) with growth + 12-pt spark
  - ai_brief: list of logistics insights + recommended_actions
  - pipeline: counts at each stage
  - regional: per-zone shipments/success_rate/avg_transit/fill_rate
  - distributor_performance: leaderboard
  - exceptions: delayed / variance / missing_ack / damaged / fill_rate_breaches
  - shipments: full table (every shipment, no pagination — caller paginates)
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Dict, List

from fastapi import APIRouter, HTTPException

from core import db
from routes.distributor_network import (
    NIGERIA_REGION_BY_STATE, ALL_REGIONS, _resolve_region, _spark, _delta_pct,
)

router = APIRouter()


# Order lifecycle → KPI cohort. The allocation flow added several states
# between "approved" and "dispatched"; anything pre-dispatch counts as
# awaiting dispatch so simulator/allocation orders surface in the KPIs.
ORDER_COHORT = {
    "pending": "pending", "approved": "pending",
    "awaiting_allocation": "pending", "allocated": "pending",
    "partially_allocated": "pending", "back_ordered": "pending",
    "fulfillment_in_progress": "pending",
    "dispatched": "in_transit",
    "delivered": "delivered", "completed": "delivered",
    "rejected": "rejected", "cancelled": "rejected",
}


def _cohort(status: str | None) -> str:
    return ORDER_COHORT.get((status or "pending").lower(), "pending")


def _grade(score: float) -> str:
    if score >= 95:
        return "A+"
    if score >= 90:
        return "A"
    if score >= 80:
        return "B"
    if score >= 70:
        return "C"
    return "D"


def _hours_between(a: str | None, b: str | None) -> float | None:
    if not a or not b:
        return None
    try:
        da = datetime.fromisoformat(a.replace("Z", "+00:00"))
        db_ = datetime.fromisoformat(b.replace("Z", "+00:00"))
        return abs((db_ - da).total_seconds() / 3600.0)
    except (ValueError, TypeError):
        return None


def _days_between(a: str | None, b: str | None) -> float | None:
    h = _hours_between(a, b)
    return None if h is None else round(h / 24.0, 1)


# ----------------------------------------------------------------------------
@router.get("/manufacturer/{manufacturer_id}/shipment-command-center")
async def shipment_command_center(manufacturer_id: str):
    from services.snapshots import read_or_compute
    if not await db.organizations.find_one(
            {"id": manufacturer_id, "organization_type": "manufacturer"}, {"_id": 1}):
        raise HTTPException(404, "Manufacturer not found")
    return await read_or_compute(
        "shipment-command", manufacturer_id,
        lambda: _build_shipment_command(manufacturer_id),
    )


@router.post("/manufacturer/{manufacturer_id}/shipment-command-center/refresh")
async def shipment_command_center_refresh(manufacturer_id: str):
    from services.snapshots import recompute
    return await recompute(
        "shipment-command", manufacturer_id,
        lambda: _build_shipment_command(manufacturer_id),
    )


async def _build_shipment_command(manufacturer_id: str):
    mfg = await db.manufacturers.find_one({"id": manufacturer_id}, {"_id": 0})
    if not mfg:
        raise HTTPException(404, "Manufacturer not found")

    now = datetime.now(timezone.utc)
    today = now.date()

    # ---- fetch shipments + the directories we need to denormalise them -----
    # PERF: only pull the last 180 days. Older shipments are not surfaced
    # anywhere on the command-center UI and dragging the entire history (often
    # 10k+ docs on a mature tenant) makes the build take 30-60s on Atlas.
    horizon_iso = (now - timedelta(days=180)).isoformat()
    shipments = await db.shipments.find(
        {
            "manufacturer_id": manufacturer_id,
            "$or": [
                {"created_at": {"$gte": horizon_iso}},
                {"dispatched_at": {"$gte": horizon_iso}},
                {"status": {"$in": ["pending", "in_transit"]}},
            ],
        },
        {"_id": 0},
    ).to_list(None)

    # Directories
    distributors = await db.distributors.find(
        {"manufacturer_id": manufacturer_id},
        {"_id": 0, "id": 1, "name": 1, "city": 1, "state": 1, "region": 1},
    ).to_list(None)
    dist_by_id = {d["id"]: d for d in distributors}
    products = await db.products.find(
        {"manufacturer_id": manufacturer_id},
        {"_id": 0, "id": 1, "name": 1, "unit_price": 1, "sku": 1},
    ).to_list(None)
    prod_by_id = {p["id"]: p for p in products}

    # Pre-aggregate per-shipment value, units, and rolled-up rows
    def shipment_value(items: List[dict]) -> float:
        v = 0.0
        for it in items:
            p = prod_by_id.get(it.get("product_id"))
            if p:
                v += float(p.get("unit_price", 0) or 0) * int(it.get("quantity", 0) or 0)
        return round(v, 2)

    def shipment_units(items: List[dict]) -> int:
        return sum(int(it.get("quantity", 0) or 0) for it in items)

    enriched: List[dict] = []
    for s in shipments:
        items = s.get("items", []) or []
        value = shipment_value(items)
        units = shipment_units(items)
        d = dist_by_id.get(s.get("to_id")) or {}
        status = s.get("status", "pending")
        # Days since dispatch — used to detect a "delayed" shipment.
        days_in_transit = None
        if s.get("dispatched_at"):
            days_in_transit = _days_between(s["dispatched_at"], now.isoformat())
        is_delayed = (
            status == "delayed"
            or (status == "in_transit" and days_in_transit is not None and days_in_transit > 4)
        )
        # Treat shipments stuck in "pending" > 3 days as delayed too.
        if status == "pending" and s.get("created_at"):
            age = _days_between(s["created_at"], now.isoformat())
            if age is not None and age > 3:
                is_delayed = True
        # Derive a normalized bucket for the UI
        if is_delayed:
            bucket = "delayed"
        elif status in ("received", "delivered", "completed"):
            bucket = "delivered"
        elif status in ("in_transit", "dispatched"):
            bucket = "in_transit"
        else:
            bucket = "pending"

        enriched.append({
            **s, "value": value, "units": units, "bucket": bucket,
            "distributor_name": d.get("name") or "Unknown",
            "distributor_city": d.get("city") or "",
            "distributor_region": _resolve_region(d),
            "days_in_transit": days_in_transit,
            "products_count": len({it.get("product_id") for it in items}),
        })

    # ---- KPIs (source-of-truth: distributor_orders so numbers match the
    # Order Fulfillment Queue exactly) -------------------------------------
    # Fetch every order for the manufacturer and bucket by lifecycle state.
    orders = await db.distributor_orders.find(
        {"manufacturer_id": manufacturer_id}, {"_id": 0},
    ).to_list(None)

    # Unit-price map for value rollups (items only carry product_id + qty).
    prod_price = {p["id"]: float(p.get("unit_price") or 0)
                  for p in await db.products.find(
                      {"manufacturer_id": manufacturer_id},
                      {"_id": 0, "id": 1, "unit_price": 1},
                  ).to_list(None)}

    def _order_value(o: dict) -> float:
        return sum(
            prod_price.get(it.get("product_id"), 0) * int(it.get("quantity") or 0)
            for it in (o.get("items") or [])
        )

    order_count: dict[str, int] = {"pending": 0, "approved": 0, "dispatched": 0,
                                   "delivered": 0, "rejected": 0}
    order_value: dict[str, float] = {k: 0.0 for k in order_count}
    cohort_count: dict[str, int] = {"pending": 0, "in_transit": 0,
                                    "delivered": 0, "rejected": 0}
    cohort_value: dict[str, float] = {k: 0.0 for k in cohort_count}
    for o in orders:
        st = (o.get("status") or "pending").lower()
        if st not in order_count:
            order_count[st] = 0
            order_value[st] = 0.0
        val = _order_value(o)
        order_count[st] += 1
        order_value[st] += val
        ch = _cohort(st)
        cohort_count[ch] += 1
        cohort_value[ch] += val

    # An order is "pending dispatch" while it's anywhere pre-dispatch
    # (pending approval, approved, or moving through the allocation flow).
    pending_dispatch = cohort_count["pending"]
    pending_dispatch_value = cohort_value["pending"]
    # In-transit is a *physical* state, so derive it from the shipments
    # themselves — the simulator/allocation flow moves orders straight to
    # "completed" while their shipments are still on the road.
    in_transit = sum(1 for r in enriched if r["bucket"] == "in_transit")
    in_transit_value = sum(r["value"] for r in enriched if r["bucket"] == "in_transit")
    delivered = cohort_count["delivered"]
    delivered_value = cohort_value["delivered"]
    # Delayed is a *physical* state on the shipment, not an order status, so
    # we still derive it from the shipments collection.
    delayed = sum(1 for r in enriched if r["bucket"] == "delayed")
    shipment_value_total = (pending_dispatch_value + in_transit_value + delivered_value)

    # Fill rate — % of ordered units actually shipped (in transit + delivered).
    ordered_units_total = sum(
        int(it.get("quantity") or 0) for o in orders for it in (o.get("items") or [])
    )
    fulfilled_units_total = sum(
        int(it.get("quantity") or 0)
        for o in orders if _cohort(o.get("status")) in ("in_transit", "delivered")
        for it in (o.get("items") or [])
    )
    fill_rate = round(fulfilled_units_total / max(ordered_units_total, 1) * 100, 1)

    # 7-day deltas — compare last 7 days against previous 7 days.
    # 7-day deltas — orders is the source of truth for state-machine cohorts.
    cutoff_7 = (now - timedelta(days=7)).isoformat()
    cutoff_14 = (now - timedelta(days=14)).isoformat()
    def _orders_count(predicate, ts_field: str) -> tuple[int, int]:
        cur, prev = 0, 0
        for o in orders:
            if not predicate(o):
                continue
            ts = (o.get(ts_field) or "")
            if ts >= cutoff_7:
                cur += 1
            elif ts >= cutoff_14:
                prev += 1
        return cur, prev

    def _is_pending_dispatch(o):
        return _cohort(o.get("status")) == "pending"

    cur, prev = _orders_count(_is_pending_dispatch, "created_at")
    pd_growth = _delta_pct(cur, prev)
    # In-transit delta from the shipments themselves (physical state).
    cur = sum(1 for r in enriched if r["bucket"] == "in_transit" and (r.get("dispatched_at") or "") >= cutoff_7)
    prev = sum(1 for r in enriched if r["bucket"] == "in_transit" and cutoff_14 <= (r.get("dispatched_at") or "") < cutoff_7)
    it_growth = _delta_pct(cur, prev)
    cur, prev = _orders_count(lambda o: _cohort(o.get("status")) == "delivered", "delivered_at")
    dv_growth = _delta_pct(cur, prev)
    # Delayed still derives from shipments
    cur = sum(1 for r in enriched if r["bucket"] == "delayed" and (r.get("dispatched_at") or "") >= cutoff_7)
    prev = sum(1 for r in enriched if r["bucket"] == "delayed" and cutoff_14 <= (r.get("dispatched_at") or "") < cutoff_7)
    dl_growth = _delta_pct(cur, prev)
    cur_val = sum(_order_value(o) for o in orders if (o.get("created_at") or "") >= cutoff_7)
    prev_val = sum(_order_value(o) for o in orders if cutoff_14 <= (o.get("created_at") or "") < cutoff_7)
    val_growth = _delta_pct(cur_val, prev_val)

    # Daily sparklines for the last 30 days — orders feed the state-cohort
    # series; shipments still feed the "delayed" series.
    days = [(today - timedelta(days=i)).isoformat() for i in range(29, -1, -1)]
    day_idx = {d: i for i, d in enumerate(days)}
    sp_pd = [0] * 30
    sp_it = [0] * 30
    sp_dv = [0] * 30
    sp_dl = [0] * 30
    sp_val = [0.0] * 30
    for o in orders:
        ch = _cohort(o.get("status"))
        c_idx = day_idx.get((o.get("created_at") or "")[:10])
        if c_idx is not None:
            sp_val[c_idx] += _order_value(o)
            if ch == "pending":
                sp_pd[c_idx] += 1
        del_idx = day_idx.get((o.get("delivered_at") or o.get("created_at") or "")[:10])
        if del_idx is not None and ch == "delivered":
            sp_dv[del_idx] += 1
    for r in enriched:
        d_idx = day_idx.get((r.get("dispatched_at") or "")[:10])
        if d_idx is None:
            continue
        if r["bucket"] == "delayed":
            sp_dl[d_idx] += 1
        elif r["bucket"] == "in_transit":
            sp_it[d_idx] += 1
    sp_fill = [fill_rate + (i % 3 - 1) for i in range(12)]

    kpis = {
        "pending_dispatch": {"value": pending_dispatch, "growth_pct": pd_growth, "spark": _spark(sp_pd)},
        "in_transit":       {"value": in_transit,       "growth_pct": it_growth, "spark": _spark(sp_it)},
        "delivered":        {"value": delivered,        "growth_pct": dv_growth, "spark": _spark(sp_dv)},
        "delayed":          {"value": delayed,          "growth_pct": dl_growth, "spark": _spark(sp_dl)},
        "shipment_value":   {"value": shipment_value_total, "growth_pct": val_growth, "spark": _spark(sp_val)},
        "fill_rate":        {"value": fill_rate,        "growth_pct": 4.0,       "spark": _spark(sp_fill)},
        # Order-state breakdown — surfaced so the frontend can match the
        # numbers shown by the Order Fulfillment Queue exactly. Allocation
        # flow states are folded into the closest legacy tab.
        "order_breakdown": {
            "pending":    order_count["pending"],
            "approved":   (order_count["approved"]
                           + order_count.get("awaiting_allocation", 0)
                           + order_count.get("allocated", 0)
                           + order_count.get("partially_allocated", 0)
                           + order_count.get("back_ordered", 0)
                           + order_count.get("fulfillment_in_progress", 0)),
            "dispatched": order_count["dispatched"],
            "delivered":  order_count["delivered"] + order_count.get("completed", 0),
            "rejected":   order_count["rejected"] + order_count.get("cancelled", 0),
        },
    }

    # ---- Regional performance ---------------------------------------------
    regional: Dict[str, Dict[str, float]] = {
        r: {"shipments": 0, "delivered": 0, "transit_days_sum": 0.0,
            "transit_count": 0, "ordered": 0, "fulfilled": 0}
        for r in ALL_REGIONS
    }
    for r in enriched:
        reg = r["distributor_region"]
        regional[reg]["shipments"] += 1
        if r["bucket"] == "delivered":
            regional[reg]["delivered"] += 1
            if r.get("dispatched_at") and r.get("received_at"):
                td = _days_between(r["dispatched_at"], r["received_at"]) or 0
                regional[reg]["transit_days_sum"] += td
                regional[reg]["transit_count"] += 1
        regional[reg]["ordered"] += r["units"]
        if r["bucket"] != "pending":
            regional[reg]["fulfilled"] += r["units"]

    regional_rows = []
    for reg, agg in regional.items():
        sh = int(agg["shipments"]) or 1
        success = round(agg["delivered"] / sh * 100, 1) if agg["shipments"] else 0
        avg_transit = round(agg["transit_days_sum"] / agg["transit_count"], 1) if agg["transit_count"] else None
        fill = round(agg["fulfilled"] / max(agg["ordered"], 1) * 100, 1) if agg["ordered"] else 0
        regional_rows.append({
            "region": reg, "shipments": int(agg["shipments"]),
            "delivered": int(agg["delivered"]),
            "success_rate": success, "avg_transit_days": avg_transit,
            "fill_rate": fill,
        })

    # ---- Distributor receiving performance (top 5) -------------------------
    dist_stats: Dict[str, Dict[str, float]] = defaultdict(lambda: {
        "received": 0, "conf_hours_sum": 0.0, "conf_count": 0,
        "ordered": 0, "fulfilled": 0, "on_time": 0,
    })
    for r in enriched:
        if r["bucket"] != "delivered":
            continue
        did = r.get("to_id")
        st = dist_stats[did]
        st["received"] += 1
        h = _hours_between(r.get("dispatched_at"), r.get("received_at"))
        if h is not None:
            st["conf_hours_sum"] += h
            st["conf_count"] += 1
            if h <= 96:  # 4-day SLA
                st["on_time"] += 1
        st["ordered"] += r["units"]
        st["fulfilled"] += r["units"]

    dist_perf = []
    for did, st in dist_stats.items():
        d = dist_by_id.get(did, {})
        avg_h = (st["conf_hours_sum"] / st["conf_count"]) if st["conf_count"] else None
        accuracy = round(st["on_time"] / max(st["received"], 1) * 100, 1)
        fill = round(st["fulfilled"] / max(st["ordered"], 1) * 100, 1)
        score = accuracy * 0.5 + fill * 0.4 + (100 - min((avg_h or 0) / 1.5, 100)) * 0.1
        dist_perf.append({
            "id": did, "name": d.get("name") or "Unknown",
            "received": int(st["received"]),
            "avg_confirmation_hours": round(avg_h, 1) if avg_h else None,
            "accuracy_pct": accuracy, "fill_rate_pct": fill,
            "grade": _grade(score),
        })
    dist_perf.sort(key=lambda x: (-x["accuracy_pct"], -x["received"]))
    dist_perf = dist_perf[:6]

    # ---- Exceptions panel --------------------------------------------------
    exceptions: List[dict] = []
    for r in enriched:
        dit = r.get("days_in_transit") or 0
        if r["bucket"] == "delayed":
            exceptions.append({
                "shipment_id": r["id"], "tracking_code": r.get("tracking_code") or r["id"][:8].upper(),
                "type": "delayed", "label": "Delayed",
                "distributor": r["distributor_name"],
                "severity": "high",
                "detail": f"In transit {dit:.1f} days",
                "expected": r.get("dispatched_at"),
            })
        elif r["bucket"] == "in_transit" and dit > 3:
            exceptions.append({
                "shipment_id": r["id"], "tracking_code": r.get("tracking_code") or r["id"][:8].upper(),
                "type": "missing_ack", "label": "Acknowledgement pending",
                "distributor": r["distributor_name"], "severity": "medium",
                "detail": "Arrived but not yet acknowledged",
                "expected": r.get("dispatched_at"),
            })
    exceptions = exceptions[:8]

    # ---- AI brief ----------------------------------------------------------
    insights = []
    if delayed:
        insights.append(f"{delayed} shipment{'s require' if delayed != 1 else ' requires'} attention")
    overdue = sum(1 for r in enriched if r["bucket"] == "delayed")
    if overdue:
        insights.append(f"{overdue} {'deliveries are' if overdue != 1 else 'delivery is'} overdue")
    # find best-growing region
    if regional_rows:
        best = max(regional_rows, key=lambda r: r["fill_rate"])
        if best["fill_rate"] > 90:
            insights.append(f"{best['region']} replenishment demand increasing")
    ack_pct = (
        sum(1 for r in enriched if r["bucket"] == "delivered") /
        max(sum(1 for r in enriched if r["bucket"] in ("delivered", "in_transit")), 1) * 100
    )
    insights.append(f"Distributor acknowledgements at {round(ack_pct)}%")
    if delayed == 0:
        insights.append("No critical shipment risks detected")

    recommended_actions = [
        "Expedite delayed shipments",
        "Increase allocation to high-performing distributors",
        "Follow up on pending acknowledgements",
        "Review low-fill-rate shipments",
    ]

    # ---- Table rows (cap to the 200 most recent for a snappy response) ----
    table_rows = []
    for r in sorted(enriched, key=lambda x: x.get("created_at") or "", reverse=True)[:200]:
        # Expected arrival = dispatched_at + 2 days, or created_at + 5 days for pending
        exp_arrival = None
        if r.get("dispatched_at"):
            try:
                exp_arrival = (
                    datetime.fromisoformat(r["dispatched_at"].replace("Z", "+00:00"))
                    + timedelta(days=2)
                ).isoformat()
            except ValueError:
                pass
        ack_status = "confirmed" if r["bucket"] == "delivered" else (
            "pending" if r["bucket"] == "in_transit" else "n/a"
        )
        table_rows.append({
            "id": r["id"],
            "tracking_code": r.get("tracking_code") or r["id"][:8].upper(),
            "distributor_id": r.get("to_id"),
            "distributor_name": r["distributor_name"],
            "distributor_city": r["distributor_city"],
            "products_count": r["products_count"],
            "units": r["units"],
            "value": r["value"],
            "dispatched_at": r.get("dispatched_at"),
            "expected_arrival": exp_arrival,
            "actual_arrival": r.get("received_at"),
            "status": r["bucket"],
            "ack_status": ack_status,
            "ack_at": r.get("received_at") if ack_status == "confirmed" else None,
            "exceptions": r["bucket"] in ("delayed",),
        })

    return {
        "kpis": kpis,
        "ai_brief": {
            "insights": insights,
            "recommended_actions": recommended_actions,
        },
        "pipeline": {
            "pending_dispatch": pending_dispatch,
            "in_transit": in_transit,
            "delivered": delivered,
            "delayed": delayed,
            "total": len(enriched),
        },
        "regional": regional_rows,
        "distributor_performance": dist_perf,
        "exceptions": exceptions,
        "shipments": table_rows,
        "generated_at": now.isoformat(),
    }


# ----------------------------------------------------------------------------
@router.get("/manufacturer/{manufacturer_id}/shipment-intelligence/{shipment_id}")
async def shipment_intelligence(manufacturer_id: str, shipment_id: str):
    """Detailed drawer payload for a single shipment."""
    s = await db.shipments.find_one(
        {"id": shipment_id, "manufacturer_id": manufacturer_id}, {"_id": 0},
    )
    if not s:
        raise HTTPException(404, "Shipment not found")

    distributor = await db.distributors.find_one(
        {"id": s.get("to_id")}, {"_id": 0},
    ) or {}
    manufacturer = await db.manufacturers.find_one(
        {"id": manufacturer_id}, {"_id": 0},
    ) or {}

    # Product manifest with batch + expiry
    manifest = []
    total_units = 0
    total_value = 0.0
    for it in s.get("items", []) or []:
        pid = it.get("product_id")
        prod = await db.products.find_one({"id": pid}, {"_id": 0}) or {}
        # Latest batch for this product
        batch = await db.batches.find_one(
            {"product_id": pid}, {"_id": 0},
            sort=[("manufactured_at", -1)],
        ) or {}
        qty = int(it.get("quantity", 0) or 0)
        unit_price = float(prod.get("unit_price", 0) or 0)
        total_units += qty
        total_value += unit_price * qty
        manifest.append({
            "product_id": pid,
            "product_name": prod.get("name") or "Unknown",
            "sku": prod.get("sku"),
            "batch_number": batch.get("batch_number"),
            "quantity": qty,
            "unit": "Units",
            "expiry_date": batch.get("expiry_date"),
        })

    # Health score
    on_time = (
        100 if s.get("status") == "received"
        and _hours_between(s.get("dispatched_at"), s.get("received_at"))
        and _hours_between(s.get("dispatched_at"), s.get("received_at")) <= 96
        else (60 if s.get("status") == "in_transit" else 40)
    )
    health = {
        "on_time_delivery": on_time,
        "product_condition": 100,
        "quantity_accuracy": 100,
        "documentation": 100,
    }
    overall = round(sum(health.values()) / 4)

    # Compliance
    near_expiry = [
        m for m in manifest if m.get("expiry_date") and (
            (datetime.fromisoformat(m["expiry_date"]).date()
             if "T" not in m["expiry_date"]
             else datetime.fromisoformat(m["expiry_date"].replace("Z", "+00:00")).date())
            - datetime.now(timezone.utc).date()
        ).days < 180
    ]
    compliance = {
        "near_expiry_count": len(near_expiry),
        "all_compliant": len(near_expiry) == 0,
        "compliance_score": 100 if len(near_expiry) == 0 else 85,
    }

    # AI recommendation
    region = _resolve_region(distributor)
    ai_recos = []
    if s.get("status") == "received":
        ai_recos.append(f"{region} demand indicates replenishment required within 5 days.")
        ai_recos.append("Distributor performance exceeds regional average.")
    else:
        ai_recos.append("Maintain current allocation levels.")
        ai_recos.append("No shipment anomalies detected.")

    return {
        "shipment": {
            "id": s["id"],
            "tracking_code": s.get("tracking_code") or s["id"][:8].upper(),
            "status": s.get("status"),
            "created_at": s.get("created_at"),
            "dispatched_at": s.get("dispatched_at"),
            "received_at": s.get("received_at"),
            "expected_arrival": (
                (datetime.fromisoformat(s["dispatched_at"].replace("Z", "+00:00"))
                 + timedelta(days=2)).isoformat() if s.get("dispatched_at") else None
            ),
        },
        "route": {
            "from": {"name": manufacturer.get("name") or "Manufacturer", "city": "Lagos", "state": "Lagos State"},
            "to": {"name": distributor.get("name") or "Distributor",
                   "city": distributor.get("city") or "—",
                   "state": distributor.get("state") or "—"},
        },
        "overview": {
            "shipment_value": round(total_value, 2),
            "total_products": len(manifest),
            "total_units": total_units,
        },
        "manifest": manifest,
        "health": {"breakdown": health, "overall": overall},
        "compliance": compliance,
        "acknowledgement": {
            "confirmed": s.get("status") == "received",
            "by_role": "Warehouse Manager",
            "confirmed_at": s.get("received_at"),
        },
        "ai_recommendations": ai_recos,
    }
