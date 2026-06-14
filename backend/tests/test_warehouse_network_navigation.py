"""Iteration 28 — Backend tests for warehouse-network navigation endpoints.

Validates:
- GET /api/manufacturer/{id}/warehouse-network for Unilever
- GET /api/warehouse/{id}/distributor-network for Unilever North Warehouse
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://supply-chain-hub-189.preview.emergentagent.com").rstrip("/")

UNILEVER_MFR_ID = "b21c1dbe-1a6f-4c33-b036-f416579455d0"
UNILEVER_NORTH_WAREHOUSE_ID = "36a2c08a-af09-844c-7f68-e6f2a68aadec"


@pytest.fixture(scope="module")
def manufacturer_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "unilever@tradekonekt.io", "password": "TradeKonekt2026!"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def auth_headers(manufacturer_token):
    if not manufacturer_token:
        pytest.skip("No token obtained")
    return {"Authorization": f"Bearer {manufacturer_token}"}


# ---------- manufacturer/{id}/warehouse-network ----------
class TestManufacturerWarehouseNetwork:
    def test_endpoint_status_200(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/manufacturer/{UNILEVER_MFR_ID}/warehouse-network",
            headers=auth_headers,
            timeout=20,
        )
        assert r.status_code == 200, r.text

    def test_kpis_shape_and_values(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/manufacturer/{UNILEVER_MFR_ID}/warehouse-network",
            headers=auth_headers,
            timeout=20,
        )
        data = r.json()
        assert "kpis" in data
        k = data["kpis"]
        for key in [
            "total_warehouses",
            "total_distributors",
            "total_wholesalers",
            "total_retailers",
            "revenue_90d",
            "low_stock_skus",
            "pending_orders",
        ]:
            assert key in k, f"missing kpi: {key}"
        assert k["total_warehouses"] == 3
        assert k["total_distributors"] == 6
        assert k["total_wholesalers"] == 18
        assert k["total_retailers"] == 84

    def test_warehouses_array(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/manufacturer/{UNILEVER_MFR_ID}/warehouse-network",
            headers=auth_headers,
            timeout=20,
        )
        data = r.json()
        assert "warehouses" in data and isinstance(data["warehouses"], list)
        assert len(data["warehouses"]) == 3
        sample = data["warehouses"][0]
        for key in [
            "id", "name", "code", "region", "city",
            "distributors", "wholesalers", "retailers",
            "active_retailers_30d", "revenue_90d", "inventory_units",
            "low_stock_skus", "pending_orders", "status",
        ]:
            assert key in sample, f"missing warehouse field: {key}"


# ---------- warehouse/{id}/distributor-network ----------
class TestWarehouseDistributorNetwork:
    def test_endpoint_status_200(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/warehouse/{UNILEVER_NORTH_WAREHOUSE_ID}/distributor-network",
            headers=auth_headers,
            timeout=20,
        )
        assert r.status_code == 200, r.text

    def test_distributors_for_north_warehouse(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/warehouse/{UNILEVER_NORTH_WAREHOUSE_ID}/distributor-network",
            headers=auth_headers,
            timeout=20,
        )
        data = r.json()
        assert "warehouse" in data and "kpis" in data and "distributors" in data
        dists = data["distributors"]
        assert len(dists) == 2, f"expected 2 distributors got {len(dists)}"
        names = sorted([d.get("name", "") for d in dists])
        assert any("Pinnacle" in n for n in names), names
        assert any("Bluewave" in n for n in names), names
        # field shape
        for d in dists:
            for k in ["id", "name", "code", "region", "city", "wholesalers", "retailers", "active_retailers_30d", "revenue_90d", "status"]:
                assert k in d, f"missing distributor field: {k}"

    def test_unknown_warehouse_returns_404(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/warehouse/does-not-exist-xx/distributor-network",
            headers=auth_headers,
            timeout=20,
        )
        assert r.status_code in (404, 400)
