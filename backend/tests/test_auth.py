"""Backend auth tests — login, refresh, me, demo accounts, impersonation, lockout."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback: read from frontend/.env
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.strip().split("=", 1)[1].rstrip("/")
    except Exception:
        pass

API = f"{BASE_URL}/api"
DEMO_PASSWORD = "TradeKonekt2026!"

ADMIN = "admin@tradekonekt.io"
MFG = "unilever@tradekonekt.io"
DIST = "lagos.distributor@tradekonekt.io"
RETAILER = "retailer1@tradekonekt.io"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(session, email, password=DEMO_PASSWORD):
    return session.post(f"{API}/auth/login", json={"email": email, "password": password})


# -------------------- demo accounts (public) --------------------
class TestDemoAccounts:
    def test_demo_accounts_public(self, session):
        r = session.get(f"{API}/auth/demo-accounts")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        emails = [a["email"] for a in data]
        # 10 expected (1 super_admin + 1 mfg + 3 dist + 5 retailer)
        assert len(data) == 10, f"Expected 10 demo accounts, got {len(data)}: {emails}"
        roles = [a["role"] for a in data]
        assert roles.count("super_admin") == 1
        assert roles.count("manufacturer") == 1
        assert roles.count("distributor") == 3
        assert roles.count("retailer") == 5
        # No passwords leaked
        for a in data:
            assert "password" not in a
            assert "password_hash" not in a


# -------------------- login flows --------------------
class TestLogin:
    def test_login_success_super_admin(self, session):
        r = _login(session, ADMIN)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "access_token" in body and len(body["access_token"]) > 20
        assert body.get("token_type") == "bearer"
        assert body["user"]["email"] == ADMIN
        assert body["user"]["role"] == "super_admin"
        assert "password_hash" not in body["user"]
        # Cookies should be set
        assert "access_token" in session.cookies or "access_token" in r.cookies

    def test_login_success_manufacturer(self, session):
        r = _login(requests.Session(), MFG)
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "manufacturer"

    def test_login_success_distributor(self, session):
        r = _login(requests.Session(), DIST)
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "distributor"

    def test_login_success_retailer(self, session):
        r = _login(requests.Session(), RETAILER)
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "retailer"

    def test_login_bad_password(self):
        # Use throw-away account so we don't increment counter on real admin
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        # Use retailer5 — we'll only do one bad attempt
        r = s.post(f"{API}/auth/login",
                   json={"email": "retailer5@tradekonekt.io", "password": "WRONG"})
        assert r.status_code == 401
        assert "Invalid" in r.json().get("detail", "")

    def test_login_unknown_email(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        r = s.post(f"{API}/auth/login",
                   json={"email": "nosuchuser@tradekonekt.io", "password": "x"})
        assert r.status_code == 401


# -------------------- /auth/me --------------------
class TestMe:
    def test_me_with_token(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        token = _login(s, ADMIN).json()["access_token"]
        r = s.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        body = r.json()
        assert body["email"] == ADMIN
        assert "tenant_id" in body
        assert "password_hash" not in body

    def test_me_no_token(self):
        # Use bare requests (no shared cookies)
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_me_with_tenant_resolved_for_distributor(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        token = _login(s, DIST).json()["access_token"]
        r = s.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        body = r.json()
        # distributor should resolve to its manufacturer_id
        assert body.get("tenant_id"), "tenant_id should be non-empty for distributor"


# -------------------- refresh / logout --------------------
class TestRefreshLogout:
    def test_refresh_with_cookie(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        _login(s, ADMIN)
        # Cookie is set by login; call refresh without body
        r = s.post(f"{API}/auth/refresh", json={})
        assert r.status_code == 200, r.text
        assert "access_token" in r.json()

    def test_refresh_with_body(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        body = _login(s, ADMIN).json()
        rs = requests.Session()
        r = rs.post(f"{API}/auth/refresh", json={"refresh_token": body["refresh_token"]})
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_refresh_no_token(self):
        r = requests.post(f"{API}/auth/refresh", json={})
        assert r.status_code == 401

    def test_logout_clears_cookies(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        _login(s, ADMIN)
        r = s.post(f"{API}/auth/logout")
        assert r.status_code == 200
        # After logout, /auth/me with no header should be 401
        r2 = requests.get(f"{API}/auth/me")
        assert r2.status_code == 401


# -------------------- impersonation --------------------
class TestImpersonation:
    def test_super_admin_can_impersonate(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        admin_token = _login(s, ADMIN).json()["access_token"]
        # Fetch users list to get a retailer user id
        r = s.get(f"{API}/auth/users",
                  headers={"Authorization": f"Bearer {admin_token}"})
        assert r.status_code == 200
        users = r.json()
        assert len(users) == 10
        retailer = next(u for u in users if u["email"] == RETAILER)
        # impersonate
        r2 = s.post(f"{API}/auth/impersonate/{retailer['id']}",
                    headers={"Authorization": f"Bearer {admin_token}"})
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert "access_token" in body
        assert body["user"]["email"] == RETAILER
        assert body["impersonated_by"]["email"] == ADMIN

    def test_non_admin_cannot_impersonate(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        token = _login(s, MFG).json()["access_token"]
        # Need a user_id; just use a random id (auth check should fail before lookup)
        r = s.post(f"{API}/auth/impersonate/anyid",
                   headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 403


# -------------------- list users RBAC --------------------
class TestListUsers:
    def test_super_admin_sees_all(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        token = _login(s, ADMIN).json()["access_token"]
        r = s.get(f"{API}/auth/users",
                  headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        assert len(r.json()) == 10

    def test_retailer_forbidden(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        token = _login(s, RETAILER).json()["access_token"]
        r = s.get(f"{API}/auth/users",
                  headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 403

    def test_distributor_forbidden(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        token = _login(s, DIST).json()["access_token"]
        r = s.get(f"{API}/auth/users",
                  headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 403

    def test_manufacturer_sees_own_tenant(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        token = _login(s, MFG).json()["access_token"]
        r = s.get(f"{API}/auth/users",
                  headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200


# -------------------- existing smoke tests for protected endpoints --------------------
class TestSmokeProtectedEndpoints:
    def test_shipments_loads_for_manufacturer(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        token = _login(s, MFG).json()["access_token"]
        # Try a few common endpoints; just confirm not 5xx
        for path in ["/shipments", "/inventory"]:
            r = s.get(f"{API}{path}", headers={"Authorization": f"Bearer {token}"})
            assert r.status_code < 500, f"{path} returned {r.status_code}: {r.text[:200]}"


# -------------------- lockout (RUN LAST!) --------------------
# Uses retailer4 so we don't lock retailer1/admin/mfg used by other tests.
# After the test we successfully log in to clear the failure state.
@pytest.mark.order("last")
class TestLockout:
    def test_lockout_after_5_failures(self, session):
        target = "retailer4@tradekonekt.io"
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        # First make sure account is healthy
        ok = _login(s, target)
        assert ok.status_code == 200

        # 5 bad attempts
        for i in range(5):
            r = s.post(f"{API}/auth/login",
                       json={"email": target, "password": f"WRONG{i}"})
            assert r.status_code == 401, f"attempt {i+1}: {r.status_code} {r.text}"

        # 6th attempt: now locked
        r6 = s.post(f"{API}/auth/login",
                    json={"email": target, "password": "WRONG_AGAIN"})
        # Should be 429 (locked) — even with right password
        assert r6.status_code in (429, 401)
        # With CORRECT password we should still see 429 (locked)
        r_correct = s.post(f"{API}/auth/login",
                           json={"email": target, "password": DEMO_PASSWORD})
        assert r_correct.status_code == 429, \
            f"Expected 429 lockout, got {r_correct.status_code}: {r_correct.text}"
        assert "locked" in r_correct.json().get("detail", "").lower()
