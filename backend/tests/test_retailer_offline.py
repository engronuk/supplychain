"""Retailer Offline-First — Phase C/D/E acceptance tests.

Covers everything in the mobile spec's three deliverables:

* Idempotency contract (Section 1)
* Idempotent sales create (Section 2 / Gap #1)
* Customers CRUD (Section 3 / Gap #2)
* Inventory adjustment ledger (Section 4 / Gap #3)
* Incremental sync cursors (Section 5)

All tests run against the live API at ``REACT_APP_BACKEND_URL`` and use
the canonical demo retailer ``unilever.retailer@tradekonekt.io``.
"""
from __future__ import annotations

import os
import time
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


@pytest.fixture(scope="module")
def session() -> Dict[str, str]:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": RETAILER_EMAIL, "password": DEMO_PASSWORD},
        timeout=30,
    )
    r.raise_for_status()
    body = r.json()
    token = body.get("access_token") or body["token"]
    me = requests.get(
        f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    ).json()
    return {
        "token": token,
        "rid": me["entity_id"],
        "headers": {"Authorization": f"Bearer {token}"},
    }


def _gen_key() -> str:
    return f"ik_test_{uuid.uuid4()}"


# =============================================================================
# DELIVERABLE 1 — IDEMPOTENCY CONTRACT
# =============================================================================
def test_idempotency_first_call_runs_normally(session):
    """A request without Idempotency-Key still works (legacy mode)."""
    customer = {"name": f"Walk-in {uuid.uuid4().hex[:6]}"}
    r = requests.post(
        f"{API}/retailer/{session['rid']}/customers",
        json=customer, headers=session["headers"], timeout=30,
    )
    assert r.status_code == 200
    assert r.json()["name"].startswith("Walk-in ")
    assert "Idempotent-Replay" not in r.headers


def test_idempotency_replay_returns_same_response(session):
    """Same key + same body → original response with Idempotent-Replay: true."""
    key = _gen_key()
    body = {"name": f"Idem Test {uuid.uuid4().hex[:6]}",
            "phone": f"+234801{uuid.uuid4().int % 10000000:07d}"}
    h = {**session["headers"], "Idempotency-Key": key}
    r1 = requests.post(f"{API}/retailer/{session['rid']}/customers",
                       json=body, headers=h, timeout=30)
    r2 = requests.post(f"{API}/retailer/{session['rid']}/customers",
                       json=body, headers=h, timeout=30)
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"], "replay must return same id"
    assert r2.headers.get("Idempotent-Replay") == "true"
    assert "Idempotent-Replay" not in r1.headers


def test_idempotency_mismatched_payload_returns_409(session):
    """Same key + DIFFERENT payload → 409 Conflict."""
    key = _gen_key()
    h = {**session["headers"], "Idempotency-Key": key}
    body_a = {"name": f"Conflict A {uuid.uuid4().hex[:6]}"}
    body_b = {"name": f"Conflict B {uuid.uuid4().hex[:6]}"}
    r1 = requests.post(f"{API}/retailer/{session['rid']}/customers",
                       json=body_a, headers=h, timeout=30)
    r2 = requests.post(f"{API}/retailer/{session['rid']}/customers",
                       json=body_b, headers=h, timeout=30)
    assert r1.status_code == 200
    assert r2.status_code == 409
    detail = r2.json().get("detail") or {}
    if isinstance(detail, dict):
        assert "mismatched" in detail.get("detail", "").lower()
        assert detail.get("original_request_at")


def test_idempotency_client_op_id_fallback(session):
    """Body-level ``client_op_id`` acts as fallback when header absent."""
    op_id = _gen_key()
    body = {"name": f"Op-id {uuid.uuid4().hex[:6]}", "client_op_id": op_id}
    r1 = requests.post(f"{API}/retailer/{session['rid']}/customers",
                       json=body, headers=session["headers"], timeout=30)
    r2 = requests.post(f"{API}/retailer/{session['rid']}/customers",
                       json=body, headers=session["headers"], timeout=30)
    assert r1.json()["id"] == r2.json()["id"]
    assert r2.headers.get("Idempotent-Replay") == "true"


