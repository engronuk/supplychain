"""Iteration 3: Retailer Operating System backend tests.

Covers new endpoints:
  GET  /api/retailer/{id}/dashboard
  GET  /api/retailer/{id}/insights
  GET  /api/retailer/{id}/reorder-suggestions
  POST /api/retailer/{id}/quick-reorder
  GET  /api/retailer/{id}/sales-trend
  GET  /api/retailer/{id}/activity
plus velocity persistence on inventory and daily_sales seeded for primary retailer.
"""
import os
import pytest
import requests

# --- Resolve public BASE_URL from frontend/.env ---
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip()
                break
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def seeded():
    r = requests.post(f"{API}/seed", timeout=60)
    assert r.status_code == 200, r.text
    body = r.json()
    retailers = requests.get(f"{API}/retailers").json()
    products = requests.get(f"{API}/products").json()
    return {
        "seed_body": body,
        "retailers": retailers,
        "products": products,
        "primary_retailer_id": body.get("primary_retailer_id"),
        "primary_distributor_id": body.get("primary_distributor_id"),
    }


# ---- Velocity persistence on inventory ----
class TestInventoryVelocity:
    def test_retailer_inventory_has_velocity(self, seeded):
        rid = seeded["primary_retailer_id"]
        r = requests.get(f"{API}/inventory", params={"owner_type": "retailer", "owner_id": rid})
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 1
        assert all("velocity" in it for it in items)
        # at least one velocity > 0
        assert any(float(it["velocity"]) > 0 for it in items)


# ---- /retailer/{id}/dashboard ----
class TestRetailerDashboard:
    def test_dashboard_structure(self, seeded):
        rid = seeded["primary_retailer_id"]
        r = requests.get(f"{API}/retailer/{rid}/dashboard")
        assert r.status_code == 200, r.text
        d = r.json()
        # retailer object
        assert "retailer" in d and d["retailer"]["id"] == rid
        # kpis
        kp = d["kpis"]
        for k in [
            "inventory_units", "low_stock_count", "critical_count",
            "pending_deliveries", "sales_today_units", "sales_today_revenue", "skus_tracked",
        ]:
            assert k in kp, f"missing kpi {k}"
        # lists
        for k in ["recent_shipments", "top_selling", "fast_moving", "near_stockout"]:
            assert k in d and isinstance(d[k], list)

    def test_dashboard_404(self):
        r = requests.get(f"{API}/retailer/does-not-exist/dashboard")
        assert r.status_code == 404


# ---- /retailer/{id}/insights ----
class TestRetailerInsights:
    def test_insights_shape(self, seeded):
        rid = seeded["primary_retailer_id"]
        r = requests.get(f"{API}/retailer/{rid}/insights")
        assert r.status_code == 200
        insights = r.json()
        assert isinstance(insights, list)
        valid_tones = {"critical", "warning", "info"}
        for ins in insights:
            for k in ("id", "type", "tone", "title", "message", "action"):
                assert k in ins, f"insight missing {k}"
            assert ins["tone"] in valid_tones


# ---- /retailer/{id}/reorder-suggestions ----
class TestReorderSuggestions:
    def test_suggestions_excludes_healthy(self, seeded):
        rid = seeded["primary_retailer_id"]
        r = requests.get(f"{API}/retailer/{rid}/reorder-suggestions")
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        for it in items:
            for k in ("current_quantity", "velocity", "days_remaining",
                      "urgency", "recommended_quantity"):
                assert k in it
            # recommended rounded to nearest 5
            assert int(it["recommended_quantity"]) % 5 == 0
            # urgency tier is not 'healthy'
            assert it["urgency"] != "healthy"


