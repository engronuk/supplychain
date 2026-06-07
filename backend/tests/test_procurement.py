"""Pytest suite for the Retailer Procurement workspace."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001")

# Demo retailer with active sales velocity
RETAILER_ID = "29c22c05-b37e-4046-ad22-1c627fdd0395"   # Best Supermarket
DISTRIBUTOR_ID = "d95dc722-679b-4ece-ab5e-af5e0dedd8ce"  # SUARA & CO.


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    yield sess


def _pick_product():
    r = requests.get(f"{BASE_URL}/api/products", timeout=10)
    return r.json()[0]["id"]


class TestCart:
    def test_get_empty_cart(self, s):
        # Clear first
        s.delete(f"{BASE_URL}/api/procurement/cart/{RETAILER_ID}", timeout=10)
        r = s.get(f"{BASE_URL}/api/procurement/cart/{RETAILER_ID}", timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body["retailer_id"] == RETAILER_ID
        assert body["items"] == []
        assert body["subtotal"] == 0
        assert body["by_supplier"] == []

    def test_add_item(self, s):
        pid = _pick_product()
        r = s.post(
            f"{BASE_URL}/api/procurement/cart/{RETAILER_ID}/items",
            json={"product_id": pid, "distributor_id": DISTRIBUTOR_ID,
                  "quantity": 10, "unit_cost": 500},
            timeout=10,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["unique_skus"] == 1
        assert body["item_count"] == 10
        assert body["subtotal"] == 5000.0
        assert len(body["by_supplier"]) == 1

    def test_update_item_quantity(self, s):
        pid = _pick_product()
        r = s.patch(
            f"{BASE_URL}/api/procurement/cart/{RETAILER_ID}/items/{pid}",
            params={"distributor_id": DISTRIBUTOR_ID},
            json={"quantity": 15},
            timeout=10,
        )
        assert r.status_code == 200
        body = r.json()
        item = next(i for i in body["items"] if i["product_id"] == pid)
        assert item["quantity"] == 15
        assert body["subtotal"] == 7500.0

    def test_remove_item(self, s):
        pid = _pick_product()
        r = s.delete(
            f"{BASE_URL}/api/procurement/cart/{RETAILER_ID}/items/{pid}",
            params={"distributor_id": DISTRIBUTOR_ID},
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json()["unique_skus"] == 0

    def test_submit_cart_creates_pos(self, s):
        pid = _pick_product()
        s.post(
            f"{BASE_URL}/api/procurement/cart/{RETAILER_ID}/items",
            json={"product_id": pid, "distributor_id": DISTRIBUTOR_ID,
                  "quantity": 20, "unit_cost": 600},
            timeout=10,
        )
        r = s.post(
            f"{BASE_URL}/api/procurement/cart/{RETAILER_ID}/submit",
            json={},
            timeout=10,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["count"] >= 1
        po = body["purchase_orders"][0]
        assert po["po_number"].startswith("PO-")
        assert po["status"] == "submitted"
        assert po["total_amount"] == 12000

    def test_submit_empty_cart_400(self, s):
        s.delete(f"{BASE_URL}/api/procurement/cart/{RETAILER_ID}", timeout=10)
        r = s.post(
            f"{BASE_URL}/api/procurement/cart/{RETAILER_ID}/submit",
            json={},
            timeout=10,
        )
        assert r.status_code == 400


class TestPurchaseOrders:
    def test_list_pos(self, s):
        r = s.get(f"{BASE_URL}/api/procurement/purchase-orders", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body, list)
        assert len(body) > 0
        # All POs include enriched fields
        po = body[0]
        for k in ("po_number", "status", "total_amount", "items", "status_history",
                  "distributor", "retailer"):
            assert k in po

    def test_filter_by_status(self, s):
        r = s.get(f"{BASE_URL}/api/procurement/purchase-orders",
                  params={"status": "delivered"}, timeout=15)
        assert r.status_code == 200
        for po in r.json():
            assert po["status"] == "delivered"

    def test_filter_by_statuses_csv(self, s):
        r = s.get(f"{BASE_URL}/api/procurement/purchase-orders",
                  params={"statuses": "submitted,approved"}, timeout=15)
        assert r.status_code == 200
        for po in r.json():
            assert po["status"] in ("submitted", "approved")

    def test_lifecycle_actions(self, s):
        pid = _pick_product()
        # Create a draft then walk it through full lifecycle
        po = s.post(
            f"{BASE_URL}/api/procurement/purchase-orders",
            json={
                "retailer_id": RETAILER_ID,
                "distributor_id": DISTRIBUTOR_ID,
                "items": [{
                    "product_id": pid, "distributor_id": DISTRIBUTOR_ID,
                    "quantity": 5, "unit_cost": 100,
                }],
                "note": "lifecycle test",
            },
            timeout=10,
        ).json()
        assert po["status"] == "draft"
        po_id = po["id"]
        for action, expected in [
            ("submit", "submitted"), ("approve", "approved"),
            ("process", "processing"), ("ship", "shipped"),
            ("deliver", "delivered"),
        ]:
            r = s.post(
                f"{BASE_URL}/api/procurement/purchase-orders/{po_id}/{action}",
                json={}, timeout=10,
            )
            assert r.status_code == 200, f"{action} failed: {r.text}"
            assert r.json()["status"] == expected

    def test_cancel(self, s):
        pid = _pick_product()
        po = s.post(
            f"{BASE_URL}/api/procurement/purchase-orders",
            json={
                "retailer_id": RETAILER_ID,
                "distributor_id": DISTRIBUTOR_ID,
                "items": [{"product_id": pid, "distributor_id": DISTRIBUTOR_ID,
                          "quantity": 3, "unit_cost": 50}],
            },
            params={"submit": "true"},
            timeout=10,
        ).json()
        r = s.post(
            f"{BASE_URL}/api/procurement/purchase-orders/{po['id']}/cancel",
            json={"reason": "Test cancellation"},
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json()["status"] == "cancelled"
        assert r.json()["cancel_reason"] == "Test cancellation"

    def test_duplicate(self, s):
        listing = s.get(
            f"{BASE_URL}/api/procurement/purchase-orders",
            params={"retailer_id": RETAILER_ID, "status": "delivered", "limit": 1},
            timeout=10,
        ).json()
        if not listing:
            pytest.skip("no delivered PO to duplicate")
        original = listing[0]
        r = s.post(
            f"{BASE_URL}/api/procurement/purchase-orders/{original['id']}/duplicate",
            json={}, timeout=10,
        )
        assert r.status_code == 200
        dup = r.json()
        assert dup["status"] == "draft"
        assert dup["duplicate_of"] == original["id"]
        assert dup["po_number"] != original["po_number"]

    def test_invalid_transition_400(self, s):
        # Try to approve a draft (which must first be submitted)
        pid = _pick_product()
        draft = s.post(
            f"{BASE_URL}/api/procurement/purchase-orders",
            json={"retailer_id": RETAILER_ID, "distributor_id": DISTRIBUTOR_ID,
                  "items": [{"product_id": pid, "distributor_id": DISTRIBUTOR_ID,
                            "quantity": 1, "unit_cost": 10}]},
            timeout=10,
        ).json()
        r = s.post(
            f"{BASE_URL}/api/procurement/purchase-orders/{draft['id']}/approve",
            json={}, timeout=10,
        )
        assert r.status_code == 400


class TestQuotes:
    def test_create_and_respond(self, s):
        pid = _pick_product()
        ds = requests.get(f"{BASE_URL}/api/distributors", timeout=10).json()
        invited = [d["id"] for d in ds[:3]]
        r = s.post(
            f"{BASE_URL}/api/procurement/quotes",
            json={"retailer_id": RETAILER_ID, "product_id": pid,
                  "quantity": 100, "distributor_ids": invited},
            timeout=10,
        )
        assert r.status_code == 200
        q = r.json()
        assert q["quote_number"].startswith("QT-")
        assert q["status"] == "open"

        # Respond as the first invited distributor
        r2 = s.post(
            f"{BASE_URL}/api/procurement/quotes/{q['id']}/respond",
            json={"distributor_id": invited[0], "unit_price": 250,
                  "lead_time_days": 5, "moq": 50, "valid_until": "2026-12-31"},
            timeout=10,
        )
        assert r2.status_code == 200
        full = r2.json()
        assert full["status"] == "responded"
        assert len(full["responses"]) == 1
        assert full["best_offer"]["unit_price"] == 250

    def test_response_replaces_existing(self, s):
        pid = _pick_product()
        ds = requests.get(f"{BASE_URL}/api/distributors", timeout=10).json()
        invited = [d["id"] for d in ds[:2]]
        q = s.post(
            f"{BASE_URL}/api/procurement/quotes",
            json={"retailer_id": RETAILER_ID, "product_id": pid,
                  "quantity": 50, "distributor_ids": invited},
            timeout=10,
        ).json()
        # First response
        s.post(f"{BASE_URL}/api/procurement/quotes/{q['id']}/respond",
               json={"distributor_id": invited[0], "unit_price": 400,
                     "lead_time_days": 3, "moq": 25, "valid_until": "2026-12-01"},
               timeout=10)
        # Second response from the same distributor (should replace)
        r = s.post(f"{BASE_URL}/api/procurement/quotes/{q['id']}/respond",
                   json={"distributor_id": invited[0], "unit_price": 350,
                         "lead_time_days": 2, "moq": 30, "valid_until": "2026-12-15"},
                   timeout=10).json()
        same_dist_responses = [x for x in r["responses"] if x["distributor_id"] == invited[0]]
        assert len(same_dist_responses) == 1
        assert same_dist_responses[0]["unit_price"] == 350

    def test_respond_uninvited_403(self, s):
        pid = _pick_product()
        ds = requests.get(f"{BASE_URL}/api/distributors", timeout=10).json()
        invited = [ds[0]["id"]]
        q = s.post(f"{BASE_URL}/api/procurement/quotes",
                   json={"retailer_id": RETAILER_ID, "product_id": pid,
                         "quantity": 10, "distributor_ids": invited},
                   timeout=10).json()
        outsider = ds[2]["id"]
        r = s.post(f"{BASE_URL}/api/procurement/quotes/{q['id']}/respond",
                   json={"distributor_id": outsider, "unit_price": 100,
                         "lead_time_days": 2, "moq": 10, "valid_until": "2026-12-31"},
                   timeout=10)
        assert r.status_code == 403

    def test_close_quote(self, s):
        pid = _pick_product()
        ds = requests.get(f"{BASE_URL}/api/distributors", timeout=10).json()
        q = s.post(f"{BASE_URL}/api/procurement/quotes",
                   json={"retailer_id": RETAILER_ID, "product_id": pid,
                         "quantity": 10, "distributor_ids": [ds[0]["id"]]},
                   timeout=10).json()
        r = s.post(f"{BASE_URL}/api/procurement/quotes/{q['id']}/close",
                   timeout=10)
        assert r.status_code == 200
        assert r.json()["status"] == "closed"


class TestAIRecommendations:
    def test_returns_recommendations(self, s):
        r = s.get(
            f"{BASE_URL}/api/procurement/ai-recommendations/{RETAILER_ID}",
            timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        assert "recommendations" in body
        for rec in body["recommendations"]:
            for k in ("product_id", "current_stock", "daily_velocity",
                      "days_to_stockout", "recommended_qty",
                      "expected_lost_revenue", "severity",
                      "suggested_supplier", "headline", "rationale"):
                assert k in rec, f"missing {k}"
            assert rec["severity"] in ("critical", "high", "medium", "low")

    def test_unknown_retailer_404(self, s):
        r = s.get(
            f"{BASE_URL}/api/procurement/ai-recommendations/00000000-0000-0000-0000-000000000000",
            timeout=10,
        )
        assert r.status_code == 404
