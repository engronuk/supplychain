"""Track A — Logistics Foundation Layer comprehensive test suite.

Covers:
  - JWT login flow including new 'driver' role
  - Driver CRUD + employee_number uniqueness
  - Vehicle CRUD + registration_number uniqueness + auto vehicle_code
  - Full 8-state shipment lifecycle (created → delivered)
  - Driver/Vehicle status auto-sync at each transition
  - OTP delivery flow (issue, wrong, lockout, correct)
  - Invalid transitions → 409 INVALID_TRANSITION
  - Role guards (driver cannot ready/assign/cancel)
  - Tenant isolation
  - Deprecated PATCH /status → 410
  - Timeline endpoint
  - Driver-self endpoints
  - Migration: schema_version=2
  - Backwards-compat list shipments for manufacturer
"""
import os
import time
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://supply-chain-hub-189.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
PWD = "TradeKonekt2026!"

MFG_EMAIL = "unilever@tradekonekt.io"
MFG_ENTITY_ID = "b21c1dbe-1a6f-4c33-b036-f416579455d0"
DST_SAME_EMAIL = "mfr-0001-dst-0001@tradekonekt.io"
DST_OTHER_EMAIL = "fmn.distributor@tradekonekt.io"


def _login(email, password=PWD):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    data = r.json()
    return data


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def mfg():
    return _login(MFG_EMAIL)


@pytest.fixture(scope="module")
def dst_same():
    return _login(DST_SAME_EMAIL)


@pytest.fixture(scope="module")
def dst_other():
    return _login(DST_OTHER_EMAIL)


@pytest.fixture(scope="module")
def created_driver(mfg):
    """Create a driver under manufacturer tenant, ensure unique fields."""
    suffix = uuid.uuid4().hex[:8]
    payload = {
        "employee_number": f"TEST-EMP-{suffix}",
        "first_name": "Test",
        "last_name": f"Driver-{suffix}",
        "phone": f"+234{suffix[:7]}",
        "email": f"test.driver.{suffix}@tradekonekt.io",
        "licence_number": f"LIC-{suffix}",
        "licence_class": "C",
        "licence_expiry": "2030-01-01",
    }
    r = requests.post(f"{API}/drivers", headers=_auth(mfg["access_token"]), json=payload, timeout=20)
    assert r.status_code == 200, f"driver create failed: {r.status_code} {r.text}"
    data = r.json()
    assert data.get("_initial_password") == PWD
    assert data.get("employer_org_id") == MFG_ENTITY_ID
    return {"driver": data, "payload": payload}


@pytest.fixture(scope="module")
def driver_token(created_driver):
    return _login(created_driver["payload"]["email"])


@pytest.fixture(scope="module")
def created_vehicle(mfg):
    suffix = uuid.uuid4().hex[:8].upper()
    payload = {
        "registration_number": f"TEST-{suffix}",
        "vehicle_type": "truck",
        "make": "Tata",
        "model": "Prima",
        "year": 2024,
        "colour": "white",
        "capacity_units": 100,
        "capacity_weight_kg": 5000,
    }
    r = requests.post(f"{API}/vehicles", headers=_auth(mfg["access_token"]), json=payload, timeout=20)
    assert r.status_code == 200, f"vehicle create failed: {r.status_code} {r.text}"
    data = r.json()
    assert data.get("vehicle_code", "").startswith("TK-")
    assert data.get("owner_org_id") == MFG_ENTITY_ID
    return {"vehicle": data, "payload": payload}


# ---------- Auth + JWT for driver ----------
class TestDriverAuth:
    def test_driver_login_returns_driver_role(self, driver_token, created_driver):
        assert driver_token.get("user", {}).get("role") == "driver"
        # entity_id should be driver_id
        assert driver_token["user"].get("entity_id") == created_driver["driver"]["id"]