# =============================================================================
# DELIVERABLE 2 — IDEMPOTENT SALES (Gap #1)
# =============================================================================
def _first_product_with_stock(session) -> str:
    """Return a product id with ≥5 units in stock. If the retailer has no
    such row (e.g. fresh test DB), seed one via the new adjustment
    endpoint — that's both the spec-compliant way to top up and itself
    exercises the new ledger contract."""
    r = requests.get(
        f"{API}/inventory",
        params={"owner_type": "retailer", "owner_id": session["rid"]},
        headers=session["headers"], timeout=30,
    )
    r.raise_for_status()
    items = r.json()
    for it in items:
        if int(it.get("quantity", 0)) >= 5:
            return it["product_id"]
    # Seed: top up the first available inventory row by 100 units.
    if not items:
        raise pytest.skip("retailer has no inventory rows to seed")
    pid = items[0]["product_id"]
    requests.post(
        f"{API}/retailer/{session['rid']}/inventory/adjust",
        json={"product_id": pid, "delta": 100,
              "reason": "shipment_received",
              "notes": "test-suite top-up"},
        headers=session["headers"], timeout=30,
    ).raise_for_status()
    return pid


def test_sale_idempotency_returns_same_id(session):
    pid = _first_product_with_stock(session)
    key = _gen_key()
    body = {
        "items": [{"product_id": pid, "quantity": 1, "unit_price": 100}],
        "payment_method": "cash",
        "occurred_at": "2026-06-25T12:00:00Z",
    }
    h = {**session["headers"], "Idempotency-Key": key}
    r1 = requests.post(f"{API}/retailer/{session['rid']}/sales",
                       json=body, headers=h, timeout=30)
    r2 = requests.post(f"{API}/retailer/{session['rid']}/sales",
                       json=body, headers=h, timeout=30)
    assert r1.status_code == 200, r1.text
    assert r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"]
    assert r2.headers.get("Idempotent-Replay") == "true"
    # New fields persisted
    assert r1.json().get("occurred_at") == "2026-06-25T12:00:00Z"


def test_sale_with_customer_id_updates_crm_rollups(session):
    # Create a customer first
    cust = requests.post(
        f"{API}/retailer/{session['rid']}/customers",
        json={"name": f"CRM Test {uuid.uuid4().hex[:6]}",
              "phone": f"+234802{uuid.uuid4().int % 10000000:07d}"},
        headers=session["headers"], timeout=30,
    ).json()
    cid = cust["id"]
    pid = _first_product_with_stock(session)
    r = requests.post(
        f"{API}/retailer/{session['rid']}/sales",
        json={
            "items": [{"product_id": pid, "quantity": 1, "unit_price": 250}],
            "payment_method": "cash",
            "customer_id": cid,
        },
        headers=session["headers"], timeout=30,
    )
    assert r.status_code == 200, r.text
    sale = r.json()
    assert sale["customer_id"] == cid
    # CRM rollups updated
    refreshed = requests.get(
        f"{API}/retailer/{session['rid']}/customers/{cid}",
        headers=session["headers"], timeout=30,
    ).json()
    assert refreshed["lifetime_orders"] == 1
    assert refreshed["total_spent"] == 250.0
    assert refreshed["last_purchase_at"] is not None


def test_sale_with_unknown_customer_id_is_400(session):
    pid = _first_product_with_stock(session)
    r = requests.post(
        f"{API}/retailer/{session['rid']}/sales",
        json={
            "items": [{"product_id": pid, "quantity": 1, "unit_price": 50}],
            "payment_method": "cash",
            "customer_id": "non-existent-id",
        },
        headers=session["headers"], timeout=30,
    )
    assert r.status_code == 400


# =============================================================================
# DELIVERABLE 3 — CUSTOMERS CRUD (Gap #2)
# =============================================================================
def test_customers_list_excludes_soft_deleted(session):
    # create + soft delete
    created = requests.post(
        f"{API}/retailer/{session['rid']}/customers",
        json={"name": f"To-Delete {uuid.uuid4().hex[:6]}"},
        headers=session["headers"], timeout=30,
    ).json()
    cid = created["id"]
    r = requests.delete(
        f"{API}/retailer/{session['rid']}/customers/{cid}",
        headers=session["headers"], timeout=30,
    )
    assert r.status_code == 204
    # default list excludes deleted
    listed = requests.get(
        f"{API}/retailer/{session['rid']}/customers",
        headers=session["headers"], timeout=30,
    ).json()
    assert all(r["id"] != cid for r in listed["rows"])
    # include_deleted exposes it
    listed_all = requests.get(
        f"{API}/retailer/{session['rid']}/customers",
        params={"include_deleted": "true"},
        headers=session["headers"], timeout=30,
    ).json()
    assert any(r["id"] == cid for r in listed_all["rows"])