# ---- /retailer/{id}/quick-reorder ----
class TestQuickReorder:
    def test_quick_reorder_with_items(self, seeded):
        rid = seeded["primary_retailer_id"]
        did = seeded["primary_distributor_id"]
        p = seeded["products"][0]
        body = {"items": [{"product_id": p["id"], "quantity": 7}], "note": "TEST_quick_items"}
        r = requests.post(f"{API}/retailer/{rid}/quick-reorder", json=body)
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["ok"] is True
        assert "request_id" in out
        req_id = out["request_id"]

        # Confirm appears in /api/requests for distributor
        listing = requests.get(f"{API}/requests", params={"distributor_id": did}).json()
        assert any(req["id"] == req_id for req in listing)

        # Confirm notification fired to distributor
        notifs = requests.get(f"{API}/notifications",
                              params={"target_type": "distributor", "target_id": did}).json()
        assert any("reorder" in (n.get("message", "").lower()) or
                   "stock request" in (n.get("title", "").lower())
                   for n in notifs)

    def test_quick_reorder_empty_items_400(self, seeded):
        rid = seeded["primary_retailer_id"]
        r = requests.post(f"{API}/retailer/{rid}/quick-reorder", json={"items": []})
        assert r.status_code == 400

    def test_quick_reorder_with_shipment_id(self, seeded):
        # Build a shipment dist->retailer first, then clone via quick-reorder
        rid = seeded["primary_retailer_id"]
        did = seeded["primary_distributor_id"]
        p = seeded["products"][3]
        create = requests.post(f"{API}/shipments", json={
            "from_role": "distributor", "from_id": did,
            "to_role": "retailer", "to_id": rid,
            "items": [{"product_id": p["id"], "quantity": 6}],
            "notes": "TEST clone source",
        })
        assert create.status_code == 200
        sid = create.json()["id"]
        r = requests.post(f"{API}/retailer/{rid}/quick-reorder", json={"shipment_id": sid})
        assert r.status_code == 200
        out = r.json()
        assert out["ok"] is True and out["items_count"] == 1

    def test_quick_reorder_unknown_retailer(self):
        r = requests.post(f"{API}/retailer/nope/quick-reorder",
                          json={"items": [{"product_id": "x", "quantity": 1}]})
        assert r.status_code == 404


# ---- /retailer/{id}/sales-trend ----
class TestSalesTrend:
    def test_sales_trend_7days(self, seeded):
        rid = seeded["primary_retailer_id"]
        r = requests.get(f"{API}/retailer/{rid}/sales-trend", params={"days": 7})
        assert r.status_code == 200, r.text
        d = r.json()
        assert "series" in d and len(d["series"]) == 7
        for row in d["series"]:
            for k in ("date", "units", "revenue"):
                assert k in row
        assert "totals" in d and "units" in d["totals"] and "revenue" in d["totals"]
        assert "inventory_turnover" in d
        assert "reorder_count" in d
        score = d["stock_efficiency_score"]
        assert isinstance(score, int) and 0 <= score <= 100


# ---- /retailer/{id}/activity ----
class TestActivityFeed:
    def test_activity_merged_and_sorted(self, seeded):
        rid = seeded["primary_retailer_id"]
        r = requests.get(f"{API}/retailer/{rid}/activity")
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list) and len(items) >= 1
        kinds = {it["kind"] for it in items}
        # At least shipment entries should exist for a retailer that had a shipment
        assert "shipment" in kinds
        # Sorted newest-first
        ts_list = [it["ts"] for it in items]
        assert ts_list == sorted(ts_list, reverse=True)
        # At least one shipment-collection event must carry tracking_code+status
        ship_events = [it for it in items if it["kind"] == "shipment" and "tracking_code" in it]
        assert len(ship_events) >= 1
        for it in ship_events:
            assert "status" in it


# ---- daily_sales seeded for primary retailer ----
class TestSeedDailySales:
    def test_primary_retailer_has_sales(self, seeded):
        rid = seeded["primary_retailer_id"]
        r = requests.get(f"{API}/retailer/{rid}/sales-trend", params={"days": 14})
        assert r.status_code == 200
        d = r.json()
        # Should have at least some non-zero units across 14 days
        assert d["totals"]["units"] > 0