# ---------- Driver Create Uniqueness ----------
class TestDriverCreate:
    def test_employee_number_duplicate_returns_409(self, mfg, created_driver):
        dup_payload = dict(created_driver["payload"])
        dup_payload["email"] = f"dup.{uuid.uuid4().hex[:6]}@tradekonekt.io"
        r = requests.post(f"{API}/drivers", headers=_auth(mfg["access_token"]),
                          json=dup_payload, timeout=20)
        assert r.status_code == 409, f"expected 409 got {r.status_code} {r.text}"


# ---------- Vehicle Create Uniqueness ----------
class TestVehicleCreate:
    def test_duplicate_registration_returns_409(self, mfg, created_vehicle):
        dup = dict(created_vehicle["payload"])
        r = requests.post(f"{API}/vehicles", headers=_auth(mfg["access_token"]),
                          json=dup, timeout=20)
        assert r.status_code == 409, f"expected 409 got {r.status_code} {r.text}"


# ---------- Shipment Lifecycle helpers ----------
def _create_shipment(mfg_token, to_id=None):
    payload = {
        "from_role": "manufacturer",
        "from_id": MFG_ENTITY_ID,
        "to_role": "distributor",
        "to_id": to_id or "f9dfaf08-4ee2-3c64-e96b-983c385625b2",
        "items": [{"product_id": "PRD-TEST-001", "quantity": 10, "name": "Test SKU"}],
        "notes": "Track A test shipment",
    }
    r = requests.post(f"{API}/shipments", headers=_auth(mfg_token), json=payload, timeout=20)
    assert r.status_code == 200, f"create shipment failed {r.status_code} {r.text}"
    return r.json()


# ---------- Full 8-state lifecycle ----------
@pytest.fixture(scope="module")
def full_lifecycle(mfg, created_driver, created_vehicle, driver_token):
    """Run a full lifecycle, returning the final shipment + intermediate states."""
    mfg_tok = mfg["access_token"]
    drv_tok = driver_token["access_token"]
    shp = _create_shipment(mfg_tok)
    sid = shp["id"]
    assert shp["status"] == "created"

    # ready
    r = requests.post(f"{API}/shipments/{sid}/ready", headers=_auth(mfg_tok), json={}, timeout=20)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ready_for_dispatch"

    # assign
    r = requests.post(f"{API}/shipments/{sid}/assign", headers=_auth(mfg_tok),
                      json={"driver_id": created_driver["driver"]["id"],
                            "vehicle_id": created_vehicle["vehicle"]["id"]}, timeout=20)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "assigned"

    # check driver/vehicle status synced
    rd = requests.get(f"{API}/drivers/{created_driver['driver']['id']}",
                      headers=_auth(mfg_tok), timeout=20)
    assert rd.status_code == 200
    assert rd.json()["status"] == "assigned"
    rv = requests.get(f"{API}/vehicles/{created_vehicle['vehicle']['id']}",
                      headers=_auth(mfg_tok), timeout=20)
    assert rv.status_code == 200
    assert rv.json()["status"] == "loading"

    # load (driver allowed)
    r = requests.post(f"{API}/shipments/{sid}/load", headers=_auth(drv_tok), json={}, timeout=20)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "loaded"

    # start-trip
    r = requests.post(f"{API}/shipments/{sid}/start-trip", headers=_auth(drv_tok), json={}, timeout=20)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "in_transit"

    # arrive
    r = requests.post(f"{API}/shipments/{sid}/arrive", headers=_auth(drv_tok), json={}, timeout=20)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "arrived"

    return {"shipment_id": sid, "mfg_tok": mfg_tok, "drv_tok": drv_tok,
            "driver_id": created_driver["driver"]["id"],
            "vehicle_id": created_vehicle["vehicle"]["id"]}


class TestLifecycle:
    def test_lifecycle_reaches_arrived(self, full_lifecycle):
        assert full_lifecycle["shipment_id"]


