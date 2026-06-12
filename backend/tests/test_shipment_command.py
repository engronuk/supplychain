"""Pytest suite for the Shipment Command Center endpoints."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001")
MANUFACTURER_ID = "b21c1dbe-1a6f-4c33-b036-f416579455d0"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    # Snapshots compute in the background; warm up before any shape assertions.
    import time
    deadline = time.time() + 180
    while True:
        body = s.get(
            f"{BASE_URL}/api/manufacturer/{MANUFACTURER_ID}/shipment-command-center",
            timeout=30,
        ).json()
        if not (body.get("_snapshot") or {}).get("computing"):
            break
        assert time.time() < deadline, "snapshot still computing after 180s"
        time.sleep(5)
    yield s


class TestShipmentCommand:
    def test_endpoint_200(self, client):
        r = client.get(
            f"{BASE_URL}/api/manufacturer/{MANUFACTURER_ID}/shipment-command-center",
            timeout=30,
        )
        assert r.status_code == 200, r.text

    def test_payload_shape(self, client):
        body = client.get(
            f"{BASE_URL}/api/manufacturer/{MANUFACTURER_ID}/shipment-command-center",
            timeout=30,
        ).json()
        for k in ("kpis", "ai_brief", "pipeline", "regional",
                  "distributor_performance", "exceptions", "shipments"):
            assert k in body, f"missing {k}"

    def test_six_kpis(self, client):
        body = client.get(
            f"{BASE_URL}/api/manufacturer/{MANUFACTURER_ID}/shipment-command-center",
            timeout=30,
        ).json()
        for k in ("pending_dispatch", "in_transit", "delivered", "delayed",
                  "shipment_value", "fill_rate"):
            assert k in body["kpis"]
            assert "value" in body["kpis"][k]
            assert "spark" in body["kpis"][k]

    def test_pipeline_keys(self, client):
        body = client.get(
            f"{BASE_URL}/api/manufacturer/{MANUFACTURER_ID}/shipment-command-center",
            timeout=30,
        ).json()
        for k in ("pending_dispatch", "in_transit", "delivered", "delayed", "total"):
            assert k in body["pipeline"]

    def test_regional_six_zones(self, client):
        body = client.get(
            f"{BASE_URL}/api/manufacturer/{MANUFACTURER_ID}/shipment-command-center",
            timeout=30,
        ).json()
        regions = {r["region"] for r in body["regional"]}
        assert {"North West", "North East", "North Central",
                "South West", "South East", "South South"}.issubset(regions)

    def test_ai_brief(self, client):
        body = client.get(
            f"{BASE_URL}/api/manufacturer/{MANUFACTURER_ID}/shipment-command-center",
            timeout=30,
        ).json()
        assert isinstance(body["ai_brief"]["insights"], list)
        assert isinstance(body["ai_brief"]["recommended_actions"], list)
        assert len(body["ai_brief"]["recommended_actions"]) >= 1

    def test_wrong_manufacturer_404(self, client):
        r = client.get(
            f"{BASE_URL}/api/manufacturer/00000000-0000-0000-0000-000000000000/shipment-command-center",
            timeout=15,
        )
        assert r.status_code == 404


class TestShipmentIntelligence:
    def test_drawer_payload(self, client):
        # Pull a real shipment id from the list
        body = client.get(
            f"{BASE_URL}/api/manufacturer/{MANUFACTURER_ID}/shipment-command-center",
            timeout=30,
        ).json()
        assert body["shipments"], "expected at least one shipment in demo data"
        ship_id = body["shipments"][0]["id"]

        d = client.get(
            f"{BASE_URL}/api/manufacturer/{MANUFACTURER_ID}/shipment-intelligence/{ship_id}",
            timeout=30,
        )
        assert d.status_code == 200
        body = d.json()
        for k in ("shipment", "route", "overview", "manifest", "health",
                  "compliance", "acknowledgement", "ai_recommendations"):
            assert k in body
        assert "overall" in body["health"]
        assert isinstance(body["manifest"], list)

    def test_404_unknown_shipment(self, client):
        r = client.get(
            f"{BASE_URL}/api/manufacturer/{MANUFACTURER_ID}/shipment-intelligence/00000000-0000-0000-0000-000000000000",
            timeout=15,
        )
        assert r.status_code == 404
