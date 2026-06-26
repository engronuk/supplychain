"""Retailer-Private Products — off-ecosystem SKU onboarding.

Covers the 2026-06-26 capability that lets a retailer sell products
from manufacturers that are NOT in the TradeKonekt ecosystem.

Acceptance criteria:

1. Retailer can create a private product (`POST /retailer/{rid}/products`).
2. The product appears in the retailer's own product list and in the
   global `/api/products` they receive (so the POS picker shows it).
3. Other retailers do NOT see it in their global `/api/products`.
4. Manufacturers / wholesalers do NOT see it.
5. The retailer can immediately stock the product via the normal
   inventory adjustment endpoint and sell it through `POST /sales`.
6. Sales of private products work atomically and produce a sale row.
7. PATCH / DELETE are scoped to the owning retailer.
"""
from __future__ import annotations

import os
import uuid
from typing import Dict

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as fh:
        for line in fh:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.strip().split("=", 1)[1].rstrip("/")
API = f"{BASE_URL}/api"
DEMO_PASSWORD = "TradeKonekt2026!"
RETAILER_EMAIL = "unilever.retailer@tradekonekt.io"


def _login(email: str) -> Dict[str, str]:
    r = requests.post(f"{API}/auth/login",
                      json={"email": email, "password": DEMO_PASSWORD},
                      timeout=30)
    r.raise_for_status()
    body = r.json()
    return {"token": body.get("access_token") or body["token"]}


@pytest.fixture(scope="module")
def session() -> Dict[str, str]:
    auth = _login(RETAILER_EMAIL)
    me = requests.get(f"{API}/auth/me",
                      headers={"Authorization": f"Bearer {auth['token']}"},
                      timeout=30).json()
    return {**auth, "rid": me["entity_id"],
            "headers": {"Authorization": f"Bearer {auth['token']}"}}


def test_retailer_can_onboard_off_ecosystem_product(session):
    r = requests.post(
        f"{API}/retailer/{session['rid']}/products",
        json={"name": f"Mama Nkechi Snacks {uuid.uuid4().hex[:6]}",
              "category": "Local Snacks",
              "unit_price": 250,
              "external_manufacturer": "Mama Nkechi Foods Ltd"},
        headers=session["headers"], timeout=30,
    )
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["is_private"] is True
    assert p["source"] == "retailer_private"
    assert p["owner_id"] == session["rid"]
    assert p["external_manufacturer"] == "Mama Nkechi Foods Ltd"
    assert p["sku"].startswith("PRIV-")
    # Inventory row auto-created at quantity 0.
    inv = requests.get(
        f"{API}/inventory",
        params={"owner_type": "retailer", "owner_id": session["rid"]},
        headers=session["headers"], timeout=30,
    ).json()
    assert any(it["product_id"] == p["id"] for it in inv), (
        "auto-inventory row should exist for the new private product"
    )


def test_private_product_appears_in_retailer_global_products(session):
    # Create
    created = requests.post(
        f"{API}/retailer/{session['rid']}/products",
        json={"name": f"Discoverable {uuid.uuid4().hex[:6]}",
              "category": "Test", "unit_price": 100},
        headers=session["headers"], timeout=30,
    ).json()
    # Retailer's view of /api/products MUST include it.
    glob = requests.get(f"{API}/products",
                        headers=session["headers"], timeout=30).json()
    assert any(p["id"] == created["id"] for p in glob), (
        "owning retailer's /api/products MUST include their private SKU"
    )


def test_private_product_invisible_to_manufacturer(session):
    created = requests.post(
        f"{API}/retailer/{session['rid']}/products",
        json={"name": f"Hidden {uuid.uuid4().hex[:6]}",
              "category": "Test", "unit_price": 100},
        headers=session["headers"], timeout=30,
    ).json()
    mfr_auth = _login("unilever@tradekonekt.io")
    glob = requests.get(
        f"{API}/products",
        headers={"Authorization": f"Bearer {mfr_auth['token']}"},
        timeout=30,
    ).json()
    assert not any(p.get("id") == created["id"] for p in glob), (
        "manufacturer must NOT see another retailer's private SKU"
    )


def test_retailer_can_stock_and_sell_private_product(session):
    created = requests.post(
        f"{API}/retailer/{session['rid']}/products",
        json={"name": f"Sellable {uuid.uuid4().hex[:6]}",
              "category": "Test", "unit_price": 500,
              "external_manufacturer": "Test Brand"},
        headers=session["headers"], timeout=30,
    ).json()
    pid = created["id"]
    # Top up via the standard delta endpoint.
    r = requests.post(
        f"{API}/retailer/{session['rid']}/inventory/adjust",
        json={"product_id": pid, "delta": 10,
              "reason": "shipment_received"},
        headers=session["headers"], timeout=30,
    )
    assert r.status_code == 200
    assert r.json()["resulting_quantity"] == 10
    # Sell.
    sale = requests.post(
        f"{API}/retailer/{session['rid']}/sales",
        json={"items": [{"product_id": pid, "quantity": 3,
                         "unit_price": 500}],
              "payment_method": "cash"},
        headers=session["headers"], timeout=30,
    )
    assert sale.status_code == 200, sale.text
    # Inventory decremented to 7.
    inv = requests.get(
        f"{API}/inventory",
        params={"owner_type": "retailer", "owner_id": session["rid"]},
        headers=session["headers"], timeout=30,
    ).json()
    row = next(it for it in inv if it["product_id"] == pid)
    assert row["quantity"] == 7


def test_private_product_patch_and_soft_delete(session):
    created = requests.post(
        f"{API}/retailer/{session['rid']}/products",
        json={"name": f"Mutable {uuid.uuid4().hex[:6]}",
              "category": "Test", "unit_price": 100},
        headers=session["headers"], timeout=30,
    ).json()
    pid = created["id"]
    # Patch
    r = requests.patch(
        f"{API}/retailer/{session['rid']}/products/{pid}",
        json={"unit_price": 150, "category": "Updated"},
        headers=session["headers"], timeout=30,
    )
    assert r.status_code == 200
    assert r.json()["unit_price"] == 150
    assert r.json()["category"] == "Updated"
    # Soft-delete
    d = requests.delete(
        f"{API}/retailer/{session['rid']}/products/{pid}",
        headers=session["headers"], timeout=30,
    )
    assert d.status_code == 204
    # Default list excludes deleted.
    listed = requests.get(
        f"{API}/retailer/{session['rid']}/products",
        headers=session["headers"], timeout=30,
    ).json()
    assert all(r["id"] != pid for r in listed["rows"])


def test_idempotent_create(session):
    key = f"ik_{uuid.uuid4()}"
    body = {"name": f"Idempotent {uuid.uuid4().hex[:6]}",
            "category": "Test", "unit_price": 99}
    h = {**session["headers"], "Idempotency-Key": key}
    r1 = requests.post(f"{API}/retailer/{session['rid']}/products",
                       json=body, headers=h, timeout=30)
    r2 = requests.post(f"{API}/retailer/{session['rid']}/products",
                       json=body, headers=h, timeout=30)
    assert r1.json()["id"] == r2.json()["id"]
    assert r2.headers.get("Idempotent-Replay") == "true"


def test_cross_tenant_product_access_denied(session):
    other_rid = "00000000-0000-0000-0000-000000000000"
    r = requests.get(f"{API}/retailer/{other_rid}/products",
                     headers=session["headers"], timeout=30)
    assert r.status_code == 403