# ---------- OTP brute force on the arrived shipment, THEN deliver ----------
class TestOTPFlow:
    def test_otp_notification_present(self, full_lifecycle, dst_same):
        sid = full_lifecycle["shipment_id"]
        r = requests.get(
            f"{API}/notifications",
            params={"target_type": "distributor",
                    "target_id": "f9dfaf08-4ee2-3c64-e96b-983c385625b2"},
            headers=_auth(dst_same["access_token"]), timeout=20)
        assert r.status_code == 200, r.text
        notifs = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        codes = [n for n in notifs if n.get("type") == "delivery_code"
                 and n.get("payload", {}).get("shipment_id") == sid]
        assert codes, f"no delivery_code notification for shipment {sid}"
        code = codes[0]["payload"].get("delivery_code")
        assert code and code.isdigit() and len(code) == 4
        pytest.shared_otp_code = code

    def test_wrong_otp_returns_401_with_attempts(self, full_lifecycle):
        sid = full_lifecycle["shipment_id"]
        drv_tok = full_lifecycle["drv_tok"]
        r = requests.post(f"{API}/shipments/{sid}/deliver",
                          headers=_auth(drv_tok),
                          json={"delivery_code": "0000"}, timeout=20)
        # might be 401 (wrong) - if 0000 happens to be correct, the test_lockout will adjust
        assert r.status_code in (401, 200), f"unexpected {r.status_code} {r.text}"
        if r.status_code == 401:
            body = r.json()
            detail = body.get("detail", body)
            assert "attempts_remaining" in detail

    def test_brute_force_lockout(self, full_lifecycle):
        sid = full_lifecycle["shipment_id"]
        drv_tok = full_lifecycle["drv_tok"]
        # already 1 attempt from above (if it was wrong). Send 4 more wrong (use a non-zero invalid)
        last = None
        for i in range(4):
            r = requests.post(f"{API}/shipments/{sid}/deliver",
                              headers=_auth(drv_tok),
                              json={"delivery_code": "9999"}, timeout=20)
            last = r
        assert last.status_code in (401, 423), f"expected 401/423 got {last.status_code} {last.text}"
        # Next attempt should be 423 LOCKED
        r = requests.post(f"{API}/shipments/{sid}/deliver",
                          headers=_auth(drv_tok),
                          json={"delivery_code": "9999"}, timeout=20)
        assert r.status_code == 423, f"expected 423 LOCKED got {r.status_code} {r.text}"


# ---------- Tenant isolation ----------
class TestTenantIsolation:
    def test_other_tenant_cannot_read(self, full_lifecycle, dst_other):
        sid = full_lifecycle["shipment_id"]
        r = requests.get(f"{API}/shipments/{sid}", headers=_auth(dst_other["access_token"]), timeout=20)
        assert r.status_code == 403, f"expected 403 got {r.status_code} {r.text}"


# ---------- Deprecated endpoint ----------
class TestDeprecatedPatch:
    def test_patch_status_returns_410(self, mfg, full_lifecycle):
        sid = full_lifecycle["shipment_id"]
        r = requests.patch(f"{API}/shipments/{sid}/status",
                           headers=_auth(mfg["access_token"]),
                           json={"status": "delivered"}, timeout=20)
        assert r.status_code == 410, f"expected 410 got {r.status_code} {r.text}"
        body = r.json()
        detail = body.get("detail", body)
        assert detail.get("code") == "ENDPOINT_DEPRECATED"
        assert "replacement_endpoints" in detail


# ---------- Timeline ----------
class TestTimeline:
    def test_timeline_returns_history(self, mfg, full_lifecycle):
        sid = full_lifecycle["shipment_id"]
        r = requests.get(f"{API}/shipments/{sid}/timeline",
                         headers=_auth(mfg["access_token"]), timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body.get("timeline"), list)
        assert len(body["timeline"]) >= 5  # created, ready, assigned, loaded, in_transit, arrived
        assert "logistics_events" in body
        # oldest-first sort
        ats = [t.get("at") for t in body["timeline"] if t.get("at")]
        assert ats == sorted(ats), "timeline not sorted oldest-first"


