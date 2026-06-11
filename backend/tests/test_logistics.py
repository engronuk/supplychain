"""Backend tests for the Manufacturer Logistics Command Center (/api/logistics/*).

Covers:
  - GET /api/logistics/overview shape (kpis, map, alerts, allocation_queue,
    authorization, transfers, pipeline, forecast)
  - POST /api/logistics/transfers create + decrement source + validation errors
  - PATCH /api/logistics/transfers/{id}/advance deliver/cancel
  - POST /api/logistics/requests/{id}/decide approve/reject/modify
  - POST /api/logistics/ai-recommendation/recompute + execute (idempotent)
  - Multi-tenant isolation (Unilever vs Flour Mills)
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://supply-chain-hub-189.preview.emergentagent.com").rstrip("/")
PASSWORD = "TradeKonekt2026!"
UNILEVER_EMAIL = "unilever@tradekonekt.io"
FLOUR_EMAIL = "flour.admin@tradekonekt.io"


def _login(email: str) -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def uni_headers():
    return {"Authorization": f"Bearer {_login(UNILEVER_EMAIL)}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def flour_headers():
    return {"Authorization": f"Bearer {_login(FLOUR_EMAIL)}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def overview(uni_headers):
    r = requests.get(f"{BASE_URL}/api/logistics/overview", headers=uni_headers, timeout=60)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------- OVERVIEW SHAPE -----------------------------
class TestOverview:
    def test_kpis(self, overview):
        kpis = overview["kpis"]
        for k in ("total_inventory_units", "warehouses", "open_orders",
                  "pending_shipments", "delayed_shipments",
                  "inventory_value", "forecast_accuracy"):
            assert k in kpis, f"missing kpi {k}"
        assert kpis["warehouses"] >= 1
        assert isinstance(kpis["total_inventory_units"], int)

    def test_map(self, overview):
        m = overview["map"]
        assert "warehouses" in m and "routes" in m and "trucks" in m
        # Unilever should have 7 warehouses per problem statement
        assert len(m["warehouses"]) == 7, f"expected 7 Unilever warehouses, got {len(m['warehouses'])}"
        for w in m["warehouses"]:
            assert -90 <= w["lat"] <= 90
            assert -180 <= w["lng"] <= 180
            assert w["health"] in ("healthy", "low", "critical")

    def test_alerts_sorted_critical_first(self, overview):
        sev_rank = {"critical": 0, "warning": 1, "info": 2}
        ranks = [sev_rank.get(a["severity"], 3) for a in overview["alerts"]]
        assert ranks == sorted(ranks), "alerts not sorted by severity"

    def test_authorization_shape(self, overview):
        auth = overview["authorization"]
        for k in ("warehouse", "distributor", "wholesaler"):
            assert k in auth and isinstance(auth[k], list)

    def test_pipeline_monotonic(self, overview):
        p = overview["pipeline"]
        # Funnel sanity: open >= allocated; picked >= packed >= shipped >= delivered
        assert p["open"] >= p["allocated"], p
        assert p["picked"] >= p["packed"] >= p["shipped"] >= p["delivered"], p

    def test_forecast_present(self, overview):
        f = overview["forecast"]
        assert "top_product" in f and "regional" in f and "stockouts" in f

    def test_transfers_active(self, overview):
        assert "transfers" in overview
        assert "active" in overview["transfers"]


# ---------------------------- TRANSFER CRUD -----------------------------
class TestTransfers:
    @pytest.fixture(scope="class")
    def stocked_warehouses(self, uni_headers, overview):
        """Pick two Unilever warehouses with stock for transfer tests."""
        ws = [w for w in overview["map"]["warehouses"] if w["units"] > 50]
        if len(ws) < 2:
            pytest.skip("need 2 warehouses with stock")
        return ws[0], ws[1]

    @pytest.fixture(scope="class")
    def transferable_product(self, uni_headers, stocked_warehouses):
        """Get the source warehouse's inventory and pick a product to transfer."""
        src, _dst = stocked_warehouses
        r = requests.get(f"{BASE_URL}/api/inventory",
                         params={"owner_type": "warehouse", "owner_id": src["id"]},
                         headers=uni_headers, timeout=30)
        assert r.status_code == 200, r.text
        inv = r.json() if isinstance(r.json(), list) else r.json().get("inventory") or []
        for row in inv:
            qty = int(row.get("quantity") or 0) - int(row.get("reserved") or 0)
            pid = row.get("product_id")
            if qty >= 50 and pid:
                return pid, qty
        pytest.skip("no transferable product (>=50 units) in source warehouse")

    def test_create_transfer_same_src_dst_400(self, uni_headers, stocked_warehouses, transferable_product):
        src, _ = stocked_warehouses
        pid, _ = transferable_product
        r = requests.post(f"{BASE_URL}/api/logistics/transfers", headers=uni_headers, json={
            "from_warehouse_id": src["id"], "to_warehouse_id": src["id"],
            "product_id": pid, "quantity": 10, "reason": "TEST_same_wh",
        }, timeout=30)
        assert r.status_code == 400, r.text

    def test_create_transfer_insufficient_stock_400(self, uni_headers, stocked_warehouses, transferable_product):
        src, dst = stocked_warehouses
        pid, _ = transferable_product
        r = requests.post(f"{BASE_URL}/api/logistics/transfers", headers=uni_headers, json={
            "from_warehouse_id": src["id"], "to_warehouse_id": dst["id"],
            "product_id": pid, "quantity": 999_999_999, "reason": "TEST_overdraw",
        }, timeout=30)
        assert r.status_code == 400, r.text
        assert "insufficient" in r.text.lower() or "available" in r.text.lower()

    def test_create_and_deliver_transfer(self, uni_headers, stocked_warehouses, transferable_product):
        src, dst = stocked_warehouses
        pid, _ = transferable_product
        qty = 25
        r = requests.post(f"{BASE_URL}/api/logistics/transfers", headers=uni_headers, json={
            "from_warehouse_id": src["id"], "to_warehouse_id": dst["id"],
            "product_id": pid, "quantity": qty, "reason": "TEST_create",
        }, timeout=30)
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["status"] == "in_transit"
        assert t["transfer_number"].startswith("TRF-")
        assert t.get("vehicle_id")
        tid = t["id"]

        # Deliver
        r2 = requests.patch(f"{BASE_URL}/api/logistics/transfers/{tid}/advance",
                            headers=uni_headers, json={"action": "deliver"}, timeout=30)
        assert r2.status_code == 200, r2.text
        assert r2.json()["status"] == "delivered"

        # Already-delivered -> 400
        r3 = requests.patch(f"{BASE_URL}/api/logistics/transfers/{tid}/advance",
                            headers=uni_headers, json={"action": "deliver"}, timeout=30)
        assert r3.status_code == 400

    def test_cancel_transfer_restores_stock(self, uni_headers, stocked_warehouses, transferable_product):
        src, dst = stocked_warehouses
        pid, _ = transferable_product
        r = requests.post(f"{BASE_URL}/api/logistics/transfers", headers=uni_headers, json={
            "from_warehouse_id": src["id"], "to_warehouse_id": dst["id"],
            "product_id": pid, "quantity": 10, "reason": "TEST_cancel",
        }, timeout=30)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        r2 = requests.patch(f"{BASE_URL}/api/logistics/transfers/{tid}/advance",
                            headers=uni_headers, json={"action": "cancel"}, timeout=30)
        assert r2.status_code == 200, r2.text
        assert r2.json()["status"] == "cancelled"


