"""Phase 3 — Logistics AI: predictions, copilot, demand↔delivery."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
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


# --- /api/logistics/predictions --------------------------------------------
class TestPredictions:
    def test_payload_shape(self, mfr_headers):
        r = requests.get(f"{BASE_URL}/api/logistics/predictions",
                         headers=mfr_headers, timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "items" in data and isinstance(data["items"], list)
        assert data.get("source") in ("vertex-ai", "heuristic")
        counts = data.get("counts") or {}
        for lv in ("high", "medium", "low"):
            assert lv in counts and isinstance(counts[lv], int)
        assert "fleet_scored" in data and isinstance(data["fleet_scored"], int)
        assert "created_at" in data
        for it in data["items"]:
            for k in ("vehicle_code", "risk_level", "probability",
                      "predicted_delay_min", "reason", "recommendation",
                      "dest_name", "status"):
                assert k in it, f"prediction item missing {k}: {it}"
            assert it["risk_level"] in ("high", "medium", "low")
            assert 0.0 <= float(it["probability"]) <= 1.0

    def test_cached_within_ttl(self, mfr_headers):
        r1 = requests.get(f"{BASE_URL}/api/logistics/predictions",
                          headers=mfr_headers, timeout=90)
        assert r1.status_code == 200
        t1 = r1.json().get("created_at")
        time.sleep(1)
        r2 = requests.get(f"{BASE_URL}/api/logistics/predictions",
                          headers=mfr_headers, timeout=30)
        assert r2.status_code == 200
        t2 = r2.json().get("created_at")
        assert t1 == t2, f"Expected cached doc; got {t1} vs {t2}"

    def test_refresh_recomputes(self, mfr_headers):
        r1 = requests.get(f"{BASE_URL}/api/logistics/predictions",
                          headers=mfr_headers, timeout=90)
        t1 = r1.json().get("created_at")
        r2 = requests.get(f"{BASE_URL}/api/logistics/predictions?refresh=true",
                          headers=mfr_headers, timeout=90)
        assert r2.status_code == 200
        t2 = r2.json().get("created_at")
        assert t2 != t1, "refresh=true should produce a new created_at"

    def test_distributor_403(self, dist_headers):
        r = requests.get(f"{BASE_URL}/api/logistics/predictions",
                         headers=dist_headers, timeout=20)
        assert r.status_code == 403


# --- /api/logistics/copilot ------------------------------------------------
class TestCopilot:
    def test_chat_grounded(self, mfr_headers):
        sid = "TEST_copilot_grounded"
        r = requests.post(f"{BASE_URL}/api/logistics/copilot/chat",
                          headers=mfr_headers, timeout=90,
                          json={"message": "List the active trucks and any breakdowns.",
                                "session_id": sid})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("provider") == "vertex-ai"
        assert data.get("session_id") == sid
        assert "model" in data
        reply = data.get("reply") or ""
        assert isinstance(reply, str) and len(reply) > 10
        # Should mention real codes when context has any
        # (loose check — TK- or RT- or "no active" wording acceptable)
        assert ("TK-" in reply or "RT-" in reply
                or "no active" in reply.lower()
                or "idle" in reply.lower()), f"Reply not grounded: {reply[:300]}"

    def test_chat_multi_turn(self, mfr_headers):
        sid = f"TEST_copilot_multiturn_{int(time.time())}"
        r1 = requests.post(f"{BASE_URL}/api/logistics/copilot/chat",
                           headers=mfr_headers, timeout=90,
                           json={"message": "How many shipments completed in the last 14 days?",
                                 "session_id": sid})
        assert r1.status_code == 200, r1.text
        first = (r1.json().get("reply") or "").lower()
        assert first

        r2 = requests.post(f"{BASE_URL}/api/logistics/copilot/chat",
                           headers=mfr_headers, timeout=90,
                           json={"message": "And how many of those were delayed?",
                                 "session_id": sid})
        assert r2.status_code == 200, r2.text
        second = (r2.json().get("reply") or "").lower()
        assert second
        # The follow-up must engage with the previous Q (not ask for clarification)
        assert ("delay" in second or "late" in second
                or "completed" in second or "number" in second
                or any(ch.isdigit() for ch in second)), \
            f"Follow-up did not use prior context: {second[:300]}"

    def test_chat_empty_400(self, mfr_headers):
        r = requests.post(f"{BASE_URL}/api/logistics/copilot/chat",
                          headers=mfr_headers, timeout=30,
                          json={"message": "   "})
        assert r.status_code == 400

    def test_history_chrono(self, mfr_headers):
        sid = f"TEST_copilot_history_{int(time.time())}"
        requests.post(f"{BASE_URL}/api/logistics/copilot/chat",
                      headers=mfr_headers, timeout=90,
                      json={"message": "Quick fleet status please.", "session_id": sid})
        r = requests.get(f"{BASE_URL}/api/logistics/copilot/history?session_id={sid}",
                         headers=mfr_headers, timeout=20)
        assert r.status_code == 200
        body = r.json()
        msgs = body.get("messages") or []
        assert len(msgs) >= 2
        # Chronological + alternating roles
        roles = [m["role"] for m in msgs]
        assert roles[0] == "user" and roles[1] == "assistant"
        times = [m.get("created_at") for m in msgs]
        assert times == sorted(times), "history not in chronological order"

    def test_distributor_403(self, dist_headers):
        r = requests.post(f"{BASE_URL}/api/logistics/copilot/chat",
                          headers=dist_headers, timeout=20,
                          json={"message": "hello"})
        assert r.status_code == 403


# --- /api/logistics/demand-delivery ----------------------------------------
class TestDemandDelivery:
    def test_payload_shape(self, mfr_headers):
        r = requests.get(f"{BASE_URL}/api/logistics/demand-delivery",
                         headers=mfr_headers, timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "regions" in data and isinstance(data["regions"], list)
        assert "insights" in data and isinstance(data["insights"], list)
        assert 0 <= len(data["insights"]) <= 4
        assert data.get("source") in ("vertex-ai", "heuristic")
        assert "created_at" in data
        # Region shape
        all_plus100 = True
        for reg in data["regions"]:
            for k in ("region", "demand_units_7d", "demand_trend_pct",
                      "deliveries_30d", "avg_lead_hours", "in_transit_now",
                      "delayed_now", "stock_cover_days", "pressure"):
                assert k in reg, f"region missing {k}: {reg}"
            assert reg["pressure"] in ("at_risk", "watch", "healthy")
            if reg["demand_trend_pct"] != 100.0:
                all_plus100 = False
        if data["regions"]:
            assert not all_plus100, "All regions show +100% trend — likely a bug"

    def test_cached_within_ttl(self, mfr_headers):
        r1 = requests.get(f"{BASE_URL}/api/logistics/demand-delivery",
                          headers=mfr_headers, timeout=90)
        t1 = r1.json().get("created_at")
        time.sleep(1)
        r2 = requests.get(f"{BASE_URL}/api/logistics/demand-delivery",
                          headers=mfr_headers, timeout=20)
        assert r2.json().get("created_at") == t1

    def test_refresh_recomputes(self, mfr_headers):
        t1 = requests.get(f"{BASE_URL}/api/logistics/demand-delivery",
                          headers=mfr_headers, timeout=90).json().get("created_at")
        r2 = requests.get(f"{BASE_URL}/api/logistics/demand-delivery?refresh=true",
                          headers=mfr_headers, timeout=90)
        assert r2.status_code == 200
        assert r2.json().get("created_at") != t1

    def test_distributor_403(self, dist_headers):
        r = requests.get(f"{BASE_URL}/api/logistics/demand-delivery",
                         headers=dist_headers, timeout=20)
        assert r.status_code == 403


# --- delay_predicted event emit code path ----------------------------------
class TestDelayPredictedEmit:
    def test_emit_code_path_present(self):
        """Verify emit code + 60min dedupe present in delay_predictor."""
        with open("/app/backend/services/delay_predictor.py") as f:
            src = f.read()
        assert 'event_type": "delay_predicted"' in src or 'delay_predicted' in src
        assert "logistics_events" in src
        assert "timedelta(minutes=60)" in src, "60-min dedupe window missing"
        assert "emit(" in src
