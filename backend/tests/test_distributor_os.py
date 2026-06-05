"""Pytest suite for the Distributor Operations Intelligence Center."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001")
DISTRIBUTOR_ID = "d95dc722-679b-4ece-ab5e-af5e0dedd8ce"  # Lagos (SUARA & CO.)


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    # Warm the snapshot once so subsequent assertions get real data.
    s.post(
        f"{BASE_URL}/api/distributor/{DISTRIBUTOR_ID}/operations-intelligence/refresh",
        timeout=30,
    )
    yield s


class TestDistributorOps:
    """Snapshot-backed operations intelligence aggregator."""

    def test_endpoint_200(self, client):
        r = client.get(
            f"{BASE_URL}/api/distributor/{DISTRIBUTOR_ID}/operations-intelligence",
            timeout=30,
        )
        assert r.status_code == 200, r.text

    def test_payload_shape(self, client):
        body = client.get(
            f"{BASE_URL}/api/distributor/{DISTRIBUTOR_ID}/operations-intelligence",
            timeout=30,
        ).json()
        for k in (
            "distributor", "kpis", "ai_brief", "revenue_trend",
            "performance_matrix", "regional_coverage", "inventory_health",
            "top_retailers", "attention_retailers", "category_performance",
            "order_pipeline", "network_health", "totals", "quadrant_counts",
        ):
            assert k in body, f"missing key '{k}'"

    def test_six_kpis(self, client):
        body = client.get(
            f"{BASE_URL}/api/distributor/{DISTRIBUTOR_ID}/operations-intelligence",
            timeout=30,
        ).json()
        for k in (
            "network_revenue_90d", "active_retailers", "retail_orders_pending",
            "dispatched_30d", "inventory_units", "low_stock_skus",
        ):
            assert k in body["kpis"], f"missing kpi {k}"
            kpi = body["kpis"][k]
            assert "value" in kpi
            assert "spark" in kpi
            assert isinstance(kpi["spark"], list)

    def test_revenue_trend_30_days(self, client):
        body = client.get(
            f"{BASE_URL}/api/distributor/{DISTRIBUTOR_ID}/operations-intelligence",
            timeout=30,
        ).json()
        assert len(body["revenue_trend"]) == 30
        for row in body["revenue_trend"]:
            assert "date" in row and "revenue" in row and "units" in row

    def test_ai_brief_present(self, client):
        body = client.get(
            f"{BASE_URL}/api/distributor/{DISTRIBUTOR_ID}/operations-intelligence",
            timeout=30,
        ).json()
        brief = body["ai_brief"]
        assert "insights" in brief and "recommended_actions" in brief
        assert len(brief["insights"]) >= 1
        for ins in brief["insights"]:
            assert "tone" in ins and "title" in ins

    def test_performance_matrix_quadrants(self, client):
        body = client.get(
            f"{BASE_URL}/api/distributor/{DISTRIBUTOR_ID}/operations-intelligence",
            timeout=30,
        ).json()
        valid = {"stars", "cash_cows", "growth_opps", "at_risk"}
        for m in body["performance_matrix"]:
            assert m["quadrant"] in valid
            assert "revenue_90d" in m and "growth_pct" in m

    def test_quadrant_counts_match_matrix(self, client):
        body = client.get(
            f"{BASE_URL}/api/distributor/{DISTRIBUTOR_ID}/operations-intelligence",
            timeout=30,
        ).json()
        counts = body["quadrant_counts"]
        actual = {k: 0 for k in counts}
        for m in body["performance_matrix"]:
            actual[m["quadrant"]] = actual.get(m["quadrant"], 0) + 1
        assert counts == actual

    def test_inventory_health_donut(self, client):
        body = client.get(
            f"{BASE_URL}/api/distributor/{DISTRIBUTOR_ID}/operations-intelligence",
            timeout=30,
        ).json()
        h = body["inventory_health"]
        assert "donut" in h and isinstance(h["donut"], list)
        for slice_ in h["donut"]:
            assert "label" in slice_ and "value" in slice_ and "color" in slice_

    def test_order_pipeline_keys(self, client):
        body = client.get(
            f"{BASE_URL}/api/distributor/{DISTRIBUTOR_ID}/operations-intelligence",
            timeout=30,
        ).json()
        for k in ("pending", "approved", "dispatched", "delivered_30d"):
            assert k in body["order_pipeline"]

    def test_network_health_band(self, client):
        body = client.get(
            f"{BASE_URL}/api/distributor/{DISTRIBUTOR_ID}/operations-intelligence",
            timeout=30,
        ).json()
        nh = body["network_health"]
        assert 0 <= nh["score"] <= 100
        assert nh["band"] in ("excellent", "good", "fair", "critical")

    def test_unknown_distributor_404(self, client):
        r = client.post(
            f"{BASE_URL}/api/distributor/00000000-0000-0000-0000-000000000000/operations-intelligence/refresh",
            timeout=30,
        )
        assert r.status_code == 404

    def test_snapshot_envelope_present(self, client):
        body = client.get(
            f"{BASE_URL}/api/distributor/{DISTRIBUTOR_ID}/operations-intelligence",
            timeout=30,
        ).json()
        snap = body.get("_snapshot")
        assert snap is not None
        assert snap.get("kind") == "distributor-os"

    def test_refresh_returns_fresh(self, client):
        r = client.post(
            f"{BASE_URL}/api/distributor/{DISTRIBUTOR_ID}/operations-intelligence/refresh",
            timeout=30,
        )
        assert r.status_code == 200
        body = r.json()
        assert body.get("_snapshot", {}).get("fresh") is True
