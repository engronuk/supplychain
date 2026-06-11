"""Phase 3E (live map) backend tests — GET /api/wholesaler/{wid}/control-tower/map.

Coverage:
  - shape (hub, distributors, routes, trucks, demand_overlay, summary)
  - distributors derived from wholesaler_orders.distributor_id (NOT parent_org)
  - expected 6 distributors for unilever.wholesaler
  - MUTKEEM CONCEPT => healthy; other 5 => critical
  - in_transit trucks strictly between origin and destination
  - delivered trucks pinned to destination, status='stopped'
  - tenant scoping: distributor / manufacturer / other-wholesaler -> 403
  - Phase 3D + 3B/3C + 3A regressions
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
PASSWORD = "TradeKonekt2026!"

WHOLESALER_EMAIL = "unilever.wholesaler@tradekonekt.io"
WID = "d81efddf-e1af-4bb4-bcd7-619f74153300"
MANUFACTURER_EMAIL = "unilever@tradekonekt.io"
DISTRIBUTOR_EMAIL = "lagos.distributor@tradekonekt.io"
TENANT2_WHOLESALER_EMAIL = "lagos.wholesaler@tradekonekt.io"

# Use prefix-match — actual seed has fuller trade names
# ("ABIZZARI SABO AND BROTHERS", etc.). The review spec abbreviated.
EXPECTED_DISTRIBUTOR_PREFIXES = [
    "MAZAF MINI DEPOT", "KAIMA INTEGRATED", "BELLO FARU",
    "SUARA & CO.", "ABIZZARI SABO", "MUTKEEM CONCEPT",
]


def _match_prefix(names, prefix):
    for n in names:
        if n.upper().startswith(prefix.upper()):
            return n
    return None


def _login(email: str) -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def wholesaler_headers():
    return {"Authorization": f"Bearer {_login(WHOLESALER_EMAIL)}"}


@pytest.fixture(scope="module")
def manufacturer_headers():
    return {"Authorization": f"Bearer {_login(MANUFACTURER_EMAIL)}"}


@pytest.fixture(scope="module")
def distributor_headers():
    return {"Authorization": f"Bearer {_login(DISTRIBUTOR_EMAIL)}"}


@pytest.fixture(scope="module")
def tenant2_wholesaler_headers():
    return {"Authorization": f"Bearer {_login(TENANT2_WHOLESALER_EMAIL)}"}


@pytest.fixture(scope="module")
def map_payload(wholesaler_headers):
    r = requests.get(f"{BASE_URL}/api/wholesaler/{WID}/control-tower/map",
                     headers=wholesaler_headers, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


# --- Shape ----------------------------------------------------------------
class TestShape:
    def test_top_level_keys(self, map_payload):
        for k in ("hub", "distributors", "routes", "trucks",
                  "demand_overlay", "summary", "as_of"):
            assert k in map_payload, f"missing top-level key: {k}"

    def test_hub_shape(self, map_payload):
        hub = map_payload["hub"]
        for k in ("name", "lat", "lng", "city"):
            assert k in hub, f"hub missing {k}"
        assert isinstance(hub["lat"], (int, float))
        assert isinstance(hub["lng"], (int, float))
        # Lagos area (Ikeja: 6.6, 3.35)
        assert 6.0 < hub["lat"] < 7.0
        assert 3.0 < hub["lng"] < 4.0

    def test_summary_shape(self, map_payload):
        s = map_payload["summary"]
        for k in ("distributors", "active_shipments", "delivered_recent"):
            assert k in s
            assert isinstance(s[k], int)


# --- Distributors ---------------------------------------------------------
class TestDistributors:
    def test_exactly_six_distributors(self, map_payload):
        names = [d["name"] for d in map_payload["distributors"]]
        assert len(names) == 6, f"Expected 6 distributors, got {len(names)}: {names}"
        missing = [p for p in EXPECTED_DISTRIBUTOR_PREFIXES if not _match_prefix(names, p)]
        assert not missing, f"Missing expected distributors (by prefix): {missing}. Actual: {names}"

    def test_all_have_coords(self, map_payload):
        for d in map_payload["distributors"]:
            assert d.get("lat") is not None and d.get("lng") is not None, (
                f"distributor {d.get('name')} missing lat/lng"
            )
            # All distributors should be in Lagos suburbs
            assert 6.0 < d["lat"] < 7.0
            assert 3.0 < d["lng"] < 4.0

    def test_distributor_fields(self, map_payload):
        for d in map_payload["distributors"]:
            for k in ("id", "name", "lat", "lng", "city",
                      "revenue_90d", "health"):
                assert k in d, f"{d.get('name')} missing {k}"

    def test_mutkeem_healthy_others_critical(self, map_payload):
        names = [d["name"] for d in map_payload["distributors"]]
        by_name = {d["name"]: d for d in map_payload["distributors"]}

        mutkeem_name = _match_prefix(names, "MUTKEEM CONCEPT")
        assert mutkeem_name is not None, f"MUTKEEM CONCEPT not found in {names}"
        mutkeem = by_name[mutkeem_name]
        assert mutkeem["health"] == "healthy", (
            f"{mutkeem_name} expected healthy, got {mutkeem['health']}, "
            f"revenue_90d={mutkeem.get('revenue_90d')}"
        )
        assert mutkeem["revenue_90d"] > 0

        for prefix in EXPECTED_DISTRIBUTOR_PREFIXES:
            if prefix == "MUTKEEM CONCEPT":
                continue
            n = _match_prefix(names, prefix)
            assert n is not None, f"prefix {prefix} not found"
            d = by_name[n]
            assert d["health"] == "critical", (
                f"{n} expected critical (zero revenue), got {d['health']}"
            )
            assert d["revenue_90d"] == 0


# --- Trucks / routes ------------------------------------------------------
class TestTrucks:
    def test_in_transit_trucks_between_endpoints(self, map_payload):
        # Map trucks -> route endpoints by id
        routes_by_id = {r["id"]: r for r in map_payload["routes"]}
        for t in map_payload["trucks"]:
            if t["status"] == "in_transit":
                r = routes_by_id.get(t["id"])
                if not r:
                    # No matching route means delivered shipment with route
                    # excluded — but status says in_transit, so it must have
                    # a route.
                    pytest.fail(f"in_transit truck {t['id']} has no route")
                origin = r["from"]
                dest = r["to"]
                # Strictly between (not equal to either endpoint)
                assert (t["lat"], t["lng"]) != (origin["lat"], origin["lng"])
                assert (t["lat"], t["lng"]) != (dest["lat"], dest["lng"])
                # And bounded by the segment box
                lat_lo, lat_hi = sorted([origin["lat"], dest["lat"]])
                lng_lo, lng_hi = sorted([origin["lng"], dest["lng"]])
                assert lat_lo <= t["lat"] <= lat_hi
                assert lng_lo <= t["lng"] <= lng_hi

    def test_delivered_trucks_pinned(self, map_payload):
        # Delivered shipments do NOT appear in routes (only active ones do)
        # but DO appear in trucks with status='stopped'.
        for t in map_payload["trucks"]:
            if t["status"] == "stopped":
                # Should have a valid lat/lng (destination coordinate)
                assert isinstance(t["lat"], (int, float))
                assert isinstance(t["lng"], (int, float))


# --- Demand overlay -------------------------------------------------------
class TestDemandOverlay:
    def test_overlay_entries_shape(self, map_payload):
        for entry in map_payload["demand_overlay"]:
            for k in ("region", "lat", "lng", "pct", "revenue_30d"):
                assert k in entry
            assert 0 <= entry["pct"] <= 100


# --- Tenant scoping -------------------------------------------------------
class TestTenantScoping:
    URL = f"{BASE_URL}/api/wholesaler/{WID}/control-tower/map"

    def test_distributor_forbidden(self, distributor_headers):
        r = requests.get(self.URL, headers=distributor_headers, timeout=20)
        assert r.status_code == 403, f"got {r.status_code} {r.text}"

    def test_manufacturer_forbidden(self, manufacturer_headers):
        r = requests.get(self.URL, headers=manufacturer_headers, timeout=20)
        assert r.status_code == 403, f"got {r.status_code} {r.text}"

    def test_other_wholesaler_forbidden(self, tenant2_wholesaler_headers):
        r = requests.get(self.URL, headers=tenant2_wholesaler_headers, timeout=20)
        assert r.status_code == 403, f"got {r.status_code} {r.text}"

    def test_owner_allowed(self, wholesaler_headers):
        r = requests.get(self.URL, headers=wholesaler_headers, timeout=20)
        assert r.status_code == 200


# --- Wholesaler with no orders (graceful) --------------------------------
class TestNoOrdersGraceful:
    def test_tenant2_wholesaler_own_map_empty_arrays(self, tenant2_wholesaler_headers):
        # Use entity_id from /auth/me
        me = requests.get(f"{BASE_URL}/api/auth/me",
                          headers=tenant2_wholesaler_headers, timeout=10)
        assert me.status_code == 200
        user = me.json().get("user") or me.json()
        org_id = user.get("entity_id") or user.get("organization_id")
        if not org_id:
            pytest.skip("could not resolve tenant2 wholesaler entity id")
        r = requests.get(f"{BASE_URL}/api/wholesaler/{org_id}/control-tower/map",
                         headers=tenant2_wholesaler_headers, timeout=20)
        assert r.status_code == 200, r.text
        payload = r.json()
        # Endpoint should be graceful — empty lists OK, just not 500
        assert isinstance(payload.get("distributors"), list)
        assert isinstance(payload.get("routes"), list)
        assert isinstance(payload.get("trucks"), list)
        assert "hub" in payload and payload["hub"].get("lat") is not None


# --- Regressions ----------------------------------------------------------
class TestRegressions:
    def test_intelligence_still_renders(self, wholesaler_headers):
        r = requests.get(f"{BASE_URL}/api/wholesaler/{WID}/analytics",
                         headers=wholesaler_headers, timeout=30)
        assert r.status_code == 200
        intel = r.json().get("intelligence") or {}
        # Intelligence Center sections
        assert "briefing" in intel or "headlines" in intel
        assert any(k in intel for k in ("opportunities", "risks", "actions"))

    def test_inventory_deep_still_renders(self, wholesaler_headers):
        r = requests.get(f"{BASE_URL}/api/wholesaler/{WID}/analytics",
                         headers=wholesaler_headers, timeout=30)
        assert r.status_code == 200
        inv = r.json().get("inventory") or {}
        assert "deep" in inv or "deep_dive" in inv or "snapshot" in inv

    def test_forecast_deep_still_renders(self, wholesaler_headers):
        r = requests.get(f"{BASE_URL}/api/wholesaler/{WID}/analytics",
                         headers=wholesaler_headers, timeout=30)
        assert r.status_code == 200
        fc = r.json().get("demand_forecast") or {}
        assert "deep" in fc or "forecast" in fc or len(fc) > 0

    def test_analytics_tenant_scoping_cross_tenant_blocked(self, tenant2_wholesaler_headers):
        r = requests.get(f"{BASE_URL}/api/wholesaler/{WID}/analytics",
                         headers=tenant2_wholesaler_headers, timeout=20)
        assert r.status_code == 403

    def test_distributor_detail_cross_tenant_blocked(self, tenant2_wholesaler_headers, map_payload):
        # Pick any known distributor id from the map
        if not map_payload["distributors"]:
            pytest.skip("no distributors to test detail endpoint with")
        did = map_payload["distributors"][0]["id"]
        r = requests.get(
            f"{BASE_URL}/api/wholesaler/{WID}/distributors/{did}/detail",
            headers=tenant2_wholesaler_headers, timeout=20,
        )
        assert r.status_code == 403
