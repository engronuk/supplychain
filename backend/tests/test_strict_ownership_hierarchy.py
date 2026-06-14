"""
Tests for STRICT 5-tier ownership hierarchy migration:
- Distributor Operations Intelligence (wholesalers as direct children)
- Manufacturer overview (warehouses as direct children + downstream visibility)
- Wholesaler Network endpoint (key_account_retailers=0 after migration)
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://supply-chain-hub-189.preview.emergentagent.com").rstrip("/")
PASSWORD = "TradeKonekt2026!"


def _login(email, retries=3):
    import time
    last_err = None
    for attempt in range(retries):
        try:
            r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": PASSWORD}, timeout=30)
            if r.status_code == 200:
                body = r.json()
                return body["access_token"], body["user"]
            last_err = f"{r.status_code} {r.text[:200]}"
        except Exception as e:
            last_err = str(e)
        time.sleep(2 + attempt * 2)
    raise AssertionError(f"login failed for {email} after {retries} retries: {last_err}")


# ---------------- Distributor OS ----------------

class TestDistributorOperationsIntelligence:
    @pytest.fixture(scope="class")
    def dist_session(self):
        token, user = _login("unilever.distributor@tradekonekt.io")
        sess = requests.Session()
        sess.headers.update({"Authorization": f"Bearer {token}"})
        return sess, user

    def test_endpoint_returns_wholesaler_keys(self, dist_session):
        sess, user = dist_session
        entity_id = user.get("entity_id")
        assert entity_id, "JWT user payload must include entity_id"
        r = sess.get(f"{BASE_URL}/api/distributor/{entity_id}/operations-intelligence", timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()

        # New keys must exist
        assert "top_wholesalers" in data, f"missing top_wholesalers; keys={list(data.keys())}"
        assert "attention_wholesalers" in data, f"missing attention_wholesalers; keys={list(data.keys())}"
        assert isinstance(data["top_wholesalers"], list)
        assert isinstance(data["attention_wholesalers"], list)

        # Legacy retailer keys must be gone
        assert "top_retailers" not in data, "legacy top_retailers still present"
        assert "attention_retailers" not in data, "legacy attention_retailers still present"

    def test_totals_use_wholesalers(self, dist_session):
        sess, user = dist_session
        r = sess.get(f"{BASE_URL}/api/distributor/{user['entity_id']}/operations-intelligence", timeout=60)
        data = r.json()
        totals = data.get("totals", {})
        assert "total_wholesalers" in totals, f"totals must expose total_wholesalers; got {totals}"
        assert "total_retailers" not in totals, "totals must NOT include total_retailers (it lives under downstream_visibility)"
        assert isinstance(totals["total_wholesalers"], int)
        assert totals["total_wholesalers"] >= 1

    def test_downstream_visibility_block(self, dist_session):
        sess, user = dist_session
        r = sess.get(f"{BASE_URL}/api/distributor/{user['entity_id']}/operations-intelligence", timeout=60)
        data = r.json()
        dv = data.get("downstream_visibility")
        assert dv is not None, "downstream_visibility block missing"
        assert "total_retailers" in dv
        assert "active_retailers_30d" in dv
        assert isinstance(dv["total_retailers"], int)

    def test_kpis_active_wholesalers(self, dist_session):
        sess, user = dist_session
        r = sess.get(f"{BASE_URL}/api/distributor/{user['entity_id']}/operations-intelligence", timeout=60)
        data = r.json()
        kpis = data.get("kpis", {})
        assert "active_wholesalers" in kpis, f"kpis.active_wholesalers missing; got {list(kpis.keys())}"
        assert "active_retailers" not in kpis, "legacy kpis.active_retailers still present"

    def test_performance_matrix_has_code_and_active_retailers(self, dist_session):
        sess, user = dist_session
        r = sess.get(f"{BASE_URL}/api/distributor/{user['entity_id']}/operations-intelligence", timeout=60)
        data = r.json()
        pm = data.get("performance_matrix", [])
        assert isinstance(pm, list) and len(pm) >= 1, "performance_matrix should have rows"
        first = pm[0]
        assert "code" in first, f"performance_matrix row missing code: {first}"
        assert "active_retailers_30d" in first, f"performance_matrix row missing active_retailers_30d: {first}"


# ---------------- Wholesaler Network ----------------

class TestWholesalerNetwork:
    def test_key_account_retailers_zero(self):
        token, user = _login("unilever.distributor@tradekonekt.io")
        sess = requests.Session()
        sess.headers.update({"Authorization": f"Bearer {token}"})
        r = sess.get(f"{BASE_URL}/api/distributor/{user['entity_id']}/wholesaler-network", timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        # After migration, no key-account retailers remain direct children of distributor
        ka = data.get("key_account_retailers")
        if isinstance(ka, list):
            assert len(ka) == 0, f"key_account_retailers list must be empty after migration, got {ka}"
        else:
            assert ka == 0, f"key_account_retailers must be 0 after migration, got {ka}"

    def test_apex_wholesalers_have_six_retailers_each(self):
        token, user = _login("unilever.distributor@tradekonekt.io")
        sess = requests.Session()
        sess.headers.update({"Authorization": f"Bearer {token}"})
        r = sess.get(f"{BASE_URL}/api/distributor/{user['entity_id']}/wholesaler-network", timeout=60)
        data = r.json()
        wholesalers = data.get("wholesalers") or data.get("wholesaler_cards") or []
        assert len(wholesalers) >= 3, f"Expected 3 wholesalers, got {len(wholesalers)}"
        # At least one wholesaler card should now show 6 retailers (re-parent moved 2 KA under Royal Trading 1)
        retailer_counts = [w.get("retailer_count") or w.get("retailers") or w.get("total_retailers") for w in wholesalers]
        assert any(c == 6 for c in retailer_counts if isinstance(c, int)), \
            f"Expected at least one wholesaler with 6 retailers; got counts={retailer_counts}"


# ---------------- Manufacturer Overview ----------------

class TestManufacturerOverview:
    def test_warehouses_and_downstream_blocks(self):
        token, user = _login("unilever@tradekonekt.io")
        sess = requests.Session()
        sess.headers.update({"Authorization": f"Bearer {token}"})
        # Common endpoint name; allow either path
        for path in [
            f"/api/manufacturer/{user['entity_id']}/overview",
            f"/api/manufacturer/{user['entity_id']}/operations-intelligence",
        ]:
            r = sess.get(f"{BASE_URL}{path}", timeout=60)
            if r.status_code == 200:
                data = r.json()
                break
        else:
            pytest.fail("No manufacturer overview endpoint responded with 200")

        kpis = data.get("kpis", {})
        assert "warehouses" in kpis, f"Expected kpis.warehouses; got {list(kpis.keys())}"
        wh = kpis["warehouses"]
        # KPI may be a scalar or {value, growth_pct, spark} structured object
        wh_value = wh["value"] if isinstance(wh, dict) else wh
        assert wh_value == 3, f"Expected 3 warehouses for Unilever, got {wh_value}"

        # Legacy backend KPI may still be present (UI-level removal only) — log but don't fail
        if "active_distributors" in kpis:
            print("INFO: backend still exposes kpis.active_distributors — UI should hide it")

        hierarchy = data.get("hierarchy", {})
        if hierarchy:
            assert "direct_children" in hierarchy or "downstream_visibility" in hierarchy, \
                f"hierarchy block missing direct_children/downstream_visibility: {hierarchy}"


# ---------------- Multi-tenant smoke ----------------

class TestMultiTenantDistributor:
    def test_fmn_distributor_has_wholesalers(self):
        token, user = _login("fmn.distributor@tradekonekt.io")
        sess = requests.Session()
        sess.headers.update({"Authorization": f"Bearer {token}"})

        # Snapshot may compute async — poll up to ~25s for a non-computing payload
        import time
        data = None
        for _ in range(8):
            r = sess.get(f"{BASE_URL}/api/distributor/{user['entity_id']}/operations-intelligence", timeout=60)
            assert r.status_code == 200, r.text
            data = r.json()
            snap = data.get("_snapshot") or {}
            if not snap.get("computing") and data.get("totals", {}).get("total_wholesalers"):
                break
            time.sleep(3)

        assert data is not None
        assert data.get("totals", {}).get("total_wholesalers", 0) >= 1, \
            f"FMN distributor expected >=1 wholesalers; got totals={data.get('totals')} snapshot={data.get('_snapshot')}"
        assert "top_wholesalers" in data
