"""Pytest suite for the Distributor Network Intelligence Center endpoint."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001")
MANUFACTURER_ID = "b21c1dbe-1a6f-4c33-b036-f416579455d0"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    yield s


class TestDistributorNetwork:
    """Full executive dashboard for the manufacturer's distributor network."""

    def test_endpoint_200(self, client):
        r = client.get(
            f"{BASE_URL}/api/manufacturer/{MANUFACTURER_ID}/distributor-network-intelligence",
            timeout=30,
        )
        assert r.status_code == 200, r.text

    def test_payload_shape(self, client):
        body = client.get(
            f"{BASE_URL}/api/manufacturer/{MANUFACTURER_ID}/distributor-network-intelligence",
            timeout=30,
        ).json()
        for k in ("kpis", "performance_matrix", "regional_coverage", "ai_brief",
                  "spotlight", "distributors_table", "retail_reach", "at_risk"):
            assert k in body, f"missing {k}"

    def test_six_kpis(self, client):
        body = client.get(
            f"{BASE_URL}/api/manufacturer/{MANUFACTURER_ID}/distributor-network-intelligence",
            timeout=30,
        ).json()
        for k in ("active_distributors", "retailers_served", "network_revenue_90d",
                  "inventory_units", "avg_sell_through", "at_risk"):
            assert k in body["kpis"], f"missing kpi {k}"
            assert "value" in body["kpis"][k]
            assert "spark" in body["kpis"][k]

    def test_regional_six_zones(self, client):
        body = client.get(
            f"{BASE_URL}/api/manufacturer/{MANUFACTURER_ID}/distributor-network-intelligence",
            timeout=30,
        ).json()
        regions = {r["region"] for r in body["regional_coverage"]}
        assert {"North West", "North East", "North Central",
                "South West", "South East", "South South"}.issubset(regions)

    def test_wrong_manufacturer_404(self, client):
        r = client.get(
            f"{BASE_URL}/api/manufacturer/00000000-0000-0000-0000-000000000000/distributor-network-intelligence",
            timeout=15,
        )
        assert r.status_code == 404

    def test_table_rows_have_health_score(self, client):
        body = client.get(
            f"{BASE_URL}/api/manufacturer/{MANUFACTURER_ID}/distributor-network-intelligence",
            timeout=30,
        ).json()
        for r in body["distributors_table"][:5]:
            assert 0 <= r["health_score"] <= 100
            assert r["health_band"] in ("excellent", "good", "fair", "poor", "critical")

    def test_at_risk_kpi_matches_list(self, client):
        body = client.get(
            f"{BASE_URL}/api/manufacturer/{MANUFACTURER_ID}/distributor-network-intelligence",
            timeout=30,
        ).json()
        # At-risk KPI should reflect the actionable list, not the entire network
        assert body["kpis"]["at_risk"]["value"] == len(body["at_risk"])
