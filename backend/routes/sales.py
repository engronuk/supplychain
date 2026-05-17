"""Retailer Sales Book — POS-style sales entry, ledger, analytics, AI insights.

Tables/collections:
  - sales              : one row per transaction (transaction_code, payment, totals)
  - sales_line_items   : flattened lines for fast aggregation (denormalized into
                          `sales.items` already, separate aggregation queries hit
                          the embedded array via $unwind for analytics)
  - daily_sales        : existing collection — kept in sync so the rest of the
                          analytics pipeline (retailer dashboard, AI insights)
                          picks up shop-floor activity transparently.
"""
from __future__ import annotations

import csv
import io
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from core import db, logger, new_id, now_iso
from models import SaleCreate, SaleMarkPaid
from services.ai_insights import generate_ai_insights
from services.helpers import push_notification

router = APIRouter()

PAYMENT_LABELS = {"cash": "Cash", "transfer": "Transfer", "pos": "POS", "credit": "Credit"}


def _gen_tx_code() -> str:
    return "TX-" + new_id().split("-")[0].upper()


# ============================================================================
# Create sale  (atomic inventory deduction)
# ============================================================================
@router.post("/retailer/{retailer_id}/sales")
async def create_sale(retailer_id: str, payload: SaleCreate):
    retailer = await db.retailers.find_one({"id": retailer_id}, {"_id": 0})
    if not retailer:
        raise HTTPException(404, "Retailer not found")
    if not payload.items:
        raise HTTPException(400, "Sale must include at least one line item")

    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(5000)}

    # 1) Validate ALL stock first, then deduct — so partial failures don't
    # leave inventory inconsistent.
    inv_rows: Dict[str, dict] = {}
    for li in payload.items:
        if li.quantity <= 0:
            raise HTTPException(400, f"Quantity must be positive (product {li.product_id})")
        inv = await db.inventory.find_one(
            {"owner_type": "retailer", "owner_id": retailer_id, "product_id": li.product_id},
            {"_id": 0},
        )
        if not inv:
            raise HTTPException(400, f"No inventory row for product {li.product_id}")
        if int(inv.get("quantity", 0)) < li.quantity:
            p = products.get(li.product_id) or {}
            raise HTTPException(
                400,
                f"Insufficient stock for '{p.get('name', li.product_id)}': "
                f"{inv.get('quantity', 0)} available, {li.quantity} requested",
            )
        inv_rows[li.product_id] = inv

    # 2) Build the sale doc + deduct inventory + sync daily_sales
    line_docs: List[dict] = []
    grand_total = 0.0
    units_total = 0
    today_iso = datetime.now(timezone.utc).date().isoformat()
    for li in payload.items:
        p = products.get(li.product_id) or {}
        line_total = round(li.unit_price * li.quantity, 2)
        grand_total += line_total
        units_total += li.quantity
        line_docs.append({
            "product_id": li.product_id,
            "product_name": p.get("name", "—"),
            "category": p.get("category", ""),
            "sku": p.get("sku", ""),
            "quantity": li.quantity,
            "unit_price": float(li.unit_price),
            "line_total": line_total,
        })
        # deduct
        new_qty = max(0, int(inv_rows[li.product_id]["quantity"]) - li.quantity)
        await db.inventory.update_one(
            {"id": inv_rows[li.product_id]["id"]},
            {"$set": {"quantity": new_qty, "updated_at": now_iso()}},
        )
        # daily_sales sync — keeps existing analytics in lockstep
        await db.daily_sales.insert_one({
            "id": new_id(),
            "retailer_id": retailer_id,
            "product_id": li.product_id,
            "date": today_iso,
            "units": li.quantity,
            "quantity_sold": li.quantity,
            "revenue": line_total,
            "source": "sales_book",
        })

    sale = {
        "id": new_id(),
        "transaction_code": _gen_tx_code(),
        "retailer_id": retailer_id,
        "items": line_docs,
        "grand_total": round(grand_total, 2),
        "units_total": units_total,
        "payment_method": payload.payment_method,
        "payment_status": "pending" if payload.payment_method == "credit" else "paid",
        "customer_name": (payload.customer_name or "").strip(),
        "attendant": (payload.attendant or "").strip(),
        "notes": (payload.notes or "").strip(),
        "created_at": now_iso(),
        "paid_at": None if payload.payment_method == "credit" else now_iso(),
    }
    await db.sales.insert_one(sale)

    if payload.payment_method == "credit":
        await push_notification(
            "retailer", retailer_id, "Credit Sale Recorded",
            f"{sale['transaction_code']}: ₦{grand_total:,.0f} on credit"
            + (f" for {sale['customer_name']}" if sale["customer_name"] else ""),
            "system",
        )

    sale.pop("_id", None)
    return sale


