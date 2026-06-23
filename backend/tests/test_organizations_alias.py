"""Regression for the 2026-06-23 mobile↔web wholesaler-mismatch bug.

Mobile clients historically sent ``type=`` / ``distributor_id=`` /
``manufacturer_id=`` on ``/api/organizations``. The strict schema silently
ignored those params and returned the user's full subtree, which mobile
then filtered client-side on the non-existent ``.type`` field, yielding 0
rows. The fix:

1. Accept ``type`` / ``distributor_id`` / ``wholesaler_id`` / ``parent_id``
   as direct-parent aliases.
2. Accept ``manufacturer_id`` as an ancestor-scope filter via lineage_path.
3. Emit ``.type`` / ``.parent_id`` / ``.name`` aliases in the response.

This regression locks the contract in place so the bug cannot recur.
"""
from __future__ import annotations

import os

import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as fh:
        for line in fh:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.strip().split("=", 1)[1].rstrip("/")
API = f"{BASE_URL}/api"

DEMO_PASSWORD = "TradeKonekt2026!"
APEX_DISTRIBUTOR_EMAIL = "mfr-0001-dst-0001@tradekonekt.io"
APEX_DISTRIBUTOR_ID = "f9dfaf08-4ee2-3c64-e96b-983c385625b2"
ADMIN_EMAIL = "admin@tradekonekt.io"
UNILEVER_ID = "b21c1dbe-1a6f-4c33-b036-f416579455d0"


def _login(email: str) -> str:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": email, "password": DEMO_PASSWORD},
        timeout=30,
    )
    r.raise_for_status()
    body = r.json()
    return body.get("access_token") or body["token"]


def test_mobile_aliases_return_canonical_wholesalers():
    """`type=wholesaler&distributor_id=...` (mobile aliases) must return
    exactly the same rows as the canonical params."""
    token = _login(APEX_DISTRIBUTOR_EMAIL)
    headers = {"Authorization": f"Bearer {token}"}
    alias_resp = requests.get(
        f"{API}/organizations",
        params={"type": "wholesaler", "distributor_id": APEX_DISTRIBUTOR_ID},
        headers=headers, timeout=30,
    )
    canonical_resp = requests.get(
        f"{API}/organizations",
        params={"organization_type": "wholesaler",
                "parent_organization_id": APEX_DISTRIBUTOR_ID},
        headers=headers, timeout=30,
    )
    assert alias_resp.status_code == 200
    assert canonical_resp.status_code == 200
    alias_ids = sorted(r["id"] for r in alias_resp.json())
    canonical_ids = sorted(r["id"] for r in canonical_resp.json())
    assert alias_ids == canonical_ids
    assert len(alias_ids) == 3, (
        f"Apex should have 3 wholesalers, got {len(alias_ids)}"
    )


def test_response_carries_type_alias():
    """Each row must expose ``type``/``parent_id``/``name`` aliases."""
    token = _login(APEX_DISTRIBUTOR_EMAIL)
    r = requests.get(
        f"{API}/organizations",
        params={"type": "wholesaler", "distributor_id": APEX_DISTRIBUTOR_ID},
        headers={"Authorization": f"Bearer {token}"}, timeout=30,
    )
    assert r.status_code == 200
    rows = r.json()
    assert rows, "expected at least one row"
    for row in rows:
        assert row.get("type") == row.get("organization_type")
        assert row.get("parent_id") == row.get("parent_organization_id")
        assert row.get("name") == row.get("organization_name")


def test_manufacturer_id_alias_filters_by_ancestor():
    """`manufacturer_id` is an ancestor-scope filter. Querying for
    Unilever wholesalers must yield exactly the 18 in the seed."""
    token = _login(ADMIN_EMAIL)
    r = requests.get(
        f"{API}/organizations",
        params={"type": "wholesaler", "manufacturer_id": UNILEVER_ID},
        headers={"Authorization": f"Bearer {token}"}, timeout=30,
    )
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 18, (
        f"expected 18 Unilever wholesalers, got {len(rows)}"
    )
    for row in rows:
        assert row["organization_type"] == "wholesaler"