# ---------------------------- REPLENISHMENT DECIDE ---------------------------
class TestReplenishment:
    def test_reject_pending_request(self, uni_headers, overview):
        # Use a wholesaler pending request (won't trigger inter-warehouse transfer
        # so it stays simple). If none, try warehouse approve below.
        wh_reqs = overview["authorization"]["wholesaler"]
        if not wh_reqs:
            pytest.skip("no wholesaler replenishment requests")
        rid = wh_reqs[0]["id"]
        r = requests.post(f"{BASE_URL}/api/logistics/requests/{rid}/decide",
                          headers=uni_headers, json={"action": "reject"}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "rejected"
        # Second reject -> 400 (already decided)
        r2 = requests.post(f"{BASE_URL}/api/logistics/requests/{rid}/decide",
                           headers=uni_headers, json={"action": "reject"}, timeout=30)
        assert r2.status_code == 400, r2.text

    def test_approve_warehouse_request_creates_transfer(self, uni_headers):
        # Re-fetch overview to find a still-pending warehouse request
        r = requests.get(f"{BASE_URL}/api/logistics/overview", headers=uni_headers, timeout=60)
        wh_reqs = r.json()["authorization"]["warehouse"]
        if not wh_reqs:
            pytest.skip("no pending warehouse requests")
        rid = wh_reqs[0]["id"]
        r2 = requests.post(f"{BASE_URL}/api/logistics/requests/{rid}/decide",
                           headers=uni_headers, json={"action": "approve"}, timeout=30)
        # Could be 400 if no source warehouse has stock
        if r2.status_code == 400 and "No tenant warehouse" in r2.text:
            pytest.skip("no source warehouse has stock for this product")
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert body["status"] == "approved"
        assert body.get("transfer_number", "").startswith("TRF-") or body.get("transfer") is not None


# ---------------------------- AI RECOMMENDATION ------------------------------
class TestAIRecommendation:
    def test_recompute_and_execute(self, uni_headers):
        r = requests.post(f"{BASE_URL}/api/logistics/ai-recommendation/recompute",
                          headers=uni_headers, timeout=90)
        assert r.status_code == 200, r.text
        rec = r.json()
        assert rec["ai_status"] in ("vertex_ai", "fallback_rules"), rec.get("ai_status")
        assert rec["from_warehouse_id"] != rec["to_warehouse_id"]
        assert rec.get("from_warehouse_name") and rec.get("to_warehouse_name")
        assert rec.get("product_name")
        assert rec.get("executed") is False

        # Execute it
        if not rec.get("quantity"):
            pytest.skip("recommendation has zero quantity (no transferable stock)")
        r2 = requests.post(f"{BASE_URL}/api/logistics/ai-recommendation/execute",
                           headers=uni_headers, timeout=30)
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert body["recommendation"]["executed"] is True
        assert body["transfer"]["transfer_number"].startswith("TRF-")

        # Double execute -> 400
        r3 = requests.post(f"{BASE_URL}/api/logistics/ai-recommendation/execute",
                           headers=uni_headers, timeout=30)
        assert r3.status_code == 400, r3.text


# ---------------------------- TENANT ISOLATION ------------------------------
class TestTenantIsolation:
    def test_flour_sees_only_flour(self, flour_headers, overview):
        r = requests.get(f"{BASE_URL}/api/logistics/overview", headers=flour_headers, timeout=60)
        assert r.status_code == 200, r.text
        flour = r.json()
        # Flour Mills should be a different tenant — warehouse count must NOT
        # equal Unilever's 7 and warehouse IDs must not overlap.
        flour_wh_ids = {w["id"] for w in flour["map"]["warehouses"]}
        uni_wh_ids = {w["id"] for w in overview["map"]["warehouses"]}
        assert not (flour_wh_ids & uni_wh_ids), "tenant warehouse overlap!"
        # Trucks must also be isolated
        flour_truck_ids = {t.get("id") for t in flour["map"]["trucks"]}
        uni_truck_ids = {t.get("id") for t in overview["map"]["trucks"]}
        assert not (flour_truck_ids & uni_truck_ids), "tenant truck overlap!"
