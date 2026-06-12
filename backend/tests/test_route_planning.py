"""Backend tests for Logistics Route Planning Center (Phase 2)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
PASS = "TradeKonekt2026!"
ROOT = f"{BASE_URL}/api/logistics/route-planning"


def _login(email: str) -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": PASS}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
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


@pytest.fixture(scope="module")
def board(mfr_headers):
    r = requests.get(ROOT, headers=mfr_headers, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


# --- Board payload ---------------------------------------------------------
class TestBoard:
    def test_shape(self, board):
        for k in ["pending_shipments", "warehouses", "idle_vehicles",
                  "destinations", "products", "routes", "generated_at"]:
            assert k in board, f"missing key {k}"
        assert isinstance(board["pending_shipments"], list)
        assert isinstance(board["warehouses"], list)
        assert isinstance(board["destinations"], list)

    def test_warehouses_have_coords(self, board):
        assert len(board["warehouses"]) >= 1
        w = board["warehouses"][0]
        for k in ["id", "name", "lat", "lng"]:
            assert k in w

    def test_destinations_have_coords(self, board):
        assert len(board["destinations"]) >= 1
        d = board["destinations"][0]
        for k in ["id", "name", "type", "lat", "lng"]:
            assert k in d
        assert d["type"] in ("distributor", "wholesaler")

    def test_pending_shape(self, board):
        if not board["pending_shipments"]:
            pytest.skip("no pending shipments to inspect")
        s = board["pending_shipments"][0]
        for k in ["id", "to_name", "units", "age_hours", "from_id", "lat", "lng"]:
            assert k in s, f"pending missing {k}"

    def test_routes_progress_fields(self, board):
        # routes list may be empty initially; check shape if any present
        for r in board["routes"]:
            assert "progress_pct" in r
            assert "stops_delivered" in r


# --- Preview validation ----------------------------------------------------
class TestPreviewValidation:
    def test_empty_stops_400(self, mfr_headers, board):
        origin = board["warehouses"][0]["id"]
        r = requests.post(f"{ROOT}/preview",
                          headers=mfr_headers,
                          json={"origin_id": origin, "stops": [], "optimize": True},
                          timeout=30)
        assert r.status_code == 400

    def test_unknown_origin_404(self, mfr_headers, board):
        dest = next(d for d in board["destinations"])
        r = requests.post(f"{ROOT}/preview", headers=mfr_headers, json={
            "origin_id": "nonexistent-origin",
            "stops": [{"dest_id": dest["id"], "dest_type": dest["type"],
                       "items": [{"product_id": board["products"][0]["id"], "quantity": 5}]}],
            "optimize": True,
        }, timeout=30)
        assert r.status_code == 404

    def test_unknown_destination_404(self, mfr_headers, board):
        origin = board["warehouses"][0]["id"]
        r = requests.post(f"{ROOT}/preview", headers=mfr_headers, json={
            "origin_id": origin,
            "stops": [{"dest_id": "nonexistent-dest", "dest_type": "distributor",
                       "items": [{"product_id": board["products"][0]["id"], "quantity": 5}]}],
            "optimize": True,
        }, timeout=30)
        assert r.status_code == 404

    def test_unknown_shipment_404(self, mfr_headers, board):
        origin = board["warehouses"][0]["id"]
        r = requests.post(f"{ROOT}/preview", headers=mfr_headers, json={
            "origin_id": origin,
            "stops": [{"shipment_id": "nonexistent-shipment"}],
            "optimize": True,
        }, timeout=30)
        assert r.status_code == 404

    def test_ad_hoc_without_items_400(self, mfr_headers, board):
        origin = board["warehouses"][0]["id"]
        dest = board["destinations"][0]
        r = requests.post(f"{ROOT}/preview", headers=mfr_headers, json={
            "origin_id": origin,
            "stops": [{"dest_id": dest["id"], "dest_type": dest["type"], "items": []}],
            "optimize": True,
        }, timeout=30)
        assert r.status_code == 400

    def test_too_many_stops_400(self, mfr_headers, board):
        origin = board["warehouses"][0]["id"]
        prod = board["products"][0]["id"]
        dests = board["destinations"][:1] * 9  # 9 stops
        stops = [{"dest_id": d["id"], "dest_type": d["type"],
                  "items": [{"product_id": prod, "quantity": 1}]} for d in dests]
        r = requests.post(f"{ROOT}/preview", headers=mfr_headers,
                          json={"origin_id": origin, "stops": stops, "optimize": True},
                          timeout=30)
        assert r.status_code == 400

    def test_shipment_from_different_warehouse_400(self, mfr_headers, board):
        # Find a shipment and use a different warehouse as origin
        if len(board["warehouses"]) < 1 or not board["pending_shipments"]:
            pytest.skip("need pending shipments + warehouse")
        ship = board["pending_shipments"][0]
        # pick a different warehouse id (or fabricate by reversing)
        other_origin = None
        for w in board["warehouses"]:
            if w["id"] != ship["from_id"]:
                other_origin = w["id"]
                break
        if not other_origin:
            pytest.skip("only one warehouse available")
        r = requests.post(f"{ROOT}/preview", headers=mfr_headers, json={
            "origin_id": other_origin,
            "stops": [{"shipment_id": ship["id"]}],
            "optimize": True,
        }, timeout=30)
        assert r.status_code == 400


# --- Preview happy path ----------------------------------------------------
class TestPreview:
    def test_adhoc_preview_returns_google_route(self, mfr_headers, board):
        origin = board["warehouses"][0]["id"]
        prod = board["products"][0]["id"]
        # Two distinct destinations for an actual multi-stop route
        dests = []
        seen = set()
        for d in board["destinations"]:
            key = (d.get("city"), d.get("region"))
            if key not in seen:
                seen.add(key)
                dests.append(d)
            if len(dests) >= 2:
                break
        if len(dests) < 2:
            dests = board["destinations"][:2]
        stops = [{"dest_id": d["id"], "dest_type": d["type"],
                  "items": [{"product_id": prod, "quantity": 5}]} for d in dests]
        r = requests.post(f"{ROOT}/preview", headers=mfr_headers,
                          json={"origin_id": origin, "stops": stops, "optimize": True},
                          timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ["stops", "total_km", "total_min", "total_units",
                  "polyline", "source", "optimized"]:
            assert k in data, f"missing {k}"
        assert isinstance(data["polyline"], list) and len(data["polyline"]) >= 2
        # Sequence + cumulative fields
        for st in data["stops"]:
            for k in ["seq", "leg_km", "leg_min", "cum_km", "cum_min", "threshold"]:
                assert k in st, f"stop missing {k}"
        assert data["stops"][-1]["threshold"] == 1.0
        # Accept google or estimate; warn if not google
        assert data["source"] in ("google", "estimate")


# --- Dispatch (ad-hoc only — won't consume seeded pending pool) -----------
class TestDispatch:
    @pytest.fixture(scope="class")
    def dispatched(self, mfr_headers, board):
        origin = board["warehouses"][0]["id"]
        prod = board["products"][0]["id"]
        dest = board["destinations"][0]
        # pick an idle vehicle to also test reuse path
        idle = board["idle_vehicles"][0] if board["idle_vehicles"] else None
        payload = {
            "origin_id": origin,
            "stops": [{"dest_id": dest["id"], "dest_type": dest["type"],
                       "items": [{"product_id": prod, "quantity": 3}]}],
            "optimize": True,
        }
        if idle:
            payload["vehicle_id"] = idle["id"]
        r = requests.post(f"{ROOT}/dispatch", headers=mfr_headers,
                          json=payload, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "route" in data and "vehicle_code" in data
        assert data["route"]["code"].startswith("RT-")
        return data

    def test_dispatch_response(self, dispatched):
        route = dispatched["route"]
        assert route["status"] == "dispatched"
        assert len(route["stops"]) >= 1
        assert route["total_units"] >= 1

    def test_route_detail_endpoint(self, mfr_headers, dispatched):
        rid = dispatched["route"]["id"]
        r = requests.get(f"{ROOT}/routes/{rid}", headers=mfr_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["route"]["id"] == rid
        assert isinstance(data["events"], list)
        # Expect at least route_planned, vehicle_dispatched, shipment_loaded
        types = {e.get("event_type") for e in data["events"]}
        assert "route_planned" in types
        assert "vehicle_dispatched" in types
        assert "shipment_loaded" in types
        # vehicle present (reused or new)
        assert data["vehicle"] is not None

    def test_route_detail_404(self, mfr_headers):
        r = requests.get(f"{ROOT}/routes/nonexistent-route-id",
                         headers=mfr_headers, timeout=30)
        assert r.status_code == 404

    def test_vehicle_reuse_not_idle_400(self, mfr_headers, board, dispatched):
        # After dispatching with idle vehicle, the vehicle is now in_transit.
        # Try to reuse the now-dispatched vehicle → must 400.
        used_vid = dispatched["route"].get("vehicle_id")
        if not used_vid:
            pytest.skip("no vehicle_id in dispatched route")
        origin = board["warehouses"][0]["id"]
        prod = board["products"][0]["id"]
        dest = board["destinations"][0]
        r = requests.post(f"{ROOT}/dispatch", headers=mfr_headers, json={
            "origin_id": origin,
            "stops": [{"dest_id": dest["id"], "dest_type": dest["type"],
                       "items": [{"product_id": prod, "quantity": 1}]}],
            "vehicle_id": used_vid,
            "optimize": True,
        }, timeout=30)
        assert r.status_code == 400


# --- Tenant security -------------------------------------------------------
class TestTenantSecurity:
    @pytest.mark.parametrize("role_fixture", ["dist_headers", "who_headers"])
    def test_board_forbidden(self, role_fixture, request):
        h = request.getfixturevalue(role_fixture)
        r = requests.get(ROOT, headers=h, timeout=20)
        assert r.status_code == 403

    @pytest.mark.parametrize("role_fixture", ["dist_headers", "who_headers"])
    def test_preview_forbidden(self, role_fixture, request):
        h = request.getfixturevalue(role_fixture)
        r = requests.post(f"{ROOT}/preview", headers=h,
                          json={"origin_id": "x", "stops": []}, timeout=20)
        assert r.status_code == 403

    @pytest.mark.parametrize("role_fixture", ["dist_headers", "who_headers"])
    def test_dispatch_forbidden(self, role_fixture, request):
        h = request.getfixturevalue(role_fixture)
        r = requests.post(f"{ROOT}/dispatch", headers=h,
                          json={"origin_id": "x", "stops": []}, timeout=20)
        assert r.status_code == 403

    @pytest.mark.parametrize("role_fixture", ["dist_headers", "who_headers"])
    def test_route_detail_forbidden(self, role_fixture, request):
        h = request.getfixturevalue(role_fixture)
        r = requests.get(f"{ROOT}/routes/anything", headers=h, timeout=20)
        assert r.status_code == 403
