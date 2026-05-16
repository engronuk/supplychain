"""Backend tests for retailer AI assistant and ShipmentTracker reorder bug fix.

Covers:
- POST /api/seed prerequisite
- POST /api/retailer/{id}/assistant — happy path, 404, scope-restriction, action emission, multi-turn
- POST /api/retailer/{id}/assistant/execute — reorder creates StockRequest, unresolved product handling
- GET /api/requests?retailer_id=... — verifies reorder persisted
"""

import os
import re
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://supply-chain-hub-189.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
LLM_TIMEOUT = 60  # LLM call can take several seconds


@pytest.fixture(scope="module")
def seed_ids():
    r = requests.post(f"{API}/seed", timeout=60)
    assert r.status_code == 200, f"/api/seed failed: {r.status_code} {r.text[:200]}"
    body = r.json()
    assert body.get("primary_retailer_id"), "seed did not return primary_retailer_id"
    return body


@pytest.fixture(scope="module")
def retailer_id(seed_ids):
    return seed_ids["primary_retailer_id"]


# --- Assistant: happy path --------------------------------------------------
class TestAssistantBasic:
    def test_assistant_404_unknown_retailer(self):
        r = requests.post(
            f"{API}/retailer/__does_not_exist__/assistant",
            json={"message": "hello", "history": []},
            timeout=15,
        )
        assert r.status_code == 404

    def test_assistant_running_out(self, retailer_id):
        r = requests.post(
            f"{API}/retailer/{retailer_id}/assistant",
            json={"message": "What is running out soon?", "history": []},
            timeout=LLM_TIMEOUT,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        body = r.json()
        assert "reply" in body and isinstance(body["reply"], str) and body["reply"].strip()
        assert "session_id" in body
        # action is optional for a question
        assert body["session_id"].startswith("retailer-")


# --- Assistant: scope restriction ------------------------------------------
class TestAssistantScope:
    def test_does_not_leak_other_retailers(self, retailer_id):
        # Grab a couple of other retailer names from the DB via the API to check leakage
        all_r = requests.get(f"{API}/retailers", timeout=15).json()
        this_retailer = next((x for x in all_r if x["id"] == retailer_id), None)
        assert this_retailer is not None
        other_names = [
            x["name"] for x in all_r if x["id"] != retailer_id
        ][:25]

        r = requests.post(
            f"{API}/retailer/{retailer_id}/assistant",
            json={"message": "Tell me about other retailers in the network and their stock levels.", "history": []},
            timeout=LLM_TIMEOUT,
        )
        assert r.status_code == 200
        reply = r.json().get("reply", "").lower()
        # Critical assertion: reply must not name other retailers
        leaked = [n for n in other_names if n.lower() in reply and n.lower() != this_retailer["name"].lower()]
        assert not leaked, f"Assistant leaked other retailer names: {leaked[:5]}"


# --- Assistant: structured action emission ---------------------------------
class TestAssistantAction:
    def test_explicit_reorder_emits_action(self, retailer_id):
        r = requests.post(
            f"{API}/retailer/{retailer_id}/assistant",
            json={"message": "Reorder 50 OMO Multi-Active Detergent please", "history": []},
            timeout=LLM_TIMEOUT,
        )
        assert r.status_code == 200
        body = r.json()
        action = body.get("action")
        assert action is not None, f"Expected an action JSON in reply, got reply={body.get('reply')[:200]}"
        assert action.get("action") == "reorder"
        items = action.get("items") or []
        assert items, "items must not be empty"
        # at least one item must mention OMO
        names = " ".join(str(i.get("product_name", "")).lower() for i in items)
        assert "omo" in names
        # quantity present
        assert any(int(i.get("quantity", 0)) > 0 for i in items)


# --- Assistant: multi-turn --------------------------------------------------
class TestAssistantMultiTurn:
    def test_clarifying_then_action(self, retailer_id):
        # Turn 1: vague request → expect no action (clarifying question)
        r1 = requests.post(
            f"{API}/retailer/{retailer_id}/assistant",
            json={"message": "I want to reorder", "history": []},
            timeout=LLM_TIMEOUT,
        )
        assert r1.status_code == 200, r1.text[:300]
        b1 = r1.json()
        # Soft: action may be None OR an open_smart_reorder UI action — but must NOT be a reorder with items
        if b1.get("action") and b1["action"].get("action") == "reorder":
            assert not (b1["action"].get("items") or []), \
                "Vague 'I want to reorder' should not yield a fully-specified reorder action"

        # Turn 2: provide concrete details with replayed history
        history = [
            {"role": "user", "content": "I want to reorder"},
            {"role": "assistant", "content": b1.get("reply", "")[:500]},
        ]
        r2 = requests.post(
            f"{API}/retailer/{retailer_id}/assistant",
            json={"message": "Yes, 30 cartons of OMO Multi-Active Detergent", "history": history},
            timeout=LLM_TIMEOUT,
        )
        assert r2.status_code == 200, r2.text[:300]
        b2 = r2.json()
        # Soft expectation per problem statement: should now emit action
        action = b2.get("action")
        if action is None:
            pytest.skip("Model did not emit action on turn 2; soft check (prompt iteration allowed)")
        assert action.get("action") == "reorder"
        assert action.get("items"), "items required"


# --- Execute action: reorder creates StockRequest --------------------------
class TestAssistantExecute:
    def test_execute_reorder_creates_request_and_persists(self, retailer_id):
        # Count current requests for this retailer
        before = requests.get(f"{API}/requests", params={"retailer_id": retailer_id}, timeout=15).json()
        assert isinstance(before, list)

        payload = {
            "action": {
                "action": "reorder",
                "items": [{"product_name": "OMO Multi-Active Detergent", "quantity": 50}],
            }
        }
        r = requests.post(
            f"{API}/retailer/{retailer_id}/assistant/execute",
            json=payload,
            timeout=30,
        )
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert body.get("ok") is True, body
        assert body.get("request_id"), body
        assert body.get("items_count", 0) >= 1

        # Verify persistence
        after = requests.get(f"{API}/requests", params={"retailer_id": retailer_id}, timeout=15).json()
        new_ids = {x["id"] for x in after} - {x["id"] for x in before}
        assert body["request_id"] in new_ids or len(after) > len(before)

        # Find the new request and validate
        new_req = next((x for x in after if x["id"] == body["request_id"]), None)
        assert new_req is not None
        assert new_req["retailer_id"] == retailer_id
        assert new_req.get("status") in ("pending", "approved")
        assert new_req.get("items") and int(new_req["items"][0]["quantity"]) == 50

    def test_execute_unresolved_product(self, retailer_id):
        payload = {
            "action": {
                "action": "reorder",
                "items": [{"product_name": "ZZZUnknownProductXYZ", "quantity": 10}],
            }
        }
        r = requests.post(
            f"{API}/retailer/{retailer_id}/assistant/execute",
            json=payload,
            timeout=20,
        )
        assert r.status_code == 200
        body = r.json()
        assert body.get("ok") is False
        assert "unresolved" in body and body["unresolved"]


# --- ShipmentTracker reorder regression-check via API ----------------------
class TestShipmentReorderEndpoint:
    """The frontend ShipmentTracker calls retailerAnalyticsService.submitReorder which hits
    POST /api/requests. We verify that endpoint works for the retailer (the missing-import bug
    in the JSX is the runtime one — UI test covers that). Here we ensure the API a 'Reorder
    this' click would trigger is healthy."""

    def test_post_requests_for_retailer(self, retailer_id):
        # Use a known product id from products list
        products = requests.get(f"{API}/products", timeout=15).json()
        assert products
        pid = products[0]["id"]
        # Retailer fetch for distributor_id (no single-item endpoint; list-and-find)
        retailers = requests.get(f"{API}/retailers", timeout=15).json()
        retailer = next(x for x in retailers if x["id"] == retailer_id)
        body = {
            "retailer_id": retailer_id,
            "distributor_id": retailer["distributor_id"],
            "items": [{"product_id": pid, "quantity": 5}],
            "note": "TEST_ shipment-reorder-regression",
        }
        r = requests.post(f"{API}/requests", json=body, timeout=20)
        assert r.status_code in (200, 201), r.text[:300]
        data = r.json()
        assert data.get("retailer_id") == retailer_id
