"""End-to-end backend test suite for Supply Chain Hub API.
Covers distributors, retailers, products, inventory, shipments,
status transitions, requests, notifications, analytics, reports, seed.
"""
import os
import io
import csv
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else None
if not BASE_URL:
    # Fallback to reading frontend env file
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

API = f"{BASE_URL}/api"


# -------- Module-level fixture: re-seed and gather entity ids -------- #
@pytest.fixture(scope="module")
def seeded():
    r = requests.post(f"{API}/seed", timeout=60)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True
    distributors = requests.get(f"{API}/distributors").json()
    retailers = requests.get(f"{API}/retailers").json()
    products = requests.get(f"{API}/products").json()
    assert len(distributors) >= 2
    assert len(retailers) >= 4
    assert len(products) >= 6
    return {
        "distributors": distributors,
        "retailers": retailers,
        "products": products,
    }


# --------------------- Master data ---------------------
class TestMasterData:
    def test_root(self):
        r = requests.get(f"{API}/")
        assert r.status_code == 200
        assert r.json().get("status") == "ok"

    def test_distributors(self, seeded):
        ds = seeded["distributors"]
        assert isinstance(ds, list) and len(ds) >= 2
        for d in ds:
            assert "id" in d and "name" in d and "region" in d
            assert "_id" not in d

    def test_retailers_filter_by_distributor(self, seeded):
        d_id = seeded["distributors"][0]["id"]
        r = requests.get(f"{API}/retailers", params={"distributor_id": d_id})
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 1
        assert all(x["distributor_id"] == d_id for x in data)

    def test_products(self, seeded):
        ps = seeded["products"]
        assert len(ps) >= 6
        assert all("sku" in p for p in ps)


# --------------------- Inventory ---------------------
class TestInventory:
    def test_distributor_inventory_joined_with_product(self, seeded):
        d_id = seeded["distributors"][0]["id"]
        r = requests.get(f"{API}/inventory", params={"owner_type": "distributor", "owner_id": d_id})
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 1
        assert "product" in items[0]
        assert items[0]["product"].get("sku")

    def test_retailer_inventory(self, seeded):
        r_id = seeded["retailers"][0]["id"]
        r = requests.get(f"{API}/inventory", params={"owner_type": "retailer", "owner_id": r_id})
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# --------------------- Shipments + transitions ---------------------
class TestShipmentsLifecycle:
    def test_list_shipments_enriched(self, seeded):
        d_id = seeded["distributors"][0]["id"]
        r = requests.get(f"{API}/shipments", params={"distributor_id": d_id})
        assert r.status_code == 200
        shipments = r.json()
        assert len(shipments) >= 1
        s0 = shipments[0]
        assert "distributor" in s0 and "retailer" in s0
        for it in s0.get("items", []):
            assert "product" in it

    def test_full_pending_to_received_flow(self, seeded):
        d = seeded["distributors"][0]
        r = next(x for x in seeded["retailers"] if x["distributor_id"] == d["id"])
        p = seeded["products"][0]

        # Capture starting inventory for distributor and retailer
        def inv_qty(owner_type, owner_id, product_id):
            data = requests.get(f"{API}/inventory", params={"owner_type": owner_type, "owner_id": owner_id}).json()
            for it in data:
                if it["product_id"] == product_id:
                    return it["quantity"]
            return 0

        d_start = inv_qty("distributor", d["id"], p["id"])
        r_start = inv_qty("retailer", r["id"], p["id"])

        QTY = 7
        create_resp = requests.post(f"{API}/shipments", json={
            "distributor_id": d["id"],
            "retailer_id": r["id"],
            "items": [{"product_id": p["id"], "quantity": QTY}],
            "notes": "TEST shipment",
        })
        assert create_resp.status_code == 200, create_resp.text
        sh = create_resp.json()
        assert sh["status"] == "pending"
        assert "tracking_code" in sh
        shipment_id = sh["id"]

        # Notification for retailer should have been pushed
        notifs = requests.get(f"{API}/notifications", params={"target_type": "retailer", "target_id": r["id"]}).json()
        assert any("pending dispatch" in n["message"].lower() or sh["tracking_code"] in n["message"] for n in notifs)

        # Invalid transition: pending -> received should 400
        bad = requests.patch(f"{API}/shipments/{shipment_id}/status", json={"status": "received"})
        assert bad.status_code == 400

        # Move to in_transit -> distributor inventory decreases
        mv = requests.patch(f"{API}/shipments/{shipment_id}/status", json={"status": "in_transit"})
        assert mv.status_code == 200, mv.text
        assert mv.json()["status"] == "in_transit"
        assert mv.json().get("dispatched_at")

        d_after_transit = inv_qty("distributor", d["id"], p["id"])
        assert d_after_transit == d_start - QTY, f"Expected distributor inventory to decrease by {QTY}, got {d_start}->{d_after_transit}"

        # Invalid: in_transit -> pending
        rev = requests.patch(f"{API}/shipments/{shipment_id}/status", json={"status": "pending"})
        assert rev.status_code == 400

        # Move to received -> retailer inventory increases
        rcv = requests.patch(f"{API}/shipments/{shipment_id}/status", json={"status": "received"})
        assert rcv.status_code == 200
        assert rcv.json()["status"] == "received"
        assert rcv.json().get("received_at")

        r_after = inv_qty("retailer", r["id"], p["id"])
        assert r_after == r_start + QTY, f"Expected retailer inventory to increase by {QTY}"

        # Cannot re-transition from received
        again = requests.patch(f"{API}/shipments/{shipment_id}/status", json={"status": "in_transit"})
        assert again.status_code == 400

    def test_status_404(self):
        r = requests.patch(f"{API}/shipments/does-not-exist/status", json={"status": "in_transit"})
        assert r.status_code == 404