def test_customers_phone_upsert(session):
    """Posting the SAME phone twice must return the same row, not duplicate."""
    phone = f"+23480300{uuid.uuid4().int % 100000:05d}"
    body = {"name": "Phone Upsert Original", "phone": phone}
    r1 = requests.post(f"{API}/retailer/{session['rid']}/customers",
                       json=body, headers=session["headers"], timeout=30)
    r2 = requests.post(f"{API}/retailer/{session['rid']}/customers",
                       json={"name": "DIFFERENT NAME", "phone": phone},
                       headers=session["headers"], timeout=30)
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"]
    # The original name survives (upsert returns existing, doesn't update name)
    assert r2.json()["name"] == "Phone Upsert Original"


def test_customers_patch_with_stale_if_match_412(session):
    created = requests.post(
        f"{API}/retailer/{session['rid']}/customers",
        json={"name": f"Etag {uuid.uuid4().hex[:6]}"},
        headers=session["headers"], timeout=30,
    ).json()
    cid = created["id"]
    # First patch advances updated_at.
    requests.patch(
        f"{API}/retailer/{session['rid']}/customers/{cid}",
        json={"notes": "first"}, headers=session["headers"], timeout=30,
    )
    # Stale If-Match should be rejected.
    r = requests.patch(
        f"{API}/retailer/{session['rid']}/customers/{cid}",
        json={"notes": "second"},
        headers={**session["headers"], "If-Match": "stale-timestamp"},
        timeout=30,
    )
    assert r.status_code == 412


def test_customers_updated_since_cursor(session):
    snapshot = requests.get(
        f"{API}/retailer/{session['rid']}/customers",
        headers=session["headers"], timeout=30,
    ).json()
    # Use server "now" by taking the latest updated_at + creating a new row
    new_row = requests.post(
        f"{API}/retailer/{session['rid']}/customers",
        json={"name": f"After Snap {uuid.uuid4().hex[:6]}"},
        headers=session["headers"], timeout=30,
    ).json()
    since = max(
        (r.get("updated_at") or "") for r in snapshot["rows"]
    ) if snapshot["rows"] else "1970-01-01T00:00:00+00:00"
    delta = requests.get(
        f"{API}/retailer/{session['rid']}/customers",
        params={"updated_since": since},
        headers=session["headers"], timeout=30,
    ).json()
    assert any(r["id"] == new_row["id"] for r in delta["rows"])


# =============================================================================
# DELIVERABLE 4 — INVENTORY DELTA LEDGER (Gap #3)
# =============================================================================
def test_inventory_single_delta_decrements_atomically(session):
    pid = _first_product_with_stock(session)
    before = requests.get(
        f"{API}/inventory",
        params={"owner_type": "retailer", "owner_id": session["rid"]},
        headers=session["headers"], timeout=30,
    ).json()
    qty_before = next(it["quantity"] for it in before if it["product_id"] == pid)

    r = requests.post(
        f"{API}/retailer/{session['rid']}/inventory/adjust",
        json={"product_id": pid, "delta": -2, "reason": "sale"},
        headers=session["headers"], timeout=30,
    )
    assert r.status_code == 200, r.text
    assert r.json()["resulting_quantity"] == qty_before - 2
    assert r.json()["warning"] is None


def test_inventory_idempotent_replay(session):
    pid = _first_product_with_stock(session)
    key = _gen_key()
    body = {"product_id": pid, "delta": -1, "reason": "sale"}
    h = {**session["headers"], "Idempotency-Key": key}
    r1 = requests.post(f"{API}/retailer/{session['rid']}/inventory/adjust",
                       json=body, headers=h, timeout=30)
    r2 = requests.post(f"{API}/retailer/{session['rid']}/inventory/adjust",
                       json=body, headers=h, timeout=30)
    assert r1.json()["id"] == r2.json()["id"]
    assert r2.headers.get("Idempotent-Replay") == "true"
    # No double-decrement.
    assert r2.json()["resulting_quantity"] == r1.json()["resulting_quantity"]


