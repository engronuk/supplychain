"""
P0 verification + regression tests for the cross-tenant retailer-data leak.

Iteration 33 — reruns the iteration_32 P0 scenarios after main agent applied
`require_retailer_ownership_async` to every /api/retailer/{rid}/* route AND to
/api/inventory when owner_type='retailer'.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://supply-chain-hub-189.preview.emergentagent.com").rstrip("/")
PASSWORD = "TradeKonekt2026!"

# Canonical entity ids (from /app/memory/test_credentials.md + iteration_32)
FAMILY_SHOP_1_RID = "49e47d4f-914a-733f-3aa6-37f716dfe766"  # Unilever retailer (own)
HUBMART_ABA_RID   = "92aacb58-f802-2b72-5393-232bce704e8a"  # FMN retailer (foreign)
UNILEVER_MFR_ID   = "b21c1dbe-1a6f-4c33-b036-f416579455d0"
APEX_DST_ID       = "f9dfaf08-4ee2-3c64-e96b-983c385625b2"

ACCOUNTS = {
    "retailer":     "unilever.retailer@tradekonekt.io",
    "manufacturer": "unilever@tradekonekt.io",
    "distributor":  "mfr-0001-dst-0001@tradekonekt.io",
    "fmn_mfr":      "fmn@tradekonekt.io",
    "admin":        "admin@tradekonekt.io",
}


# ---------------- helpers ----------------
def login(email: str) -> tuple[str, dict]:
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    body = r.json()
    token = body.get("access_token") or body.get("token")
    user  = body.get("user") or {}
    assert token, f"no token in login response: {body}"
    return token, user


def H(token: str, tenant: str | None = None) -> dict:
    h = {"Authorization": f"Bearer {token}"}
    if tenant:
        h["X-Active-Tenant-Id"] = tenant
    return h


# ---------------- fixtures ----------------
@pytest.fixture(scope="session")
def retailer_ctx():
    tok, user = login(ACCOUNTS["retailer"])
    return {"token": tok, "user": user, "entity_id": user.get("entity_id")}

@pytest.fixture(scope="session")
def mfr_ctx():
    tok, user = login(ACCOUNTS["manufacturer"])
    return {"token": tok, "user": user, "entity_id": user.get("entity_id")}

@pytest.fixture(scope="session")
def fmn_mfr_ctx():
    tok, user = login(ACCOUNTS["fmn_mfr"])
    return {"token": tok, "user": user, "entity_id": user.get("entity_id")}

@pytest.fixture(scope="session")
def dist_ctx():
    tok, user = login(ACCOUNTS["distributor"])
    return {"token": tok, "user": user, "entity_id": user.get("entity_id")}

@pytest.fixture(scope="session")
def admin_ctx():
    tok, user = login(ACCOUNTS["admin"])
    return {"token": tok, "user": user, "entity_id": user.get("entity_id")}


# ============================================================
# A. P0 CLOSURE — foreign rid must be 403 on every endpoint
# ============================================================

FOREIGN_GET_PATHS = [
    "/sales",
    "/dashboard",
    "/sales-trend",
    "/reorder-suggestions",
    "/insights",
    "/activity",
    "/inventory-command-center",
    "/sales/summary",
    "/sales/analytics",
    "/sales/export.csv",
]

@pytest.mark.parametrize("path", FOREIGN_GET_PATHS)
def test_foreign_retailer_get_returns_403(retailer_ctx, path):
    url = f"{BASE_URL}/api/retailer/{HUBMART_ABA_RID}{path}"
    r = requests.get(url, headers=H(retailer_ctx["token"]), timeout=15)
    assert r.status_code == 403, f"{path} expected 403, got {r.status_code} body={r.text[:300]}"


def test_foreign_retailer_post_sales_returns_403(retailer_ctx):
    payload = {
        "retailer_id": HUBMART_ABA_RID,
        "items": [{"product_id": "dummy", "quantity": 1, "unit_price": 100}],
        "payment_method": "cash",
        "payment_status": "paid",
        "total_amount": 100,
    }
    r = requests.post(
        f"{BASE_URL}/api/retailer/{HUBMART_ABA_RID}/sales",
        headers={**H(retailer_ctx["token"]), "Content-Type": "application/json"},
        json=payload, timeout=15,
    )
    # Ownership guard must fire BEFORE persistence. 403 is the only correct answer here.
    assert r.status_code == 403, f"POST /sales expected 403, got {r.status_code} body={r.text[:300]}"


def test_foreign_retailer_mark_paid_returns_403(retailer_ctx):
    fake_sale_id = "00000000-0000-0000-0000-000000000000"
    r = requests.patch(
        f"{BASE_URL}/api/retailer/{HUBMART_ABA_RID}/sales/{fake_sale_id}/mark-paid",
        headers={**H(retailer_ctx["token"]), "Content-Type": "application/json"},
        json={"payment_method": "cash"}, timeout=15,
    )
    assert r.status_code == 403, f"mark-paid expected 403, got {r.status_code} body={r.text[:300]}"


def test_foreign_inventory_query_returns_403(retailer_ctx):
    r = requests.get(
        f"{BASE_URL}/api/inventory",
        headers=H(retailer_ctx["token"]),
        params={"owner_type": "retailer", "owner_id": HUBMART_ABA_RID},
        timeout=15,
    )
    assert r.status_code == 403, f"foreign /api/inventory expected 403, got {r.status_code} body={r.text[:300]}"


# ============================================================
# B. BACKWARDS COMPAT — own retailer still works
# ============================================================

OWN_GET_PATHS = [
    "/sales", "/dashboard", "/sales-trend", "/reorder-suggestions",
    "/insights", "/activity", "/inventory-command-center",
    "/sales/summary", "/sales/analytics",
]

@pytest.mark.parametrize("path", OWN_GET_PATHS)
def test_own_retailer_get_still_200(retailer_ctx, path):
    url = f"{BASE_URL}/api/retailer/{FAMILY_SHOP_1_RID}{path}"
    r = requests.get(url, headers=H(retailer_ctx["token"]), timeout=20)
    # /sales/analytics or /insights may return 200 with empty payload — accept any 2xx.
    assert 200 <= r.status_code < 300, f"OWN {path} expected 2xx, got {r.status_code} body={r.text[:300]}"


def test_own_inventory_query_200(retailer_ctx):
    r = requests.get(
        f"{BASE_URL}/api/inventory",
        headers=H(retailer_ctx["token"]),
        params={"owner_type": "retailer", "owner_id": FAMILY_SHOP_1_RID},
        timeout=15,
    )
    assert r.status_code == 200, f"OWN /api/inventory expected 200, got {r.status_code} body={r.text[:300]}"


# ============================================================
# C. AUTO-SCOPING of /api/inventory with NO params
# ============================================================

def test_inventory_no_params_retailer_autoscopes(retailer_ctx):
    r = requests.get(f"{BASE_URL}/api/inventory", headers=H(retailer_ctx["token"]), timeout=20)
    assert r.status_code == 200, f"retailer no-params expected 200, got {r.status_code} body={r.text[:300]}"
    rows = r.json() if isinstance(r.json(), list) else r.json().get("rows", r.json().get("items", []))
    if isinstance(rows, list) and rows:
        # All rows must belong to caller's retailer
        for row in rows[:20]:
            owner = row.get("owner_id") or row.get("retailer_id")
            if owner is not None:
                assert owner == FAMILY_SHOP_1_RID, f"auto-scope leaked: row owner={owner}"


def test_inventory_no_params_distributor_autoscopes(dist_ctx):
    r = requests.get(f"{BASE_URL}/api/inventory", headers=H(dist_ctx["token"]), timeout=20)
    assert r.status_code == 200, f"distributor no-params expected 200, got {r.status_code} body={r.text[:300]}"


def test_inventory_no_params_super_admin_must_400(admin_ctx):
    r = requests.get(f"{BASE_URL}/api/inventory", headers=H(admin_ctx["token"]), timeout=15)
    # Spec says: super_admin must be explicit. 400 (or 422) acceptable; 200 is a regression.
    assert r.status_code in (400, 422), (
        f"super_admin no-params expected 400/422, got {r.status_code} body={r.text[:300]}"
    )


# ============================================================
# D. CROSS-TIER READS — manufacturer / distributor
# ============================================================

def _find_unilever_retailer_rid(mfr_token):
    """Find a retailer in the Unilever tree (any other than Family Shop 1)."""
    r = requests.get(f"{BASE_URL}/api/retailers", headers=H(mfr_token),
                     params={"limit": 5}, timeout=15)
    if r.status_code != 200:
        return None
    data = r.json()
    items = data if isinstance(data, list) else data.get("items", data.get("rows", []))
    for it in items:
        rid = it.get("id") or it.get("retailer_id")
        if rid:
            return rid
    return None


def test_unilever_mfr_can_read_own_retailer(mfr_ctx):
    # Family Shop 1 is canonically MFR-0001-RTL-0001 (Unilever tree).
    rid = FAMILY_SHOP_1_RID
    r = requests.get(f"{BASE_URL}/api/retailer/{rid}/dashboard",
                     headers=H(mfr_ctx["token"]), timeout=20)
    assert r.status_code == 200, f"Unilever→own retailer expected 200, got {r.status_code} body={r.text[:300]}"


def test_unilever_mfr_cannot_read_competing_retailer(mfr_ctx):
    r = requests.get(f"{BASE_URL}/api/retailer/{HUBMART_ABA_RID}/dashboard",
                     headers=H(mfr_ctx["token"]), timeout=20)
    assert r.status_code == 403, f"Unilever→FMN retailer expected 403, got {r.status_code} body={r.text[:300]}"


def _find_retailer_under_distributor(dist_token, dist_eid):
    """Walk /api/distributor/{did}/retailers or /retailers?distributor_id=..."""
    for url, params in [
        (f"{BASE_URL}/api/distributor/{dist_eid}/retailers", {}),
        (f"{BASE_URL}/api/retailers", {"distributor_id": dist_eid, "limit": 5}),
    ]:
        r = requests.get(url, headers=H(dist_token), params=params, timeout=15)
        if r.status_code == 200:
            data = r.json()
            items = data if isinstance(data, list) else data.get("items", data.get("rows", []))
            for it in items:
                rid = it.get("id") or it.get("retailer_id")
                if rid:
                    return rid
    return None


def test_distributor_can_read_own_retailer(dist_ctx):
    rid = _find_retailer_under_distributor(dist_ctx["token"], dist_ctx["entity_id"])
    if not rid:
        pytest.skip("could not discover a retailer under Apex distributor")
    r = requests.get(f"{BASE_URL}/api/retailer/{rid}/dashboard",
                     headers=H(dist_ctx["token"]), timeout=20)
    assert r.status_code == 200, f"Apex→own retailer expected 200, got {r.status_code} body={r.text[:300]}"


def test_distributor_cannot_read_other_distributors_retailer(dist_ctx):
    # Hubmart Aba is under FMN tree — definitely not under Apex (Unilever).
    r = requests.get(f"{BASE_URL}/api/retailer/{HUBMART_ABA_RID}/dashboard",
                     headers=H(dist_ctx["token"]), timeout=20)
    assert r.status_code == 403, f"Apex→FMN retailer expected 403, got {r.status_code} body={r.text[:300]}"


# ============================================================
# E. SMOKE — admin can still read everything (no regression)
# ============================================================

def test_super_admin_can_read_any_retailer(admin_ctx):
    r = requests.get(f"{BASE_URL}/api/retailer/{HUBMART_ABA_RID}/dashboard",
                     headers=H(admin_ctx["token"]), timeout=20)
    assert r.status_code == 200, f"admin→any retailer expected 200, got {r.status_code}"
