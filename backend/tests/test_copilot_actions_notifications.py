"""Phase-3+ tests: Copilot confirm-before-execute actions + notification fan-out.

Run:
  pytest /app/backend/tests/test_copilot_actions_notifications.py -v \
      --tb=short --junitxml=/app/test_reports/pytest/copilot_actions_iter24.xml
"""
from __future__ import annotations

import os
import time
import uuid
import pytest
import requests

def _load_url():
    url = os.environ.get("REACT_APP_BACKEND_URL")
    if not url:
        try:
            with open("/app/frontend/.env") as f:
                for ln in f:
                    if ln.startswith("REACT_APP_BACKEND_URL="):
                        url = ln.split("=", 1)[1].strip()
                        break
        except FileNotFoundError:
            pass
    assert url, "REACT_APP_BACKEND_URL missing"
    return url.rstrip("/")


BASE_URL = _load_url()
EMAIL = "unilever@tradekonekt.io"
PASSWORD = "TradeKonekt2026!"
MFR_ID = "b21c1dbe-1a6f-4c33-b036-f416579455d0"
WH_LAGOS_ID = "2243fd7f-362b-48af-86fb-f866b6d29396"
TIMEOUT = 90


# ---------- fixtures ---------------------------------------------------------
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    tok = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def session_id():
    return f"TEST_copilot_{uuid.uuid4().hex[:8]}"


def _fresh_active_truck(session) -> str:
    r = session.get(f"{BASE_URL}/api/logistics/control-tower", timeout=TIMEOUT)
    assert r.status_code == 200
    fleet = r.json().get("fleet") or []
    active = [v for v in fleet if v.get("status") and v["status"] != "idle"]
    assert active, "No active trucks to test against"
    return active[0]["code"]


def _propose(session, sid, message, retries=4):
    last = None
    for attempt in range(retries):
        r = session.post(f"{BASE_URL}/api/logistics/copilot/chat",
                         json={"message": message, "session_id": sid},
                         timeout=TIMEOUT)
        last = r
        if r.status_code == 200:
            return r.json()
        if r.status_code == 503 and ("rate limit" in r.text or "busy" in r.text):
            time.sleep(20 + attempt * 10)
            continue
        break
    assert last.status_code == 200, last.text
    return last.json()


# ---------- Copilot proposes actions ----------------------------------------
class TestCopilotProposesActions:
    def test_reroute_proposal(self, session, session_id):
        code = _fresh_active_truck(session)
        data = _propose(session, session_id, f"Re-route truck {code}")
        assert "reply" in data and data["reply"]
        act = data.get("action")
        assert act is not None, f"Expected action proposal, got: {data}"
        assert act["type"] == "reroute_vehicle"
        assert act["status"] == "proposed"
        assert act["params"].get("vehicle_code", "").upper() == code.upper()
        assert "id" in act and "summary" in act

    def test_pure_question_no_action(self, session, session_id):
        data = _propose(session, session_id,
                        "How many trucks are active right now?")
        assert data.get("action") is None
        assert data.get("reply")


