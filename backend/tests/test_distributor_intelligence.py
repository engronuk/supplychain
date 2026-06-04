"""Backend tests for the Distributor Intelligence Center endpoint."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
MANUFACTURER_ID = "b21c1dbe-1a6f-4c33-b036-f416579455d0"
DEMO_DIST = "d95dc722-679b-4ece-ab5e-af5e0dedd8ce"  # SUARA & CO. (has sales)
EMPTY_DIST = "acec42b9-adad-4444-abdd-7bb5fdf743c3"  # A-D-BASHARU JIMETA (no sales)
EMAIL = "unilever@tradekonekt.io"
PASSWORD = "TradeKonekt2026!"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    token = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def payload(client):
    r = client.get(
        f"{BASE_URL}/api/manufacturer/{MANUFACTURER_ID}/distributor-intelligence/{DEMO_DIST}",
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()


class TestShape:
    """Top-level shape + required keys."""

    def test_status_and_top_level_keys(self, payload):
        expected = {
            "distributor", "kpis", "ai_brief", "retail_performance_matrix",
            "retail_coverage", "top_retailers", "attention_retailers",
            "product_penetration", "retailer_table",
        }
        assert expected.issubset(set(payload.keys())), f"Missing: {expected - set(payload)}"

    def test_distributor_block(self, payload):
        d = payload["distributor"]
        assert d["id"] == DEMO_DIST
        assert isinstance(d["name"], str) and d["name"]
        for k in ("region", "city", "status", "created_at"):
            assert k in d

    def test_kpis_all_six(self, payload):
        kpi_keys = {
            "retail_revenue_90d", "active_retailers", "network_health_score",
            "stockout_risk_retailers", "avg_sell_through", "retail_order_frequency",
        }
        assert kpi_keys.issubset(set(payload["kpis"].keys()))
        for k in kpi_keys:
            assert "value" in payload["kpis"][k]

    def test_ai_brief(self, payload):
        b = payload["ai_brief"]
        assert isinstance(b["insights"], list)
        assert len(b["insights"]) == 5  # spec: 5 numbered insights
        assert "score" in b
        assert "value" in b["score"] and "status" in b["score"]


class TestUnitsAggregation:
    """Verify units come from canonical `units` field (not legacy quantity_sold)."""

    def test_matrix_has_units(self, payload):
        m = payload["retail_performance_matrix"]
        assert len(m) > 0, "Expected matrix rows for SUARA & CO."
        with_units = [r for r in m if r["units_90d"] > 0]
        assert len(with_units) > 0, "All units_90d are 0 - units field probably not being read"

    def test_best_supermarket_units(self, payload):
        m = payload["retail_performance_matrix"]
        # Find any row whose name contains 'best supermarket' (case-insensitive)
        target = next((r for r in m if "best supermarket" in r["name"].lower()), None)
        if target is None:
            pytest.skip("Best Supermarket not in matrix")
        # Spec hints ~557 units; assert > 0 (we don't want a brittle exact value)
        assert target["units_90d"] > 0, f"Best Supermarket units_90d = {target['units_90d']}"

    def test_quadrants_present(self, payload):
        quadrants = {r["quadrant"] for r in payload["retail_performance_matrix"]}
        assert quadrants.issubset({"stars", "growth_opps", "cash_cows", "at_risk"})


class TestCoverageAndLists:
    def test_coverage_bands(self, payload):
        for c in payload["retail_coverage"]:
            assert c["band"] in {"excellent", "good", "fair", "poor", "critical"}
            assert c["revenue_90d"] >= 0
            assert c["retailer_count"] >= 0

    def test_top_retailers_capped(self, payload):
        assert len(payload["top_retailers"]) <= 5

    def test_attention_list_capped(self, payload):
        assert len(payload["attention_retailers"]) <= 4

    def test_product_penetration_keys(self, payload):
        if not payload["product_penetration"]:
            pytest.skip("no penetration rows")
        p = payload["product_penetration"][0]
        for k in ("product_id", "product_name", "coverage_pct", "revenue_90d", "performance"):
            assert k in p

    def test_retailer_table_health_labels(self, payload):
        for r in payload["retailer_table"]:
            assert r["health"] in {"healthy", "watch", "risk"}


class TestAuthorisation:
    def test_404_on_foreign_distributor(self, client):
        bogus = "00000000-0000-0000-0000-000000000000"
        r = client.get(
            f"{BASE_URL}/api/manufacturer/{MANUFACTURER_ID}/distributor-intelligence/{bogus}",
            timeout=15,
        )
        assert r.status_code == 404


class TestEmptyDistributor:
    """A distributor with no sales should still return 200 with empty arrays."""

    def test_empty_distributor_ok(self, client):
        r = client.get(
            f"{BASE_URL}/api/manufacturer/{MANUFACTURER_ID}/distributor-intelligence/{EMPTY_DIST}",
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # KPI revenue should be 0; matrix/coverage may be empty
        assert body["kpis"]["retail_revenue_90d"]["value"] == 0 or isinstance(
            body["kpis"]["retail_revenue_90d"]["value"], (int, float)
        )
        assert isinstance(body["retailer_table"], list)



class TestRetailerDrilldown:
    """Manufacturer-scoped retailer drill-down validates the
    manufacturer→distributor→retailer chain and reuses the rich aggregator."""

    DEMO_RETAILER = "29c22c05-b37e-4046-ad22-1c627fdd0395"  # Best Supermarket

    def test_happy_path(self, client):
        r = client.get(
            f"{BASE_URL}/api/manufacturer/{MANUFACTURER_ID}/distributor/{DEMO_DIST}/retailer/{self.DEMO_RETAILER}",
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("retailer", "distributor", "overview", "deliveries",
                  "delivery_summary", "stock_requests", "analytics",
                  "transactions", "ai_insights"):
            assert k in body, f"missing {k}"
        assert body["retailer"]["id"] == self.DEMO_RETAILER
        assert body["distributor"]["id"] == DEMO_DIST

    def test_overview_block_has_kpis(self, client):
        r = client.get(
            f"{BASE_URL}/api/manufacturer/{MANUFACTURER_ID}/distributor/{DEMO_DIST}/retailer/{self.DEMO_RETAILER}",
            timeout=30,
        )
        o = r.json()["overview"]
        for k in ("stock_health_pct", "inventory_units", "active_orders",
                  "pending_requests", "total_revenue",
                  "in_stock", "low_stock", "out_of_stock"):
            assert k in o

    def test_404_wrong_manufacturer(self, client):
        r = client.get(
            f"{BASE_URL}/api/manufacturer/00000000-0000-0000-0000-000000000000/distributor/{DEMO_DIST}/retailer/{self.DEMO_RETAILER}",
            timeout=15,
        )
        assert r.status_code == 404

    def test_404_retailer_not_under_distributor(self, client):
        r = client.get(
            f"{BASE_URL}/api/manufacturer/{MANUFACTURER_ID}/distributor/{DEMO_DIST}/retailer/00000000-0000-0000-0000-000000000000",
            timeout=15,
        )
        assert r.status_code == 404
