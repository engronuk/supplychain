"""Sales Book backend tests — covers all 6 endpoints."""
import os
import pytest
import requests
from urllib.parse import urlencode

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    # Fallback to frontend/.env at test time
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip()
                break
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def retailer():
    # Ensure seed
    requests.post(f"{API}/seed", timeout=30)
    rs = requests.get(f"{API}/retailers", timeout=15).json()
    assert rs, "no retailers"
    return rs[0]


@pytest.fixture(scope="module")
def inventory_rows(retailer):
    inv = requests.get(f"{API}/inventory",
                       params={"owner_type": "retailer", "owner_id": retailer["id"]},
                       timeout=15).json()
    # Pick a stocked row
    stocked = [i for i in inv if i.get("quantity", 0) >= 5]
    assert stocked, "no stocked inventory for retailer"
    return inv, stocked


# ---- Summary KPIs ----
def test_sales_summary_shape(retailer):
    r = requests.get(f"{API}/retailer/{retailer['id']}/sales/summary", timeout=15)
    assert r.status_code == 200, r.text
    k = r.json()["kpis"]
    for key in ["revenue_today", "transactions_today", "units_today", "avg_basket",
                "best_seller", "pending_credit", "revenue_7d", "wow_pct"]:
        assert key in k, f"missing kpi: {key}"


# ---- Create sale + atomic inventory deduction ----
def test_create_sale_deducts_inventory(retailer, inventory_rows):
    _, stocked = inventory_rows
    target = stocked[0]
    before = target["quantity"]
    qty = 2
    payload = {
        "items": [{"product_id": target["product_id"], "quantity": qty,
                   "unit_price": 1000.0}],
        "payment_method": "cash",
        "customer_name": "TEST_customer",
        "attendant": "TEST_attendant",
    }
    r = requests.post(f"{API}/retailer/{retailer['id']}/sales", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    sale = r.json()
    assert sale["transaction_code"].startswith("TX-")
    assert sale["grand_total"] == 2000.0
    assert sale["payment_status"] == "paid"
    assert sale["units_total"] == 2

    # Verify inventory decremented
    inv = requests.get(f"{API}/inventory",
                       params={"owner_type": "retailer", "owner_id": retailer["id"]},
                       timeout=15).json()
    new_row = next(i for i in inv if i["product_id"] == target["product_id"])
    assert new_row["quantity"] == before - qty, f"expected {before - qty} got {new_row['quantity']}"


# ---- Insufficient stock returns 400 with product name + available qty ----
def test_create_sale_insufficient_stock(retailer, inventory_rows):
    inv, _ = inventory_rows
    # Find any product row
    row = inv[0]
    payload = {
        "items": [{"product_id": row["product_id"],
                   "quantity": row["quantity"] + 9999,
                   "unit_price": 1.0}],
        "payment_method": "cash",
    }
    r = requests.post(f"{API}/retailer/{retailer['id']}/sales", json=payload, timeout=15)
    assert r.status_code == 400
    detail = r.json().get("detail", "")
    assert "available" in detail.lower()


# ---- Empty items returns 400 ----
def test_create_sale_empty_items(retailer):
    r = requests.post(f"{API}/retailer/{retailer['id']}/sales",
                      json={"items": [], "payment_method": "cash"}, timeout=15)
    assert r.status_code == 400


# ---- Credit sale -> pending status + notification ----
def test_create_sale_credit_pending(retailer, inventory_rows):
    _, stocked = inventory_rows
    target = stocked[0]
    payload = {
        "items": [{"product_id": target["product_id"], "quantity": 1, "unit_price": 500.0}],
        "payment_method": "credit",
        "customer_name": "TEST_creditor",
    }
    r = requests.post(f"{API}/retailer/{retailer['id']}/sales", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    sale = r.json()
    assert sale["payment_status"] == "pending"
    assert sale["paid_at"] is None

    # Notifications include this credit sale
    notes = requests.get(f"{API}/notifications",
                        params={"target_type": "retailer", "target_id": retailer["id"]},
                        timeout=15).json()
    assert any(sale["transaction_code"] in (n.get("message") or "") for n in notes)
    return sale


# ---- List sales with filters/pagination ----
def test_list_sales_pagination_and_filters(retailer):
    r = requests.get(f"{API}/retailer/{retailer['id']}/sales",
                     params={"limit": 5, "offset": 0}, timeout=15)
    assert r.status_code == 200
    body = r.json()
    for k in ("total", "limit", "offset", "rows"):
        assert k in body
    assert body["limit"] == 5
    assert isinstance(body["rows"], list)

    # Filter by payment method
    r2 = requests.get(f"{API}/retailer/{retailer['id']}/sales",
                      params={"payment_method": "credit"}, timeout=15).json()
    for row in r2["rows"]:
        assert row["payment_method"] == "credit"


# ---- Analytics shape ----
def test_sales_analytics(retailer):
    r = requests.get(f"{API}/retailer/{retailer['id']}/sales/analytics",
                     params={"days": 30}, timeout=30)
    assert r.status_code == 200, r.text
    a = r.json()
    for key in ("trend_daily", "trend_weekly", "trend_monthly", "best_products",
                "slow_products", "payment_mix", "hourly", "peak_hour", "by_dow",
                "peak_dow", "totals", "ai_insights"):
        assert key in a, f"missing key: {key}"
    assert len(a["trend_daily"]) == 30
    assert len(a["hourly"]) == 24
    assert len(a["by_dow"]) == 7
    assert len(a["payment_mix"]) == 4


# ---- CSV export ----
def test_export_csv(retailer):
    r = requests.get(f"{API}/retailer/{retailer['id']}/sales/export.csv", timeout=15)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert "Transaction Code" in r.text
    assert "Grand Total" in r.text


# ---- Mark-paid moves credit -> paid ----
def test_mark_paid(retailer, inventory_rows):
    _, stocked = inventory_rows
    target = stocked[0]
    # Create a fresh credit sale
    sale = requests.post(f"{API}/retailer/{retailer['id']}/sales", json={
        "items": [{"product_id": target["product_id"], "quantity": 1, "unit_price": 300.0}],
        "payment_method": "credit",
    }, timeout=15).json()
    sid = sale["id"]
    r = requests.patch(f"{API}/retailer/{retailer['id']}/sales/{sid}/mark-paid",
                       json={"payment_method": "cash"}, timeout=15)
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["payment_status"] == "paid"
    assert updated["paid_at"] is not None
    assert updated["payment_method"] == "cash"

    # Idempotency guard: second call should 400
    r2 = requests.patch(f"{API}/retailer/{retailer['id']}/sales/{sid}/mark-paid",
                        json={"payment_method": "cash"}, timeout=15)
    assert r2.status_code == 400