# --------------------- Requests ---------------------
class TestRequests:
    def test_create_request_notifies_distributor(self, seeded):
        r = next(x for x in seeded["retailers"])
        d_id = r["distributor_id"]
        p = seeded["products"][1]
        resp = requests.post(f"{API}/requests", json={
            "retailer_id": r["id"], "distributor_id": d_id,
            "items": [{"product_id": p["id"], "quantity": 12}],
            "note": "TEST request",
        })
        assert resp.status_code == 200
        req = resp.json()
        assert req["status"] == "pending"
        # distributor notifications
        notifs = requests.get(f"{API}/notifications", params={"target_type": "distributor", "target_id": d_id}).json()
        assert any(n.get("type") == "request" for n in notifs)

    def test_approve_creates_shipment_and_can_fulfill(self, seeded):
        r = seeded["retailers"][0]
        d_id = r["distributor_id"]
        p = seeded["products"][2]
        # Create
        req = requests.post(f"{API}/requests", json={
            "retailer_id": r["id"], "distributor_id": d_id,
            "items": [{"product_id": p["id"], "quantity": 5}],
        }).json()
        req_id = req["id"]
        # Approve
        ap = requests.patch(f"{API}/requests/{req_id}", json={"action": "approve"})
        assert ap.status_code == 200
        body = ap.json()
        assert body["status"] == "approved"
        sh_id = body["shipment_id"]

        # Cannot decide again
        twice = requests.patch(f"{API}/requests/{req_id}", json={"action": "reject"})
        assert twice.status_code == 400

        # Move shipment all the way to received -> request becomes fulfilled
        requests.patch(f"{API}/shipments/{sh_id}/status", json={"status": "in_transit"})
        requests.patch(f"{API}/shipments/{sh_id}/status", json={"status": "received"})
        reqs = requests.get(f"{API}/requests", params={"distributor_id": d_id}).json()
        match = next((x for x in reqs if x["id"] == req_id), None)
        assert match is not None
        assert match["status"] == "fulfilled"

    def test_reject_sets_rejected(self, seeded):
        r = seeded["retailers"][1]
        d_id = r["distributor_id"]
        p = seeded["products"][0]
        req = requests.post(f"{API}/requests", json={
            "retailer_id": r["id"], "distributor_id": d_id,
            "items": [{"product_id": p["id"], "quantity": 3}],
        }).json()
        rej = requests.patch(f"{API}/requests/{req['id']}", json={"action": "reject"})
        assert rej.status_code == 200
        assert rej.json()["status"] == "rejected"


# --------------------- Notifications ---------------------
class TestNotifications:
    def test_list_mark_and_clear(self, seeded):
        d_id = seeded["distributors"][0]["id"]
        notifs = requests.get(f"{API}/notifications", params={"target_type": "distributor", "target_id": d_id}).json()
        assert isinstance(notifs, list) and len(notifs) >= 1
        # mark one as read
        nid = notifs[0]["id"]
        r1 = requests.patch(f"{API}/notifications/{nid}/read")
        assert r1.status_code == 200
        # read-all
        r2 = requests.patch(f"{API}/notifications/read-all", params={"target_type": "distributor", "target_id": d_id})
        assert r2.status_code == 200
        after = requests.get(f"{API}/notifications", params={"target_type": "distributor", "target_id": d_id}).json()
        assert all(n["read"] is True for n in after)

    def test_mark_unknown_notification(self):
        r = requests.patch(f"{API}/notifications/nope/read")
        assert r.status_code == 404


# --------------------- Analytics ---------------------
class TestAnalytics:
    def test_distributor_analytics(self, seeded):
        d_id = seeded["distributors"][0]["id"]
        r = requests.get(f"{API}/analytics", params={"role": "distributor", "entity_id": d_id})
        assert r.status_code == 200
        data = r.json()
        for key in ("kpis", "status_breakdown", "timeline", "top_products"):
            assert key in data
        kp = data["kpis"]
        for k in ("total_shipments", "pending", "in_transit", "received", "open_requests", "inventory_total", "low_stock"):
            assert k in kp
        assert len(data["timeline"]) == 14

    def test_invalid_role(self):
        r = requests.get(f"{API}/analytics", params={"role": "admin", "entity_id": "x"})
        assert r.status_code == 400


# --------------------- Reports ---------------------
class TestReports:
    def test_shipments_csv(self, seeded):
        d_id = seeded["distributors"][0]["id"]
        r = requests.get(f"{API}/reports/shipments.csv", params={"role": "distributor", "entity_id": d_id})
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        reader = csv.reader(io.StringIO(r.text))
        rows = list(reader)
        assert rows[0][0] == "Tracking Code"
        assert len(rows) >= 2

    def test_inventory_csv(self, seeded):
        d_id = seeded["distributors"][0]["id"]
        r = requests.get(f"{API}/reports/inventory.csv", params={"role": "distributor", "entity_id": d_id})
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        reader = csv.reader(io.StringIO(r.text))
        rows = list(reader)
        assert rows[0] == ["SKU", "Product", "Category", "Quantity", "Reorder Level", "Updated"]
        assert len(rows) >= 2