# ============================================================================
# List sales (filters, pagination)
# ============================================================================
@router.get("/retailer/{retailer_id}/sales")
async def list_sales(
    retailer_id: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    product_id: Optional[str] = None,
    payment_method: Optional[str] = None,
    payment_status: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    q: Dict[str, Any] = {"retailer_id": retailer_id}
    if date_from:
        q.setdefault("created_at", {})["$gte"] = date_from
    if date_to:
        q.setdefault("created_at", {})["$lte"] = date_to + "T23:59:59Z"
    if product_id:
        q["items.product_id"] = product_id
    if payment_method:
        q["payment_method"] = payment_method
    if payment_status:
        q["payment_status"] = payment_status
    if search:
        q["$or"] = [
            {"transaction_code": {"$regex": search, "$options": "i"}},
            {"customer_name": {"$regex": search, "$options": "i"}},
            {"attendant": {"$regex": search, "$options": "i"}},
            {"items.product_name": {"$regex": search, "$options": "i"}},
        ]

    total = await db.sales.count_documents(q)
    rows = await db.sales.find(q, {"_id": 0}).sort("created_at", -1).skip(offset).limit(limit).to_list(limit)
    return {"total": total, "limit": limit, "offset": offset, "rows": rows}


# ============================================================================
# Today's summary KPIs + AI insights
# ============================================================================
@router.get("/retailer/{retailer_id}/sales/summary")
async def sales_summary(retailer_id: str):
    today = datetime.now(timezone.utc).date()
    start_iso = today.isoformat()
    week_start = (today - timedelta(days=6)).isoformat()
    last_week_start = (today - timedelta(days=13)).isoformat()

    today_q = {"retailer_id": retailer_id, "created_at": {"$gte": start_iso}}
    today_rows = await db.sales.find(today_q, {"_id": 0}).to_list(2000)

    total_revenue = round(sum(s["grand_total"] for s in today_rows), 2)
    tx_count = len(today_rows)
    units = sum(s["units_total"] for s in today_rows)
    avg_basket = round(total_revenue / tx_count, 2) if tx_count else 0
    pending_credit = round(sum(
        s["grand_total"] for s in today_rows if s.get("payment_status") == "pending"
    ), 2)

    # Best-selling product today
    prod_units: Dict[str, dict] = {}
    for s in today_rows:
        for it in s["items"]:
            agg = prod_units.setdefault(it["product_id"], {
                "name": it["product_name"], "units": 0, "revenue": 0.0,
            })
            agg["units"] += it["quantity"]
            agg["revenue"] += it["line_total"]
    best_seller = max(prod_units.values(), key=lambda x: x["units"], default=None)

    # Trend deltas (WoW)
    week_rows = await db.sales.find(
        {"retailer_id": retailer_id, "created_at": {"$gte": week_start}}, {"_id": 0, "grand_total": 1},
    ).to_list(5000)
    prev_week_rows = await db.sales.find(
        {"retailer_id": retailer_id,
         "created_at": {"$gte": last_week_start, "$lt": week_start}}, {"_id": 0, "grand_total": 1},
    ).to_list(5000)
    rev_7d = sum(s["grand_total"] for s in week_rows)
    rev_prev_7d = sum(s["grand_total"] for s in prev_week_rows)
    wow_pct = round(((rev_7d - rev_prev_7d) / rev_prev_7d) * 100, 1) if rev_prev_7d else 0.0

    return {
        "kpis": {
            "revenue_today": total_revenue,
            "transactions_today": tx_count,
            "units_today": units,
            "avg_basket": avg_basket,
            "best_seller": best_seller,
            "pending_credit": pending_credit,
            "revenue_7d": round(rev_7d, 2),
            "wow_pct": wow_pct,
        },
    }


# ============================================================================
# Analytics — trends, products, payments, hours
# ============================================================================
@router.get("/retailer/{retailer_id}/sales/analytics")
async def sales_analytics(retailer_id: str, days: int = Query(30, ge=7, le=90)):
    today = datetime.now(timezone.utc).date()
    start = (today - timedelta(days=days - 1)).isoformat()

    rows = await db.sales.find(
        {"retailer_id": retailer_id, "created_at": {"$gte": start}}, {"_id": 0},
    ).sort("created_at", 1).to_list(20000)

    # Daily revenue trend
    by_day: Dict[str, dict] = {}
    by_hour: Dict[int, dict] = {h: {"hour": h, "revenue": 0.0, "tx": 0} for h in range(24)}
    by_dow: Dict[int, dict] = {d: {"dow": d, "revenue": 0.0, "tx": 0} for d in range(7)}
    by_payment: Dict[str, dict] = {k: {"method": k, "label": v, "revenue": 0.0, "tx": 0}
                                    for k, v in PAYMENT_LABELS.items()}
    by_product: Dict[str, dict] = {}

    for s in rows:
        d = s["created_at"][:10]
        agg = by_day.setdefault(d, {"date": d, "revenue": 0.0, "tx": 0, "units": 0})
        agg["revenue"] += s["grand_total"]
        agg["tx"] += 1
        agg["units"] += s["units_total"]

        try:
            dt = datetime.fromisoformat(s["created_at"].replace("Z", "+00:00"))
            by_hour[dt.hour]["revenue"] += s["grand_total"]
            by_hour[dt.hour]["tx"] += 1
            by_dow[dt.weekday()]["revenue"] += s["grand_total"]
            by_dow[dt.weekday()]["tx"] += 1
        except Exception:
            pass

        pm = s.get("payment_method", "cash")
        if pm in by_payment:
            by_payment[pm]["revenue"] += s["grand_total"]
            by_payment[pm]["tx"] += 1

        for it in s["items"]:
            pa = by_product.setdefault(it["product_id"], {
                "product_id": it["product_id"], "name": it["product_name"],
                "category": it.get("category", ""),
                "units": 0, "revenue": 0.0,
            })
            pa["units"] += it["quantity"]
            pa["revenue"] += it["line_total"]

    trend = []
    for i in range(days):
        day = (today - timedelta(days=days - 1 - i)).isoformat()
        agg = by_day.get(day, {"date": day, "revenue": 0.0, "tx": 0, "units": 0})
        trend.append({**agg, "revenue": round(agg["revenue"], 2)})

    # Weekly buckets
    weekly: List[dict] = []
    for i in range(0, len(trend), 7):
        chunk = trend[i:i + 7]
        if not chunk:
            continue
        weekly.append({
            "week_start": chunk[0]["date"],
            "revenue": round(sum(c["revenue"] for c in chunk), 2),
            "tx": sum(c["tx"] for c in chunk),
        })

    # Monthly buckets
    monthly_map: Dict[str, dict] = {}
    for d in trend:
        m = d["date"][:7]
        agg = monthly_map.setdefault(m, {"month": m, "revenue": 0.0, "tx": 0})
        agg["revenue"] += d["revenue"]
        agg["tx"] += d["tx"]
    monthly = sorted(monthly_map.values(), key=lambda x: x["month"])
    for m in monthly:
        m["revenue"] = round(m["revenue"], 2)

    total_revenue = round(sum(d["revenue"] for d in trend), 2)
    total_tx = sum(d["tx"] for d in trend)
    avg_daily_revenue = round(total_revenue / days, 2)

    best_products = sorted(by_product.values(), key=lambda x: x["revenue"], reverse=True)[:8]
    slow_products = sorted(
        [p for p in by_product.values() if p["units"] > 0],
        key=lambda x: x["units"],
    )[:5]
    for p in best_products + slow_products:
        p["revenue"] = round(p["revenue"], 2)

    payment_mix = sorted(by_payment.values(), key=lambda x: x["revenue"], reverse=True)
    for p in payment_mix:
        p["revenue"] = round(p["revenue"], 2)

    hourly = list(by_hour.values())
    peak_hour = max(hourly, key=lambda x: x["revenue"])
    dow_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    dow_list = [{**v, "label": dow_names[v["dow"]], "revenue": round(v["revenue"], 2)}
                for v in by_dow.values()]
    peak_dow = max(dow_list, key=lambda x: x["revenue"])

    insights = await _generate_sales_insights(
        retailer_id=retailer_id,
        total_revenue=total_revenue, total_tx=total_tx,
        avg_daily_revenue=avg_daily_revenue,
        best_seller=best_products[0]["name"] if best_products else None,
        payment_mix=payment_mix,
        peak_hour=peak_hour["hour"], peak_dow=peak_dow["label"],
    )

    return {
        "totals": {
            "revenue": total_revenue, "tx": total_tx,
            "avg_daily_revenue": avg_daily_revenue,
            "days": days,
        },
        "trend_daily": trend,
        "trend_weekly": weekly,
        "trend_monthly": monthly,
        "best_products": best_products,
        "slow_products": slow_products,
        "payment_mix": payment_mix,
        "hourly": hourly,
        "peak_hour": peak_hour,
        "by_dow": dow_list,
        "peak_dow": peak_dow,
        "ai_insights": insights,
    }


async def _generate_sales_insights(*, retailer_id, total_revenue, total_tx,
                                   avg_daily_revenue, best_seller, payment_mix,
                                   peak_hour, peak_dow):
    total_pm_rev = sum(p["revenue"] for p in payment_mix) or 1
    pos_share = round(next((p["revenue"] for p in payment_mix if p["method"] == "pos"), 0) / total_pm_rev * 100, 1)
    cash_share = round(next((p["revenue"] for p in payment_mix if p["method"] == "cash"), 0) / total_pm_rev * 100, 1)
    credit_share = round(next((p["revenue"] for p in payment_mix if p["method"] == "credit"), 0) / total_pm_rev * 100, 1)

    context = f"""You are advising a Nigerian shopkeeper on their last 30 days of sales-book activity.

Key data:
- Total revenue: ₦{total_revenue:,.0f}
- Total transactions: {total_tx}
- Average daily revenue: ₦{avg_daily_revenue:,.0f}
- Best-selling product: {best_seller or 'n/a'}
- Peak hour: {peak_hour}:00
- Peak day of week: {peak_dow}
- Payment mix: POS {pos_share}% · Cash {cash_share}% · Credit {credit_share}%

Provide 3-5 actionable insights that help the shopkeeper grow revenue, manage stock,
or reduce credit risk."""
    try:
        return await generate_ai_insights(
            prompt_id=f"sales-{retailer_id}",
            kind="sales",
            context=context,
        )
    except Exception:
        logger.exception("Sales AI insights failed")
        return []


# ============================================================================
# Mark credit sale as paid
# ============================================================================
@router.patch("/retailer/{retailer_id}/sales/{sale_id}/mark-paid")
async def mark_sale_paid(retailer_id: str, sale_id: str, payload: SaleMarkPaid):
    sale = await db.sales.find_one({"id": sale_id, "retailer_id": retailer_id})
    if not sale:
        raise HTTPException(404, "Sale not found")
    if sale.get("payment_status") != "pending":
        raise HTTPException(400, "Sale already paid")
    await db.sales.update_one(
        {"id": sale_id},
        {"$set": {"payment_status": "paid", "paid_at": now_iso(),
                  "payment_method": payload.payment_method}},
    )
    updated = await db.sales.find_one({"id": sale_id}, {"_id": 0})
    return updated


# ============================================================================
# CSV export
# ============================================================================
@router.get("/retailer/{retailer_id}/sales/export.csv")
async def export_sales_csv(retailer_id: str,
                           date_from: Optional[str] = None,
                           date_to: Optional[str] = None):
    q: Dict[str, Any] = {"retailer_id": retailer_id}
    if date_from:
        q.setdefault("created_at", {})["$gte"] = date_from
    if date_to:
        q.setdefault("created_at", {})["$lte"] = date_to + "T23:59:59Z"
    rows = await db.sales.find(q, {"_id": 0}).sort("created_at", -1).to_list(20000)

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Transaction Code", "Date/Time", "Products", "Total Units",
                "Grand Total (NGN)", "Payment Method", "Payment Status",
                "Customer", "Attendant", "Notes"])
    for s in rows:
        prods = "; ".join(f"{it['product_name']} x{it['quantity']}" for it in s["items"])
        w.writerow([
            s["transaction_code"], s["created_at"], prods, s["units_total"],
            s["grand_total"], PAYMENT_LABELS.get(s["payment_method"], s["payment_method"]),
            s["payment_status"], s.get("customer_name", ""), s.get("attendant", ""),
            s.get("notes", ""),
        ])
    buf.seek(0)
    headers = {"Content-Disposition": f"attachment; filename=sales_{retailer_id[:8]}.csv"}
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers=headers)
