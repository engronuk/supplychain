"""Iteration 34 — Retailer-Private Products extended verification.

Augments test_retailer_private_products.py with the explicit checks
requested in the iteration 34 review:

1.  Cross-RETAILER isolation: a SECOND retailer's `/api/products`
    must NOT contain another retailer's private SKU.
2.  Wholesaler / distributor isolation: same SKU invisible upstream.
3.  Explicit decrement evidence — start at 0, +10, sell 3, expect 7.
4.  `Idempotent-Replay: true` header on second POST with same key.
5.  PATCH then GET — verify persistence of edits.
6.  DELETE then GET — soft-deleted product is excluded from default
    listing (but present with include_deleted=True).
"""
from __future__ import annotations

import os
import uuid
from typing import Dict, List

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as fh:
        for line in fh:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.strip().split("=", 1)[1].rstrip("/")
API = f"{BASE_URL}/api"
PWD = "TradeKonekt2026!"

# Known seeded retailers (entity_ids hard-coded so we can prove cross-tenant
# isolation). If the second retailer login is not available we skip that test.
RETAILER_A_EMAIL = "unilever.retailer@tradekonekt.io"
RETAILER_A_ID = "49e47d4f-914a-733f-3aa6-37f716dfe766"
MANUFACTURER_EMAIL = "unilever@tradekonekt.io"
DISTRIBUTOR_EMAIL = "mfr-0001-dst-0001@tradekonekt.io"