# ---------- Execute / dismiss -----------------------------------------------
class TestExecuteAndDismiss:
    def test_execute_reroute_and_idempotent(self, session, session_id):
        code = _fresh_active_truck(session)
        prop = _propose(session, session_id, f"Re-route truck {code}")
        assert prop.get("action"), "no action proposed"
        aid = prop["action"]["id"]

        r = session.post(
            f"{BASE_URL}/api/logistics/copilot/actions/{aid}/execute",
            timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        a = r.json()["action"]
        assert a["status"] == "executed"
        assert "result" in a and a["result"].get("message")

        # verify vehicle reset
        ct = session.get(f"{BASE_URL}/api/logistics/control-tower",
                         timeout=TIMEOUT).json()
        v = next((x for x in ct["fleet"] if x["code"] == code), None)
        assert v is not None
        assert (v.get("deviation") in (None, {})) or not (
            v.get("deviation") or {}).get("active")
        assert float(v.get("route_progress") or 0) == 0.0
        assert v.get("eta_minutes") is not None

        # idempotent — second execute returns executed without error
        r2 = session.post(
            f"{BASE_URL}/api/logistics/copilot/actions/{aid}/execute",
            timeout=TIMEOUT)
        assert r2.status_code == 200
        assert r2.json()["action"]["status"] == "executed"

    def test_dismiss_then_execute_400(self, session, session_id):
        code = _fresh_active_truck(session)
        prop = _propose(session, session_id, f"Re-route truck {code}")
        assert prop.get("action")
        aid = prop["action"]["id"]
        r = session.post(
            f"{BASE_URL}/api/logistics/copilot/actions/{aid}/dismiss",
            timeout=TIMEOUT)
        assert r.status_code == 200
        assert r.json()["action"]["status"] == "dismissed"
        r2 = session.post(
            f"{BASE_URL}/api/logistics/copilot/actions/{aid}/execute",
            timeout=TIMEOUT)
        assert r2.status_code == 400


# ---------- dispatch_adhoc + acknowledge_events -----------------------------
class TestDispatchAndAcknowledge:
    def test_dispatch_adhoc_execute(self, session, session_id):
        # Get product + distributor names
        prods = session.get(f"{BASE_URL}/api/products?manufacturer_id={MFR_ID}",
                            timeout=TIMEOUT).json()
        # products may be list-or-paged
        plist = prods if isinstance(prods, list) else (
            prods.get("items") or prods.get("results") or [])
        assert plist, "no products"
        pname = plist[0].get("name") or plist[0].get("product_name")

        dists = session.get(f"{BASE_URL}/api/distributors?manufacturer_id={MFR_ID}",
                            timeout=TIMEOUT).json()
        dlist = dists if isinstance(dists, list) else (
            dists.get("items") or [])
        assert dlist, "no distributors"
        dname = dlist[0]["name"]

        msg = (f"Dispatch 100 units of {pname} from our Lagos warehouse "
               f"to {dname}")
        prop = _propose(session, session_id, msg)
        act = prop.get("action")
        if not act:
            # Gemini may decline if distributor name isn't in the trimmed
            # ACTIONABLE ENTITIES window. Try the next few distributors.
            for fallback in dlist[1:6]:
                prop = _propose(session, session_id,
                                f"Dispatch 100 units of {pname} from our "
                                f"Lagos warehouse to {fallback['name']}")
                if prop.get("action"):
                    act = prop["action"]
                    break
        assert act, f"no dispatch_adhoc proposed: {prop}"
        assert act["type"] == "dispatch_adhoc"
        p = act["params"]
        assert p.get("warehouse_id") and p.get("dest_id") and p.get("items")
        aid = act["id"]
        r = session.post(
            f"{BASE_URL}/api/logistics/copilot/actions/{aid}/execute",
            timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        res = r.json()["action"]
        assert res["status"] == "executed", res
        assert "RT-" in (res["result"]["message"] or "")
        assert "TK-" in (res["result"]["message"] or "")

    def test_acknowledge_events_execute(self, session, session_id):
        prop = _propose(session, session_id, "acknowledge all open events")
        act = prop.get("action")
        assert act and act["type"] == "acknowledge_events", prop
        aid = act["id"]
        r = session.post(
            f"{BASE_URL}/api/logistics/copilot/actions/{aid}/execute",
            timeout=TIMEOUT)
        assert r.status_code == 200
        msg = r.json()["action"]["result"]["message"].lower()
        assert "acknowledge" in msg
        # verify
        evs = session.get(
            f"{BASE_URL}/api/logistics/events?manufacturer_id={MFR_ID}",
            timeout=TIMEOUT).json()
        items = evs if isinstance(evs, list) else (evs.get("items") or evs.get("events") or [])
        unack = [e for e in items if not e.get("acknowledged")]
        assert len(unack) == 0, f"still {len(unack)} unacknowledged"


# ---------- history join ----------------------------------------------------
class TestCopilotHistoryJoin:
    def test_history_includes_action_objects(self, session, session_id):
        r = session.get(
            f"{BASE_URL}/api/logistics/copilot/history?session_id={session_id}",
            timeout=TIMEOUT)
        assert r.status_code == 200
        msgs = r.json().get("messages") or []
        assistant_with_action = [m for m in msgs
                                 if m.get("role") == "assistant" and m.get("action")]
        assert assistant_with_action, "expected assistant msgs to carry action"
        a = assistant_with_action[0]["action"]
        assert a.get("status") in ("proposed", "executed", "dismissed", "failed")
        assert a.get("type") in {
            "reroute_vehicle", "resolve_exception",
            "dispatch_adhoc", "acknowledge_events"}


# ---------- Notifications ---------------------------------------------------
class TestNotifications:
    def test_manufacturer_feed_has_logistics(self, session):
        r = session.get(
            f"{BASE_URL}/api/notifications?target_type=manufacturer"
            f"&target_id={MFR_ID}", timeout=TIMEOUT)
        assert r.status_code == 200
        notifs = r.json()
        assert isinstance(notifs, list) and len(notifs) > 0
        # validate severity field present + at least one logistics type
        types = {n.get("type") for n in notifs}
        assert types & {"route", "vehicle", "delivery", "geofence", "shipment", "system"}, types
        # severity field present on most notifs (older ones may not have it)
        with_sev = sum(1 for n in notifs if "severity" in n)
        assert with_sev > 0, "no notifications carry severity field"

    def test_reroute_emits_new_manufacturer_notification(self, session):
        # Use a different truck to bypass dedupe.
        ct = session.get(f"{BASE_URL}/api/logistics/control-tower",
                         timeout=TIMEOUT).json()
        active = [v for v in ct.get("fleet") or []
                  if v.get("status") and v["status"] != "idle"]
        if len(active) < 2:
            pytest.skip("need >=2 active trucks to bypass dedupe")
        code = active[1]["code"]
        before = session.get(
            f"{BASE_URL}/api/notifications?target_type=manufacturer"
            f"&target_id={MFR_ID}", timeout=TIMEOUT).json()
        before_ids = {n["id"] for n in before}
        sid = f"TEST_copilot_{uuid.uuid4().hex[:8]}"
        prop = _propose(session, sid, f"Re-route truck {code}")
        assert prop.get("action")
        aid = prop["action"]["id"]
        r = session.post(
            f"{BASE_URL}/api/logistics/copilot/actions/{aid}/execute",
            timeout=TIMEOUT)
        assert r.status_code == 200
        time.sleep(2)
        after = session.get(
            f"{BASE_URL}/api/notifications?target_type=manufacturer"
            f"&target_id={MFR_ID}", timeout=TIMEOUT).json()
        new = [n for n in after if n["id"] not in before_ids]
        assert new, "no new manufacturer notification appeared after reroute"
        # at least one is a route-related notification
        assert any(n.get("type") == "route" for n in new), new

    def test_warehouse_feed_after_dispatch(self, session, session_id):
        before = session.get(
            f"{BASE_URL}/api/notifications?target_type=warehouse"
            f"&target_id={WH_LAGOS_ID}", timeout=TIMEOUT).json()
        before_ids = {n["id"] for n in before}

        prods = session.get(f"{BASE_URL}/api/products?manufacturer_id={MFR_ID}",
                            timeout=TIMEOUT).json()
        plist = prods if isinstance(prods, list) else (prods.get("items") or [])
        pname = plist[0].get("name") or plist[0].get("product_name")
        dists = session.get(f"{BASE_URL}/api/distributors?manufacturer_id={MFR_ID}",
                            timeout=TIMEOUT).json()
        dlist = dists if isinstance(dists, list) else (dists.get("items") or [])
        dname = dlist[0]["name"]

        sid = f"TEST_copilot_{uuid.uuid4().hex[:8]}"
        prop = _propose(
            session, sid,
            f"Dispatch 50 units of {pname} from our Lagos warehouse to {dname}")
        act = prop.get("action")
        if not act or act.get("type") != "dispatch_adhoc":
            for fallback in dlist[1:6]:
                prop = _propose(
                    session, sid,
                    f"Dispatch 50 units of {pname} from our Lagos warehouse "
                    f"to {fallback['name']}")
                if prop.get("action") and prop["action"]["type"] == "dispatch_adhoc":
                    act = prop["action"]
                    break
        if not act or act.get("type") != "dispatch_adhoc":
            pytest.skip(f"Copilot didn't propose dispatch_adhoc: {prop.get('reply')}")
        r = session.post(
            f"{BASE_URL}/api/logistics/copilot/actions/{act['id']}/execute",
            timeout=TIMEOUT)
        assert r.status_code == 200
        time.sleep(2)
        after = session.get(
            f"{BASE_URL}/api/notifications?target_type=warehouse"
            f"&target_id={WH_LAGOS_ID}", timeout=TIMEOUT).json()
        new = [n for n in after if n["id"] not in before_ids]
        assert new, "no new warehouse notification after dispatch_adhoc"

    def test_mark_read_and_read_all(self, session):
        notifs = session.get(
            f"{BASE_URL}/api/notifications?target_type=manufacturer"
            f"&target_id={MFR_ID}", timeout=TIMEOUT).json()
        unread = [n for n in notifs if not n.get("read")]
        if unread:
            nid = unread[0]["id"]
            r = session.patch(f"{BASE_URL}/api/notifications/{nid}/read",
                              timeout=TIMEOUT)
            assert r.status_code == 200
            assert r.json().get("ok") is True
        r2 = session.patch(
            f"{BASE_URL}/api/notifications/read-all?target_type=manufacturer"
            f"&target_id={MFR_ID}", timeout=TIMEOUT)
        assert r2.status_code == 200
        assert r2.json().get("ok") is True
        after = session.get(
            f"{BASE_URL}/api/notifications?target_type=manufacturer"
            f"&target_id={MFR_ID}", timeout=TIMEOUT).json()
        assert all(n.get("read") for n in after)
