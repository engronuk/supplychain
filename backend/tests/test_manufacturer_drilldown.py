"""Backend tests for manufacturer drill-down endpoints + mutations.

Covers:
  - GET /api/manufacturer/{mfg_id}/products
  - GET /api/manufacturer/{mfg_id}/product/{product_id}
  - GET /api/manufacturer/{mfg_id}/distributor/{distributor_id}
  - PATCH /api/products/{product_id}
  - PATCH /api/distributors/{distributor_id}
  - POST /api/inventory/adjust
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.strip().split("=", 1)[1].rstrip("/")

API = f"{BASE_URL}/api"
PWD = "TradeKonekt2026!"
MFG = "unilever@tradekonekt.io"


@pytest.fixture(scope="module")
def mfg_token():
    r = requests.post(f"{API}/auth/login", json={"email": MFG, "password": PWD})
    assert r.status_code == 200
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def mfg_id(mfg_token):
    r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {mfg_token}"})
    assert r.status_code == 200
    return r.json()["tenant_id"]


@pytest.fixture(scope="module")
def auth_headers(mfg_token):
    return {"Authorization": f"Bearer {mfg_token}", "Content-Type": "application/json"}


# -------------------- enriched product catalog --------------------
class TestManufacturerProducts:
    def test_returns_enriched_list(self, mfg_id, auth_headers):
        r = requests.get(f"{API}/manufacturer/{mfg_id}/products", headers=auth_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        required = {"id", "sku", "name", "category", "unit_price",
                    "units_in_network", "distributor_count", "retailer_count",
                    "revenue_90d", "units_sold_90d", "status"}
        for p in data:
            assert required.issubset(p.keys()), f"missing keys in {p.keys()}"
            assert isinstance(p["unit_price"], (int, float))
            assert isinstance(p["units_in_network"], int)
            assert p["status"] in ("active", "inactive")


# -------------------- product detail --------------------
class TestManufacturerProductDetail:
    def test_full_payload(self, mfg_id, auth_headers):
        list_r = requests.get(f"{API}/manufacturer/{mfg_id}/products", headers=auth_headers)
        product_id = list_r.json()[0]["id"]
        r = requests.get(f"{API}/manufacturer/{mfg_id}/product/{product_id}",
                         headers=auth_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        for key in ("product", "inventory", "distribution", "analytics", "recent_orders"):
            assert key in data
        # inventory keys
        for k in ("distributor_units", "retailer_units", "available", "reserved",
                  "last_restock_at"):
            assert k in data["inventory"]
        # distribution keys
        for k in ("distributors_carrying", "distributors_total",
                  "retailers_stocking", "retailers_total",
                  "by_distributor", "by_region"):
            assert k in data["distribution"]
        assert isinstance(data["distribution"]["by_distributor"], list)
        assert isinstance(data["distribution"]["by_region"], list)
        # analytics keys
        for k in ("total_revenue_90d", "total_units_90d", "avg_daily_sales",
                  "inventory_turnover", "monthly_trend"):
            assert k in data["analytics"]
        assert isinstance(data["analytics"]["monthly_trend"], list)
        assert isinstance(data["recent_orders"], list)

    def test_404_for_missing_product(self, mfg_id, auth_headers):
        r = requests.get(f"{API}/manufacturer/{mfg_id}/product/does-not-exist",
                         headers=auth_headers)
        assert r.status_code == 404


# -------------------- distributor detail --------------------
class TestManufacturerDistributorDetail:
    def test_full_payload(self, mfg_id, auth_headers):
        # Pick a distributor id via /distributors
        r = requests.get(f"{API}/distributors?manufacturer_id={mfg_id}",
                         headers=auth_headers)
        assert r.status_code == 200, r.text
        dists = r.json()
        assert dists, "expected at least one distributor"
        d_id = dists[0]["id"]
        r2 = requests.get(f"{API}/manufacturer/{mfg_id}/distributor/{d_id}",
                          headers=auth_headers)
        assert r2.status_code == 200, r2.text
        body = r2.json()
        for k in ("distributor", "business_metrics", "product_portfolio",
                  "performance", "retailers_summary"):
            assert k in body
        bm = body["business_metrics"]
        for k in ("total_orders", "total_units_distributed", "revenue_generated",
                  "outstanding_units", "outstanding_value", "last_order_at",
                  "growth_rate_pct", "retailers_count", "downstream_revenue_90d"):
            assert k in bm
        assert isinstance(body["product_portfolio"], list)
        assert "monthly_trend" in body["performance"]
        assert "top_products" in body["performance"]

    def test_404_for_missing_distributor(self, mfg_id, auth_headers):
        r = requests.get(f"{API}/manufacturer/{mfg_id}/distributor/nope",
                         headers=auth_headers)
        assert r.status_code == 404


# -------------------- PATCH product --------------------
class TestUpdateProduct:
    def test_patch_valid_and_unknown(self, mfg_id, auth_headers):
        # Pick a product
        list_r = requests.get(f"{API}/manufacturer/{mfg_id}/products", headers=auth_headers)
        p = list_r.json()[0]
        original_price = p["unit_price"]
        product_id = p["id"]

        new_price = round(original_price + 1.23, 2)
        # Send 1 valid + 1 unauthorized field
        payload = {"unit_price": new_price, "manufacturer_id": "HACK_ATTEMPT"}
        r = requests.patch(f"{API}/products/{product_id}", json=payload, headers=auth_headers)
        assert r.status_code == 200, r.text
        updated = r.json()
        assert abs(updated["unit_price"] - new_price) < 0.001
        # manufacturer_id should NOT have changed
        assert updated.get("manufacturer_id") != "HACK_ATTEMPT"

        # GET to verify persisted
        det = requests.get(f"{API}/manufacturer/{mfg_id}/product/{product_id}",
                           headers=auth_headers).json()
        assert abs(det["product"]["unit_price"] - new_price) < 0.001

        # Revert
        revert = requests.patch(f"{API}/products/{product_id}",
                                json={"unit_price": original_price},
                                headers=auth_headers)
        assert revert.status_code == 200
        assert abs(revert.json()["unit_price"] - original_price) < 0.001

    def test_patch_404(self, auth_headers):
        r = requests.patch(f"{API}/products/does-not-exist",
                           json={"name": "x"}, headers=auth_headers)
        assert r.status_code == 404


# -------------------- PATCH distributor --------------------
class TestUpdateDistributor:
    def test_patch_valid(self, mfg_id, auth_headers):
        r = requests.get(f"{API}/distributors?manufacturer_id={mfg_id}",
                         headers=auth_headers)
        d = r.json()[0]
        d_id = d["id"]
        original_phone = d.get("phone", "")
        new_phone = "+234-800-TEST-QA"
        r2 = requests.patch(f"{API}/distributors/{d_id}",
                            json={"phone": new_phone, "garbage_field": "x"},
                            headers=auth_headers)
        assert r2.status_code == 200, r2.text
        assert r2.json()["phone"] == new_phone
        assert "garbage_field" not in r2.json() or r2.json().get("garbage_field") != "x"
        # Revert
        rev = requests.patch(f"{API}/distributors/{d_id}",
                             json={"phone": original_phone or "+234-000-0000"},
                             headers=auth_headers)
        assert rev.status_code == 200

    def test_patch_404(self, auth_headers):
        r = requests.patch(f"{API}/distributors/nope", json={"name": "x"},
                           headers=auth_headers)
        assert r.status_code == 404


# -------------------- POST /inventory/adjust --------------------
class TestAdjustInventory:
    def test_delta_and_set_modes(self, mfg_id, auth_headers):
        # Pick a distributor and product
        d_id = requests.get(f"{API}/distributors?manufacturer_id={mfg_id}",
                            headers=auth_headers).json()[0]["id"]
        p_id = requests.get(f"{API}/manufacturer/{mfg_id}/products",
                            headers=auth_headers).json()[0]["id"]

        # Read current quantity (if any)
        det = requests.get(f"{API}/manufacturer/{mfg_id}/product/{p_id}",
                           headers=auth_headers).json()
        cur_for_d = next((b["quantity"] for b in det["distribution"]["by_distributor"]
                          if b["distributor_id"] == d_id), 0)

        # Delta +50
        r = requests.post(f"{API}/inventory/adjust", json={
            "owner_type": "distributor", "owner_id": d_id, "product_id": p_id,
            "quantity_delta": 50, "reason": "qa-test-delta",
        }, headers=auth_headers)
        assert r.status_code == 200, r.text
        assert r.json()["quantity"] == cur_for_d + 50

        # Set absolute = 100
        r2 = requests.post(f"{API}/inventory/adjust", json={
            "owner_type": "distributor", "owner_id": d_id, "product_id": p_id,
            "set_quantity": 100, "reason": "qa-test-set",
        }, headers=auth_headers)
        assert r2.status_code == 200
        assert r2.json()["quantity"] == 100

        # Restore original
        restore = requests.post(f"{API}/inventory/adjust", json={
            "owner_type": "distributor", "owner_id": d_id, "product_id": p_id,
            "set_quantity": cur_for_d, "reason": "qa-restore",
        }, headers=auth_headers)
        assert restore.status_code == 200
        assert restore.json()["quantity"] == cur_for_d

    def test_invalid_owner_type(self, auth_headers):
        r = requests.post(f"{API}/inventory/adjust", json={
            "owner_type": "alien", "owner_id": "x", "product_id": "y",
            "quantity_delta": 1,
        }, headers=auth_headers)
        assert r.status_code == 400

    def test_missing_required_fields(self, auth_headers):
        r = requests.post(f"{API}/inventory/adjust", json={"owner_type": "distributor"},
                          headers=auth_headers)
        assert r.status_code == 400


# -------------------- regression: distributor inventory list --------------------
class TestDistributorInventoryRegression:
    def test_distributor_inventory_still_works(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        login = s.post(f"{API}/auth/login", json={
            "email": "lagos.distributor@tradekonekt.io", "password": PWD,
        })
        assert login.status_code == 200
        token = login.json()["access_token"]
        r = s.get(f"{API}/inventory", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code < 500