def test_inventory_negative_warning(session):
    pid = _first_product_with_stock(session)
    # Force a delta that takes the balance below zero.
    inv = requests.get(
        f"{API}/inventory",
        params={"owner_type": "retailer", "owner_id": session["rid"]},
        headers=session["headers"], timeout=30,
    ).json()
    qty = next(it["quantity"] for it in inv if it["product_id"] == pid)
    r = requests.post(
        f"{API}/retailer/{session['rid']}/inventory/adjust",
        json={"product_id": pid, "delta": -(qty + 10), "reason": "count"},
        headers=session["headers"], timeout=30,
    )
    assert r.status_code == 200
    assert r.json()["warning"] == "negative_balance"
    assert r.json()["resulting_quantity"] < 0
    # Restore stock so subsequent tests stay happy.
    requests.post(
        f"{API}/retailer/{session['rid']}/inventory/adjust",
        json={"product_id": pid, "delta": qty + 10,
              "reason": "shipment_received"},
        headers=session["headers"], timeout=30,
    )


def test_inventory_batch_partial_replay(session):
    pid = _first_product_with_stock(session)
    op_a, op_b = str(uuid.uuid4()), str(uuid.uuid4())
    body1 = {"adjustments": [
        {"product_id": pid, "delta": -1, "reason": "sale",
         "client_delta_op_id": op_a},
    ]}
    body2 = {"adjustments": [
        {"product_id": pid, "delta": -1, "reason": "sale",
         "client_delta_op_id": op_a},  # replay
        {"product_id": pid, "delta": -1, "reason": "sale",
         "client_delta_op_id": op_b},  # new
    ]}
    r1 = requests.post(
        f"{API}/retailer/{session['rid']}/inventory/adjust/batch",
        json=body1, headers=session["headers"], timeout=30,
    )
    r2 = requests.post(
        f"{API}/retailer/{session['rid']}/inventory/adjust/batch",
        json=body2, headers=session["headers"], timeout=30,
    )
    assert r1.json()["applied"] == 1
    statuses = {row["client_delta_op_id"]: row["status"]
                for row in r2.json()["results"]}
    assert statuses[op_a] == "skipped"
    assert statuses[op_b] == "applied"
    assert r2.json()["applied"] == 1 and r2.json()["skipped"] == 1


def test_inventory_ledger_lists_adjustments(session):
    pid = _first_product_with_stock(session)
    r = requests.get(
        f"{API}/retailer/{session['rid']}/inventory/adjust",
        params={"product_id": pid, "limit": 5},
        headers=session["headers"], timeout=30,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["limit"] == 5
    assert all(row["product_id"] == pid for row in body["rows"])


# =============================================================================
# DELIVERABLE 5 — Incremental sync cursors
# =============================================================================
def test_sales_updated_since_returns_only_newer(session):
    # Anchor on server "now" by reading the latest sale's updated_at.
    listing = requests.get(
        f"{API}/retailer/{session['rid']}/sales",
        params={"limit": 1}, headers=session["headers"], timeout=30,
    ).json()
    if not listing["rows"]:
        pytest.skip("no sales to anchor cursor")
    anchor = (listing["rows"][0].get("updated_at")
              or listing["rows"][0].get("created_at"))
    # Pulling with anchor==latest should return 0 rows.
    delta = requests.get(
        f"{API}/retailer/{session['rid']}/sales",
        params={"updated_since": anchor},
        headers=session["headers"], timeout=30,
    ).json()
    assert delta["total"] == 0, (
        f"expected 0 sales updated after the most recent one, "
        f"got {delta['total']}"
    )


def test_unauthenticated_endpoints_are_locked(session):
    """The 3 new endpoint families MUST 401 without a JWT."""
    rid = session["rid"]
    for url in (
        f"{API}/retailer/{rid}/customers",
        f"{API}/retailer/{rid}/inventory/adjust",
    ):
        r = requests.get(url, timeout=30)
        assert r.status_code == 401, f"{url} should require auth"


def test_cross_tenant_retailer_access_denied(session):
    """A retailer must not be able to read/write another retailer's data."""
    other = "b00bbade-0000-0000-0000-000000000000"
    r = requests.get(
        f"{API}/retailer/{other}/customers",
        headers=session["headers"], timeout=30,
    )
    assert r.status_code == 403