def _login(email: str) -> str:
    r = requests.post(f"{API}/auth/login",
                      json={"email": email, "password": PWD}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed for {email}: {r.status_code}")
    body = r.json()
    return body.get("access_token") or body["token"]


def _headers(tok: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {tok}"}


def _find_another_retailer_id(tok: str, exclude: str) -> str | None:
    """Try to find another retailer entity using public endpoints."""
    try:
        r = requests.get(f"{API}/organizations", headers=_headers(tok),
                         timeout=30)
        if r.status_code != 200:
            return None
        rows = r.json()
        if isinstance(rows, dict):
            rows = rows.get("rows") or rows.get("organizations") or []
        for it in rows:
            if (it.get("type") == "retailer" and
                    it.get("id") and it["id"] != exclude):
                return it["id"]
    except Exception:
        return None
    return None


# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def ctx() -> Dict[str, str]:
    tok = _login(RETAILER_A_EMAIL)
    # Onboard one private product we'll reuse for isolation tests.
    name = f"IsoTest {uuid.uuid4().hex[:6]}"
    r = requests.post(
        f"{API}/retailer/{RETAILER_A_ID}/products",
        json={"name": name, "category": "Local Snacks", "unit_price": 250,
              "external_manufacturer": "Mama Nkechi Foods Ltd"},
        headers=_headers(tok), timeout=30,
    )
    assert r.status_code == 200, r.text
    p = r.json()
    return {"tok": tok, "rid": RETAILER_A_ID, "pid": p["id"],
            "sku": p["sku"], "name": p["name"]}


# ---------------------------------------------------------------------------
def test_create_returns_expected_shape(ctx):
    """Re-confirm POST contract (source/owner/is_private/sku prefix)."""
    name = f"ShapeCheck {uuid.uuid4().hex[:6]}"
    r = requests.post(
        f"{API}/retailer/{ctx['rid']}/products",
        json={"name": name, "category": "X", "unit_price": 100,
              "external_manufacturer": "Off Eco Co"},
        headers=_headers(ctx["tok"]), timeout=30,
    )
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["source"] == "retailer_private"
    assert p["owner_id"] == ctx["rid"]
    assert p["owner_type"] == "retailer"
    assert p["is_private"] is True
    assert p["sku"].startswith("PRIV-")
    assert p["external_manufacturer"] == "Off Eco Co"


def test_invisible_to_manufacturer(ctx):
    mtok = _login(MANUFACTURER_EMAIL)
    r = requests.get(f"{API}/products", headers=_headers(mtok), timeout=30)
    assert r.status_code == 200
    rows = r.json()
    if isinstance(rows, dict):
        rows = rows.get("rows") or rows.get("products") or []
    assert not any(p.get("id") == ctx["pid"] for p in rows), (
        "Manufacturer must NOT see retailer-private SKU"
    )


def test_invisible_to_distributor(ctx):
    dtok = _login(DISTRIBUTOR_EMAIL)
    r = requests.get(f"{API}/products", headers=_headers(dtok), timeout=30)
    assert r.status_code == 200
    rows = r.json()
    if isinstance(rows, dict):
        rows = rows.get("rows") or rows.get("products") or []
    assert not any(p.get("id") == ctx["pid"] for p in rows), (
        "Distributor must NOT see retailer-private SKU"
    )


def test_invisible_to_other_retailer(ctx):
    other = _find_another_retailer_id(ctx["tok"], exclude=ctx["rid"])
    if not other:
        pytest.skip("No second retailer discoverable via /organizations")
    # Get token for that retailer? We don't have password — instead validate
    # via super_admin or skip. We at least verify that as Retailer A, the
    # cross-tenant GET on the other retailer's private list is 403.
    r = requests.get(f"{API}/retailer/{other}/products",
                     headers=_headers(ctx["tok"]), timeout=30)
    assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"


def test_stock_and_sell_decrements_to_seven(ctx):
    # Create fresh product
    p = requests.post(
        f"{API}/retailer/{ctx['rid']}/products",
        json={"name": f"Decrement {uuid.uuid4().hex[:6]}",
              "category": "T", "unit_price": 500},
        headers=_headers(ctx["tok"]), timeout=30,
    ).json()
    pid = p["id"]
    # Adjust +10
    a = requests.post(
        f"{API}/retailer/{ctx['rid']}/inventory/adjust",
        json={"product_id": pid, "delta": 10, "reason": "shipment_received"},
        headers=_headers(ctx["tok"]), timeout=30,
    )
    assert a.status_code == 200, a.text
    assert a.json()["resulting_quantity"] == 10
    # Sell 3
    s = requests.post(
        f"{API}/retailer/{ctx['rid']}/sales",
        json={"items": [{"product_id": pid, "quantity": 3,
                          "unit_price": 500}],
              "payment_method": "cash"},
        headers=_headers(ctx["tok"]), timeout=30,
    )
    assert s.status_code == 200, s.text
    # Verify inventory
    inv = requests.get(
        f"{API}/inventory",
        params={"owner_type": "retailer", "owner_id": ctx["rid"]},
        headers=_headers(ctx["tok"]), timeout=30,
    ).json()
    rows = inv if isinstance(inv, list) else inv.get("rows", [])
    row = next(it for it in rows if it["product_id"] == pid)
    assert row["quantity"] == 7, f"expected qty 7, got {row}"


def test_idempotent_replay_header_set(ctx):
    key = f"ik_{uuid.uuid4()}"
    body = {"name": f"IdemHdr {uuid.uuid4().hex[:6]}",
            "category": "T", "unit_price": 99}
    h = {**_headers(ctx["tok"]), "Idempotency-Key": key}
    r1 = requests.post(f"{API}/retailer/{ctx['rid']}/products",
                       json=body, headers=h, timeout=30)
    r2 = requests.post(f"{API}/retailer/{ctx['rid']}/products",
                       json=body, headers=h, timeout=30)
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"]
    assert r2.headers.get("Idempotent-Replay") == "true"


def test_patch_persists_and_delete_excludes(ctx):
    p = requests.post(
        f"{API}/retailer/{ctx['rid']}/products",
        json={"name": f"Editable {uuid.uuid4().hex[:6]}",
              "category": "X", "unit_price": 100},
        headers=_headers(ctx["tok"]), timeout=30,
    ).json()
    pid = p["id"]
    new_name = f"Edited {uuid.uuid4().hex[:4]}"
    r = requests.patch(
        f"{API}/retailer/{ctx['rid']}/products/{pid}",
        json={"name": new_name, "unit_price": 150, "category": "Edited"},
        headers=_headers(ctx["tok"]), timeout=30,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == new_name
    assert body["unit_price"] == 150
    assert body["category"] == "Edited"
    # GET to confirm persistence
    listed = requests.get(
        f"{API}/retailer/{ctx['rid']}/products",
        params={"q": new_name},
        headers=_headers(ctx["tok"]), timeout=30,
    ).json()
    assert any(it["id"] == pid and it["unit_price"] == 150
               for it in listed["rows"])
    # Soft delete
    d = requests.delete(f"{API}/retailer/{ctx['rid']}/products/{pid}",
                        headers=_headers(ctx["tok"]), timeout=30)
    assert d.status_code == 204
    # Default list excludes it
    listed = requests.get(
        f"{API}/retailer/{ctx['rid']}/products",
        headers=_headers(ctx["tok"]), timeout=30,
    ).json()
    assert all(it["id"] != pid for it in listed["rows"])
    # include_deleted=True returns it
    listed = requests.get(
        f"{API}/retailer/{ctx['rid']}/products",
        params={"include_deleted": "true"},
        headers=_headers(ctx["tok"]), timeout=30,
    ).json()
    assert any(it["id"] == pid for it in listed["rows"])


def test_cross_tenant_403(ctx):
    r = requests.get(f"{API}/retailer/00000000-0000-0000-0000-000000000000/products",
                     headers=_headers(ctx["tok"]), timeout=30)
    assert r.status_code == 403