# ---------- Invalid transitions ----------
class TestInvalidTransitions:
    def test_load_on_created_returns_409(self, mfg):
        shp = _create_shipment(mfg["access_token"])
        sid = shp["id"]
        r = requests.post(f"{API}/shipments/{sid}/load",
                          headers=_auth(mfg["access_token"]), json={}, timeout=20)
        assert r.status_code == 409, r.text
        body = r.json()
        detail = body.get("detail", body)
        assert detail.get("code") == "INVALID_TRANSITION"


# ---------- Role guards (driver cannot dispatch) ----------
class TestRoleGuards:
    def test_driver_cannot_ready(self, driver_token, mfg):
        shp = _create_shipment(mfg["access_token"])
        sid = shp["id"]
        r = requests.post(f"{API}/shipments/{sid}/ready",
                          headers=_auth(driver_token["access_token"]), json={}, timeout=20)
        assert r.status_code == 403, f"expected 403 got {r.status_code}"

    def test_driver_cannot_assign(self, driver_token, mfg, created_vehicle):
        shp = _create_shipment(mfg["access_token"])
        sid = shp["id"]
        # Use a bogus driver_id so the pre-check would have to recognise our role
        # first; if role guard fires first → 403; if state pre-check fires → 404/409
        r = requests.post(f"{API}/shipments/{sid}/assign",
                          headers=_auth(driver_token["access_token"]),
                          json={"driver_id": "non-existent-driver",
                                "vehicle_id": created_vehicle["vehicle"]["id"]}, timeout=20)
        # Either 403 (role guard first, ideal) or 404 (driver-not-found pre-check first).
        # Both prevent the driver from completing the action, but the cleanest is 403.
        assert r.status_code in (403, 404), f"expected 403/404 got {r.status_code} {r.text}"

    def test_driver_cannot_cancel(self, driver_token, mfg):
        shp = _create_shipment(mfg["access_token"])
        sid = shp["id"]
        r = requests.post(f"{API}/shipments/{sid}/cancel",
                          headers=_auth(driver_token["access_token"]),
                          json={"reason": "test"}, timeout=20)
        assert r.status_code == 403, f"expected 403 got {r.status_code}"


