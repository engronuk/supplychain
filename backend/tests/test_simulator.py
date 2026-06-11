"""Backend tests for TradeKonekt Activity Simulator (super-admin only)."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or \
           "https://supply-chain-hub-189.preview.emergentagent.com"
PASSWORD = "TradeKonekt2026!"


def _login(email):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": PASSWORD},
                      timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_headers():
    return {"Authorization": f"Bearer {_login('admin@tradekonekt.io')}"}


@pytest.fixture(scope="module")
def mfr_headers():
    return {"Authorization": f"Bearer {_login('unilever@tradekonekt.io')}"}


# --- RBAC ---
def test_status_requires_super_admin(mfr_headers):
    r = requests.get(f"{BASE_URL}/api/admin/simulator", headers=mfr_headers, timeout=20)
    assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"


def test_status_payload(admin_headers):
    r = requests.get(f"{BASE_URL}/api/admin/simulator", headers=admin_headers, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("settings", "running", "intervals_sec", "participants",
              "recent_runs", "generated_counts", "marker"):
        assert k in d, f"missing key {k}"
    assert d["marker"] == "SYSTEM_SIMULATOR"
    assert d["intervals_sec"]["low"] == 600
    assert d["intervals_sec"]["medium"] == 180
    assert d["intervals_sec"]["high"] == 60
    assert "total" in d["participants"]
    assert "by_type" in d["participants"]
    assert "list" in d["participants"]


# --- Seed demo participants ---
def test_seed_demo_idempotent(admin_headers):
    r1 = requests.post(f"{BASE_URL}/api/admin/simulator/participants/seed-demo",
                       headers=admin_headers, timeout=30)
    assert r1.status_code == 200, r1.text
    d1 = r1.json()
    assert d1["total_participants"] > 0
    total1 = d1["total_participants"]

    # Re-run -- must be idempotent
    r2 = requests.post(f"{BASE_URL}/api/admin/simulator/participants/seed-demo",
                       headers=admin_headers, timeout=30)
    assert r2.status_code == 200
    total2 = r2.json()["total_participants"]
    assert total2 == total1, f"seed not idempotent: {total1} -> {total2}"

    # Verify by_type has retailer + distributor (wholesaler + warehouse if seeded)
    s = requests.get(f"{BASE_URL}/api/admin/simulator",
                     headers=admin_headers, timeout=20).json()
    by_type = s["participants"]["by_type"]
    assert by_type.get("retailer", 0) > 0
    assert by_type.get("distributor", 0) > 0
    # Wholesaler should also be present per seed patterns
    assert by_type.get("wholesaler", 0) > 0


# --- Toggle ---
def test_toggle_off_on(admin_headers):
    r = requests.post(f"{BASE_URL}/api/admin/simulator/toggle",
                      headers=admin_headers, json={"enabled": False}, timeout=20)
    assert r.status_code == 200
    assert r.json().get("enabled") is False

    r = requests.post(f"{BASE_URL}/api/admin/simulator/toggle",
                      headers=admin_headers, json={"enabled": True}, timeout=20)
    assert r.status_code == 200
    assert r.json().get("enabled") is True

    time.sleep(2)
    s = requests.get(f"{BASE_URL}/api/admin/simulator",
                     headers=admin_headers, timeout=20).json()
    assert s["running"] is True, f"runtime should be running after toggle on, got {s['running']}"


# --- Level ---
def test_level_medium(admin_headers):
    r = requests.post(f"{BASE_URL}/api/admin/simulator/level",
                      headers=admin_headers, json={"level": "medium"}, timeout=20)
    assert r.status_code == 200
    assert r.json().get("activity_level") == "medium"
    s = requests.get(f"{BASE_URL}/api/admin/simulator",
                     headers=admin_headers, timeout=20).json()
    assert s["intervals_sec"]["medium"] == 180


# --- Tick increments counters & generates events ---
def test_force_tick(admin_headers):
    pre = requests.get(f"{BASE_URL}/api/admin/simulator",
                       headers=admin_headers, timeout=20).json()
    pre_ticks = pre["settings"].get("total_ticks", 0)
    pre_events = pre["settings"].get("total_events", 0)

    r = requests.post(f"{BASE_URL}/api/admin/simulator/tick",
                      headers=admin_headers, timeout=60)
    assert r.status_code == 200, r.text
    settings = r.json()
    assert settings["total_ticks"] == pre_ticks + 1, \
        f"total_ticks not incremented: {pre_ticks} -> {settings['total_ticks']}"
    assert settings["total_events"] >= pre_events  # may stay equal if 0 events

    post = requests.get(f"{BASE_URL}/api/admin/simulator",
                        headers=admin_headers, timeout=20).json()
    assert len(post["recent_runs"]) > 0
    latest = post["recent_runs"][0]
    assert latest.get("generated_by") == "SYSTEM_SIMULATOR"
    assert latest.get("events_generated", 0) > 0, \
        f"tick produced 0 events: {latest}"


# --- Events endpoint ---
def test_events_endpoint(admin_headers):
    r = requests.get(f"{BASE_URL}/api/admin/simulator/events?limit=10",
                     headers=admin_headers, timeout=20)
    assert r.status_code == 200
    d = r.json()
    assert "rows" in d and "count" in d
    assert d["count"] <= 10


# --- Marker presence in generated docs (via generated_counts) ---
def test_generated_marker_present(admin_headers):
    s = requests.get(f"{BASE_URL}/api/admin/simulator",
                     headers=admin_headers, timeout=20).json()
    counts = s["generated_counts"]
    # After force tick we should have at least retail_sales / notifications
    nonzero = [k for k, v in counts.items() if v > 0]
    assert len(nonzero) > 0, f"no generated docs with marker: {counts}"


# --- Purge ---
def test_purge(admin_headers):
    r = requests.delete(f"{BASE_URL}/api/admin/simulator/purge",
                        headers=admin_headers, timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["total_deleted"] == sum(d["deleted"].values())

    s = requests.get(f"{BASE_URL}/api/admin/simulator",
                     headers=admin_headers, timeout=20).json()
    for col, n in s["generated_counts"].items():
        assert n == 0, f"after purge, {col} still has {n}"
    assert s["settings"]["total_ticks"] == 0
    assert s["settings"]["total_events"] == 0


# --- Clear participants ---
def test_clear_participants(admin_headers):
    r = requests.post(f"{BASE_URL}/api/admin/simulator/participants/clear",
                      headers=admin_headers, timeout=20)
    assert r.status_code == 200
    s = requests.get(f"{BASE_URL}/api/admin/simulator",
                     headers=admin_headers, timeout=20).json()
    assert s["participants"]["total"] == 0, \
        f"after clear, still {s['participants']['total']} participants"

    # Restore for downstream UI tests
    requests.post(f"{BASE_URL}/api/admin/simulator/participants/seed-demo",
                  headers=admin_headers, timeout=30)
