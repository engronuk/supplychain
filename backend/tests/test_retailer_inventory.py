"""Pytest for the Retailer Inventory Command Center aggregator."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001")
RETAILER_ID = "29c22c05-b37e-4046-ad22-1c627fdd0395"


@pytest.fixture(scope="module")
def s():
    yield requests.Session()


class TestInventoryCommand:
    def test_200_ok(self, s):
        r = s.get(f"{BASE_URL}/api/retailer/{RETAILER_ID}/inventory-command-center", timeout=15)
        assert r.status_code == 200

    def test_payload_shape(self, s):
        body = s.get(f"{BASE_URL}/api/retailer/{RETAILER_ID}/inventory-command-center", timeout=15).json()
        for k in (
            "retailer", "kpis", "stock_health", "ai_insights",
            "low_stock_center", "value_by_category", "inventory_trend",
            "fast_moving", "slow_moving", "expiring_soon", "dead_stock",
            "inventory",
        ):
            assert k in body, f"missing {k}"

    def test_seven_kpis(self, s):
        body = s.get(f"{BASE_URL}/api/retailer/{RETAILER_ID}/inventory-command-center", timeout=15).json()
        for k in (
            "inventory_value", "total_skus", "inventory_units",
            "low_stock", "critical_stock", "expiring_soon", "dead_stock",
        ):
            assert k in body["kpis"]
            assert "value" in body["kpis"][k]

    def test_stock_health_donut(self, s):
        body = s.get(f"{BASE_URL}/api/retailer/{RETAILER_ID}/inventory-command-center", timeout=15).json()
        h = body["stock_health"]
        assert h["total"] == h["healthy"] + h["low"] + h["critical"]
        assert len(h["donut"]) == 3

    def test_trend_30_points(self, s):
        body = s.get(f"{BASE_URL}/api/retailer/{RETAILER_ID}/inventory-command-center", timeout=15).json()
        assert len(body["inventory_trend"]) == 30
        for row in body["inventory_trend"]:
            assert "date" in row and "value" in row

    def test_ai_insights(self, s):
        body = s.get(f"{BASE_URL}/api/retailer/{RETAILER_ID}/inventory-command-center", timeout=15).json()
        assert isinstance(body["ai_insights"], list)
        for ins in body["ai_insights"]:
            assert ins["type"] in (
                "stockout", "trending_up", "slow_mover", "all_clear",
            )
            assert "title" in ins and "detail" in ins
            assert "actions" in ins

    def test_low_stock_columns(self, s):
        body = s.get(f"{BASE_URL}/api/retailer/{RETAILER_ID}/inventory-command-center", timeout=15).json()
        for r in body["low_stock_center"]:
            for k in ("product", "current_stock", "reorder_level",
                      "days_remaining", "recommended_qty"):
                assert k in r

    def test_inventory_row_status_valid(self, s):
        body = s.get(f"{BASE_URL}/api/retailer/{RETAILER_ID}/inventory-command-center", timeout=15).json()
        for row in body["inventory"]:
            assert row["status"] in ("healthy", "low", "critical")
            assert "value" in row and "velocity_30d" in row

    def test_unknown_retailer_404(self, s):
        r = s.get(
            f"{BASE_URL}/api/retailer/00000000-0000-0000-0000-000000000000/inventory-command-center",
            timeout=10,
        )
        assert r.status_code == 404



class TestProductDetail:
    def test_product_detail_200(self, s):
        ps = requests.get(f"{BASE_URL}/api/products", timeout=10).json()
        pid = ps[0]["id"]
        r = s.get(f"{BASE_URL}/api/retailer/{RETAILER_ID}/product/{pid}", timeout=15)
        assert r.status_code == 200
        body = r.json()
        for k in ("product", "manufacturer", "inventory", "performance",
                  "trend_30d", "recent_supply"):
            assert k in body
        assert len(body["trend_30d"]) == 30
        assert body["inventory"]["status"] in ("healthy", "low", "critical")

    def test_unknown_product_404(self, s):
        r = s.get(f"{BASE_URL}/api/retailer/{RETAILER_ID}/product/00000000-0000-0000-0000-000000000000", timeout=10)
        assert r.status_code == 404

    def test_patch_pricing(self, s):
        ps = requests.get(f"{BASE_URL}/api/products", timeout=10).json()
        pid = ps[1]["id"]  # different SKU than the other test
        r = s.patch(
            f"{BASE_URL}/api/retailer/{RETAILER_ID}/product/{pid}/pricing",
            json={"retail_price": 1850.50, "reorder_level": 40, "notes": "kpi test"},
            timeout=10,
        )
        assert r.status_code == 200
        inv = r.json()["inventory"]
        assert inv["retail_price"] == 1850.50
        assert inv["reorder_level"] == 40
        assert inv["notes"] == "kpi test"
        if inv["cost_price"] > 0:
            assert inv["margin_pct"] is not None

    def test_patch_pricing_empty_400(self, s):
        ps = requests.get(f"{BASE_URL}/api/products", timeout=10).json()
        pid = ps[0]["id"]
        r = s.patch(
            f"{BASE_URL}/api/retailer/{RETAILER_ID}/product/{pid}/pricing",
            json={},
            timeout=10,
        )
        assert r.status_code == 400
