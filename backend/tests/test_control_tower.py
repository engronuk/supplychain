"""Backend tests for Logistics Control Tower endpoints (Phase 1)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://supply-chain-hub-189.preview.emergentagent.com").rstrip("/")
PASS = "TradeKonekt2026!"


def _login(email: str) -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": PASS}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def mfr_headers():
    return {"Authorization": f"Bearer {_login('flour.admin@tradekonekt.io')}"}


@pytest.fixture(scope="module")
def dist_headers():
    return {"Authorization": f"Bearer {_login('lagos.distributor@tradekonekt.io')}"}


@pytest.fixture(scope="module")
def who_headers():
    return {"Authorization": f"Bearer {_login('unilever.wholesaler@tradekonekt.io')}"}


# --- /api/logistics/control-tower ------------------------------------------
class TestControlTower:
    def test_payload_shape(self, mfr_headers):
        r = requests.get(f"{BASE_URL}/api/logistics/control-tower",
                         headers=mfr_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        # KPIs
        kpis = data["kpis"]
        for k in ["active_shipments", "delayed", "deviations_active",
                  "breakdowns_active", "geofence_events_today",
                  "in_transit_units", "on_time_pct", "unacked_critical",
                  "fleet_active", "fleet_total"]:
            assert k in kpis, f"missing kpi {k}"
        # Lists / dicts present
        assert isinstance(data["fleet"], list)
        assert isinstance(data["shipments"], list)
        ti = data["tier_inventory"]
        for t in ["warehouse", "in_transit", "distributor", "wholesaler", "retailer"]:
            assert t in ti
        twin = data["digital_twin"]
        assert "warehouses" in twin and isinstance(twin["warehouses"], list)
        assert "distributors" in twin and isinstance(twin["distributors"], list)
        assert "wholesalers" in twin and isinstance(twin["wholesalers"], list)
        assert isinstance(data["retailer_clusters"], list)
        assert isinstance(data["events"], list)

    def test_warehouse_has_utilization(self, mfr_headers):
        r = requests.get(f"{BASE_URL}/api/logistics/control-tower",
                         headers=mfr_headers, timeout=30)
        data = r.json()
        for w in data["digital_twin"]["warehouses"]:
            assert "utilization_pct" in w
            assert "lat" in w and "lng" in w

    def test_distributor_403(self, dist_headers):
        r = requests.get(f"{BASE_URL}/api/logistics/control-tower",
                         headers=dist_headers, timeout=20)
        assert r.status_code == 403, f"distributor must get 403, got {r.status_code}"

    def test_wholesaler_403(self, who_headers):
        r = requests.get(f"{BASE_URL}/api/logistics/control-tower",
                         headers=who_headers, timeout=20)
        assert r.status_code == 403


# --- /api/logistics/events --------------------------------------------------
class TestEvents:
    def test_list_default(self, mfr_headers):
        r = requests.get(f"{BASE_URL}/api/logistics/events",
                         headers=mfr_headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "events" in data and isinstance(data["events"], list)
        assert "category_counts" in data and isinstance(data["category_counts"], dict)

    def test_filter_severity(self, mfr_headers):
        r = requests.get(f"{BASE_URL}/api/logistics/events?severity=critical&limit=20",
                         headers=mfr_headers, timeout=20)
        assert r.status_code == 200
        for ev in r.json()["events"]:
            assert ev.get("severity") == "critical"

    def test_filter_category(self, mfr_headers):
        r = requests.get(f"{BASE_URL}/api/logistics/events?category=route&limit=20",
                         headers=mfr_headers, timeout=20)
        assert r.status_code == 200
        for ev in r.json()["events"]:
            assert ev.get("category") == "route"

    def test_ack_404(self, mfr_headers):
        r = requests.post(f"{BASE_URL}/api/logistics/events/__nope__/ack",
                          headers=mfr_headers, timeout=20)
        assert r.status_code == 404

    def test_ack_real_event(self, mfr_headers):
        r = requests.get(f"{BASE_URL}/api/logistics/events?limit=80",
                         headers=mfr_headers, timeout=20)
        events = r.json()["events"]
        unacked = next((e for e in events if not e.get("acknowledged")), None)
        if not unacked:
            pytest.skip("No unacked event available")
        eid = unacked["id"]
        ack = requests.post(f"{BASE_URL}/api/logistics/events/{eid}/ack",
                            headers=mfr_headers, timeout=20)
        assert ack.status_code == 200
        assert ack.json().get("acknowledged") is True


# --- /api/logistics/shipment-timeline/{id} ----------------------------------
class TestShipmentTimeline:
    def test_404_unknown(self, mfr_headers):
        r = requests.get(f"{BASE_URL}/api/logistics/shipment-timeline/__missing__",
                         headers=mfr_headers, timeout=20)
        assert r.status_code == 404

    def test_real_shipment_timeline(self, mfr_headers):
        ct = requests.get(f"{BASE_URL}/api/logistics/control-tower",
                          headers=mfr_headers, timeout=30).json()
        ships = ct.get("shipments") or []
        if not ships:
            pytest.skip("No shipments to inspect")
        sid = ships[0]["id"]
        r = requests.get(f"{BASE_URL}/api/logistics/shipment-timeline/{sid}",
                         headers=mfr_headers, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["shipment"]["id"] == sid
        assert isinstance(body["timeline"], list)
        # shipment_created milestone should always be present
        types = {e.get("event_type") for e in body["timeline"]}
        assert "shipment_created" in types


# --- /api/logistics/geofences -----------------------------------------------
class TestGeofences:
    def test_list(self, mfr_headers):
        r = requests.get(f"{BASE_URL}/api/logistics/geofences",
                         headers=mfr_headers, timeout=20)
        assert r.status_code == 200
        fences = r.json().get("geofences") or []
        assert isinstance(fences, list)
        # If present, fences should expose lat/lng/radius_m
        if fences:
            f = fences[0]
            for k in ["lat", "lng", "radius_m"]:
                assert k in f, f"geofence missing {k}: {f}"


# --- Routing upgrade: google polylines on vehicles -------------------------
class TestRoutingUpgrade:
    def test_vehicles_have_google_polylines(self, mfr_headers):
        ct = requests.get(f"{BASE_URL}/api/logistics/control-tower",
                          headers=mfr_headers, timeout=30).json()
        fleet = ct.get("fleet") or []
        if not fleet:
            pytest.skip("Fleet empty")
        sources = [v.get("route_source") for v in fleet]
        google = sum(1 for s in sources if s == "google")
        # At least 1 google-routed vehicle expected per task description
        assert google >= 1, f"No google-routed vehicles: {sources}"
        gv = next(v for v in fleet if v.get("route_source") == "google")
        poly = gv.get("route_polyline") or []
        assert isinstance(poly, list) and len(poly) > 2
        # Each point should be [lat,lng]
        pt = poly[0]
        assert (isinstance(pt, (list, tuple)) and len(pt) == 2) or \
               (isinstance(pt, dict) and "lat" in pt and "lng" in pt)