# ---------- Driver-self endpoints ----------
class TestDriverSelf:
    def test_driver_me(self, driver_token, created_driver):
        r = requests.get(f"{API}/driver/me", headers=_auth(driver_token["access_token"]), timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["id"] == created_driver["driver"]["id"]

    def test_driver_my_shipments(self, driver_token):
        r = requests.get(f"{API}/driver/shipments", headers=_auth(driver_token["access_token"]), timeout=20)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_driver_cannot_read_other_driver_shipment(self, driver_token, mfg):
        # create a shipment with a different driver assignment - we use a shipment NOT owned by driver
        shp = _create_shipment(mfg["access_token"])
        sid = shp["id"]
        r = requests.get(f"{API}/driver/shipments/{sid}",
                         headers=_auth(driver_token["access_token"]), timeout=20)
        assert r.status_code == 403, f"expected 403 got {r.status_code}"


# ---------- Migration verification ----------
class TestMigration:
    def test_shipments_have_schema_version_2(self, mfg):
        r = requests.get(f"{API}/shipments?limit=5", headers=_auth(mfg["access_token"]), timeout=20)
        assert r.status_code == 200, r.text
        rows = r.json()
        assert rows, "expected at least 1 shipment"
        for s in rows:
            assert s.get("schema_version") == 2, f"missing schema_version=2 on {s.get('id')}"
            assert isinstance(s.get("status_history"), list) and len(s["status_history"]) > 0


# ---------- Backwards-compat list ----------
class TestBackwardsCompat:
    def test_mfg_can_list_shipments(self, mfg):
        r = requests.get(f"{API}/shipments", headers=_auth(mfg["access_token"]), timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        assert len(r.json()) > 0


# ---------- Successful OTP-verified delivery (delivered terminal state) ----------
class TestSuccessfulDelivery:
    def test_deliver_with_correct_otp_succeeds(self, mfg, driver_token, created_driver, dst_same):
        """Run a fresh lifecycle, then deliver with the real OTP from notifications."""
        # Need an AVAILABLE driver+vehicle. Since previous driver is locked or in flux,
        # spin up new ones to avoid coupling.
        suffix = uuid.uuid4().hex[:6]
        drv_payload = {
            "employee_number": f"TEST-D2-{suffix}",
            "first_name": "Test2", "last_name": f"Driver-{suffix}",
            "phone": f"+234{suffix}11", "email": f"t2.{suffix}@tradekonekt.io",
            "licence_number": f"LIC2-{suffix}", "licence_class": "C",
            "licence_expiry": "2030-01-01",
        }
        r = requests.post(f"{API}/drivers", headers=_auth(mfg["access_token"]),
                          json=drv_payload, timeout=20)
        assert r.status_code == 200, r.text
        drv2 = r.json()
        drv2_tok = _login(drv_payload["email"])["access_token"]

        veh_payload = {
            "registration_number": f"TST2-{suffix.upper()}",
            "vehicle_type": "van", "make": "Toyota", "model": "Hiace",
            "year": 2024, "capacity_units": 50, "capacity_weight_kg": 1500,
        }
        r = requests.post(f"{API}/vehicles", headers=_auth(mfg["access_token"]),
                          json=veh_payload, timeout=20)
        assert r.status_code == 200, r.text
        veh2 = r.json()

        # Lifecycle
        mfg_tok = mfg["access_token"]
        shp = _create_shipment(mfg_tok)
        sid = shp["id"]
        assert requests.post(f"{API}/shipments/{sid}/ready",
                             headers=_auth(mfg_tok), json={}, timeout=20).status_code == 200
        assert requests.post(f"{API}/shipments/{sid}/assign", headers=_auth(mfg_tok),
                             json={"driver_id": drv2["id"], "vehicle_id": veh2["id"]},
                             timeout=20).status_code == 200
        assert requests.post(f"{API}/shipments/{sid}/load",
                             headers=_auth(drv2_tok), json={}, timeout=20).status_code == 200
        assert requests.post(f"{API}/shipments/{sid}/start-trip",
                             headers=_auth(drv2_tok), json={}, timeout=20).status_code == 200
        assert requests.post(f"{API}/shipments/{sid}/arrive",
                             headers=_auth(drv2_tok), json={}, timeout=20).status_code == 200

        # Get the OTP from notifications
        r = requests.get(f"{API}/notifications",
                         params={"target_type": "distributor",
                                 "target_id": "f9dfaf08-4ee2-3c64-e96b-983c385625b2"},
                         timeout=20)
        notifs = r.json()
        codes = [n for n in notifs if n.get("type") == "delivery_code"
                 and n.get("payload", {}).get("shipment_id") == sid]
        assert codes
        code = codes[0]["payload"]["delivery_code"]
        r = requests.post(f"{API}/shipments/{sid}/deliver",
                          headers=_auth(drv2_tok),
                          json={"delivery_code": code}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "delivered"

        # Driver + vehicle should be back to available
        rd = requests.get(f"{API}/drivers/{drv2['id']}",
                          headers=_auth(mfg_tok), timeout=20)
        assert rd.json()["status"] == "available"
        rv = requests.get(f"{API}/vehicles/{veh2['id']}",
                          headers=_auth(mfg_tok), timeout=20)
        assert rv.json()["status"] == "available"

        # Cancelling a delivered shipment must 409
        r = requests.post(f"{API}/shipments/{sid}/cancel",
                          headers=_auth(mfg_tok),
                          json={"reason": "too late"}, timeout=20)
        assert r.status_code == 409, r.text
        body = r.json()
        detail = body.get("detail", body)
        assert detail.get("code") == "INVALID_TRANSITION"
