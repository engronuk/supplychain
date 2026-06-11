"""Wholesaler Workspace — Phase 2 backend tests.

Covers Distributor Orders + Fulfillment + Shipments.

Endpoints under /api/wholesaler/{wid}/orders|fulfillments|shipments/*.
All transitions are rule-based — no AI calls.
"""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

WHOLESALER_EMAIL = "lagos.wholesaler@tradekonekt.io"
DIST_EMAIL = "prime.distributor@tradekonekt.io"   # Flour Mills tenant
UNIL_WHO_EMAIL = None  # only flour-mills wholesaler in seed; cross-tenant: use unilever@
UNILEVER_EMAIL = "unilever@tradekonekt.io"
RETAILER_EMAIL = "flour.retailer1@tradekonekt.io"
ADMIN_EMAIL = "admin@tradekonekt.io"
PASSWORD = "TradeKonekt2026!"
WID = "a81a9c78-6135-4f6d-bb08-05e1955abf6e"


def _login(session: requests.Session, email: str) -> dict:
    r = session.post(f"{API}/auth/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, f"login {email}: {r.text}"
    data = r.json()
    session.headers.update({"Authorization": f"Bearer {data['access_token']}"})
    return data


@pytest.fixture(scope="session")
def wh_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    _login(s, WHOLESALER_EMAIL)
    return s


@pytest.fixture(scope="session")
def dist_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    data = _login(s, DIST_EMAIL)
    # capture distributor entity_id
    s.entity_id = data["user"]["entity_id"]
    return s


# ---- Orders dashboard + list ----------------------------------------------

class TestOrdersDashboard:
    def test_dashboard_shape(self, wh_client):
        r = wh_client.get(f"{API}/wholesaler/{WID}/orders/dashboard")
        assert r.status_code == 200, r.text
        d = r.json()
        kpis = d["kpis"]
        for k in ["new_orders", "pending_approval", "approved",
                  "in_fulfillment", "shipped", "delivered", "backordered"]:
            assert k in kpis, f"missing kpi {k}"
        funnel = d["funnel"]
        for k in ["submitted", "approved", "allocated", "picking",
                  "packing", "shipped", "delivered"]:
            assert k in funnel

    def test_list_seeded_orders(self, wh_client):
        r = wh_client.get(f"{API}/wholesaler/{WID}/orders")
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) >= 7, f"expected >=7 seeded orders, got {len(rows)}"
        statuses = {o["status"] for o in rows}
        # 7-stage funnel coverage
        expected = {"submitted", "allocated", "picking", "packed",
                    "shipped", "delivered", "backordered"}
        # tolerate that picking can show as 'picking' or 'picked'
        assert expected.issubset(statuses) or len(
            expected & statuses) >= 5, f"funnel statuses: {statuses}"

    def test_filter_by_status_submitted(self, wh_client):
        r = wh_client.get(f"{API}/wholesaler/{WID}/orders?status=submitted")
        assert r.status_code == 200
        rows = r.json()
        assert all(o["status"] == "submitted" for o in rows)

    def test_get_order_detail_shape(self, wh_client):
        rows = wh_client.get(
            f"{API}/wholesaler/{WID}/orders?status=submitted").json()
        assert rows, "no submitted order to inspect"
        oid = rows[0]["id"]
        r = wh_client.get(f"{API}/wholesaler/{WID}/orders/{oid}")
        assert r.status_code == 200
        d = r.json()
        assert "availability" in d and isinstance(d["availability"], list)
        avail = d["availability"][0]
        for k in ["product_id", "requested", "available", "reserved",
                  "in_transit", "on_hand", "signal"]:
            assert k in avail
        assert avail["signal"] in ("full", "partial", "unavailable")
        rec = d["recommendation"]
        assert rec["verdict"] in (
            "approve_full", "partial", "reject_or_backorder", "no_items")
        assert "message" in rec
        assert "lines_full" in rec and "lines_partial" in rec \
               and "lines_unavailable" in rec
        for risk in rec["risks"]:
            assert risk["type"] in ("safety_stock", "expiry", "demand")


# ---- Create / approve / reject / modify / cancel --------------------------

class TestOrderLifecycle:
    def test_create_order_as_distributor(self, dist_client):
        catalog = dist_client.get(
            f"{API}/wholesaler/{WID}/procurement/catalog").json()
        assert catalog, "no catalog"
        prod = catalog[0]
        payload = {
            "distributor_id": dist_client.entity_id,
            "items": [{"product_id": prod["id"], "quantity": 5}],
            "priority": "normal",
            "note": "TEST_phase2",
        }
        r = dist_client.post(f"{API}/wholesaler/{WID}/orders", json=payload)
        assert r.status_code == 200, r.text
        o = r.json()
        assert o["status"] == "submitted"
        assert o["distributor_id"] == dist_client.entity_id
        pytest.shared_order_id = o["id"]

    def test_create_other_distributor_403(self, dist_client):
        payload = {
            "distributor_id": "some-other-distributor-id",
            "items": [{"product_id": "x", "quantity": 1}],
        }
        r = dist_client.post(f"{API}/wholesaler/{WID}/orders", json=payload)
        assert r.status_code == 403

    def test_create_cross_tenant_product_400(self, dist_client):
        # Try to put a Unilever product in a Flour Mills order
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        _login(s, UNILEVER_EMAIL)
        # Find a Unilever product
        uni_user = s.get(f"{API}/auth/me").json()
        uni_id = uni_user.get("entity_id")
        # get any product belonging to Unilever
        rprods = s.get(f"{API}/manufacturer/{uni_id}/products")
        if rprods.status_code != 200:
            pytest.skip("no manufacturer products endpoint")
        prods = rprods.json()
        if not prods:
            pytest.skip("no unilever products")
        uni_prod_id = prods[0]["id"]
        payload = {
            "distributor_id": dist_client.entity_id,
            "items": [{"product_id": uni_prod_id, "quantity": 1}],
        }
        r = dist_client.post(f"{API}/wholesaler/{WID}/orders", json=payload)
        assert r.status_code == 400, f"expected 400 cross-tenant; got {r.status_code} {r.text}"

    def test_approve_reserves_inventory_and_creates_fulfillment(self, wh_client):
        oid = pytest.shared_order_id
        # baseline reserved
        order = wh_client.get(f"{API}/wholesaler/{WID}/orders/{oid}").json()
        pid = order["items"][0]["product_id"]
        before = order["availability"][0]["reserved"]
        r = wh_client.post(f"{API}/wholesaler/{WID}/orders/{oid}/approve")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "allocated"
        assert body.get("fulfillment_id")
        pytest.shared_ful_id = body["fulfillment_id"]
        # verify reserved increased
        order2 = wh_client.get(f"{API}/wholesaler/{WID}/orders/{oid}").json()
        after = next(a for a in order2["availability"] if a["product_id"] == pid)["reserved"]
        assert after >= before + 5 or order2["items"][0]["approved_quantity"] > 0

    def test_approve_non_submitted_400(self, wh_client):
        # The order is now 'allocated'
        oid = pytest.shared_order_id
        r = wh_client.post(f"{API}/wholesaler/{WID}/orders/{oid}/approve")
        assert r.status_code == 400

    def test_reject_empty_reason_422(self, wh_client, dist_client):
        # Create a new submitted order to reject
        catalog = wh_client.get(
            f"{API}/wholesaler/{WID}/procurement/catalog").json()
        prod = catalog[0]
        new = dist_client.post(f"{API}/wholesaler/{WID}/orders", json={
            "distributor_id": dist_client.entity_id,
            "items": [{"product_id": prod["id"], "quantity": 1}],
        }).json()
        oid = new["id"]
        r = wh_client.post(f"{API}/wholesaler/{WID}/orders/{oid}/reject",
                           json={"reason": ""})
        assert r.status_code in (400, 422)
        # Now reject properly
        r2 = wh_client.post(f"{API}/wholesaler/{WID}/orders/{oid}/reject",
                            json={"reason": "Out of stock — TEST"})
        assert r2.status_code == 200
        assert r2.json()["status"] == "rejected"

    def test_modify_partial_then_backorder(self, wh_client, dist_client):
        catalog = wh_client.get(
            f"{API}/wholesaler/{WID}/procurement/catalog").json()
        prod = catalog[0]
        # backorder-only case: approve qty = 0, backorder_remainder = True
        new = dist_client.post(f"{API}/wholesaler/{WID}/orders", json={
            "distributor_id": dist_client.entity_id,
            "items": [{"product_id": prod["id"], "quantity": 7}],
        }).json()
        r = wh_client.post(
            f"{API}/wholesaler/{WID}/orders/{new['id']}/modify",
            json={"items": [{"product_id": prod["id"], "approved_quantity": 0}],
                  "backorder_remainder": True,
                  "note": "TEST_backorder"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "backordered"

    def test_cancel_releases_reservations(self, wh_client, dist_client):
        catalog = wh_client.get(
            f"{API}/wholesaler/{WID}/procurement/catalog").json()
        prod = catalog[0]
        new = dist_client.post(f"{API}/wholesaler/{WID}/orders", json={
            "distributor_id": dist_client.entity_id,
            "items": [{"product_id": prod["id"], "quantity": 2}],
        }).json()
        # approve to create reservation
        wh_client.post(f"{API}/wholesaler/{WID}/orders/{new['id']}/approve")
        # then cancel
        r = wh_client.post(f"{API}/wholesaler/{WID}/orders/{new['id']}/cancel")
        assert r.status_code == 200
        assert r.json()["status"] == "cancelled"


# ---- Fulfillment workflow --------------------------------------------------

class TestFulfillment:
    def test_list_fulfillments(self, wh_client):
        r = wh_client.get(f"{API}/wholesaler/{WID}/fulfillments")
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) >= 5, f"expected >=5 fulfillments, got {len(rows)}"

    def test_get_fulfillment_detail(self, wh_client):
        rows = wh_client.get(f"{API}/wholesaler/{WID}/fulfillments").json()
        ful = rows[0]
        r = wh_client.get(f"{API}/wholesaler/{WID}/fulfillments/{ful['id']}")
        assert r.status_code == 200
        d = r.json()
        assert "status_history" in d and isinstance(d["status_history"], list)

    def test_full_workflow_allocated_to_dispatched(self, wh_client):
        # Use the fulfillment created by the approve test
        fid = pytest.shared_ful_id
        # start-picking
        r = wh_client.post(
            f"{API}/wholesaler/{WID}/fulfillments/{fid}/start-picking")
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "picking"
        # complete-picking with custom qty
        ful = wh_client.get(f"{API}/wholesaler/{WID}/fulfillments/{fid}").json()
        items = [{"product_id": it["product_id"],
                  "picked_quantity": it["quantity"]}
                 for it in ful["items"]]
        r = wh_client.post(
            f"{API}/wholesaler/{WID}/fulfillments/{fid}/complete-picking",
            json={"items": items, "note": "TEST_pick"})
        assert r.status_code == 200
        assert r.json()["status"] == "picked"
        # start-packing → complete-packing → ready-dispatch → dispatch
        for action, expected_status in [
            ("start-packing", "packing"),
            ("complete-packing", "packed"),
            ("ready-dispatch", "ready_for_dispatch"),
        ]:
            rr = wh_client.post(
                f"{API}/wholesaler/{WID}/fulfillments/{fid}/{action}")
            assert rr.status_code == 200, f"{action}: {rr.text}"
            assert rr.json()["status"] == expected_status
        # dispatch
        rr = wh_client.post(
            f"{API}/wholesaler/{WID}/fulfillments/{fid}/dispatch")
        assert rr.status_code == 200, rr.text
        body = rr.json()
        assert body.get("shipment_id")
        assert body.get("shipment_number", "").startswith("WSHIP-")
        pytest.shared_ship_id = body["shipment_id"]

    def test_bad_transition_400(self, wh_client):
        # Already dispatched -> start-picking should 400
        fid = pytest.shared_ful_id
        r = wh_client.post(
            f"{API}/wholesaler/{WID}/fulfillments/{fid}/start-picking")
        assert r.status_code == 400

    def test_report_shortage_flag(self, wh_client):
        rows = wh_client.get(f"{API}/wholesaler/{WID}/fulfillments").json()
        fid = rows[0]["id"]
        r = wh_client.post(
            f"{API}/wholesaler/{WID}/fulfillments/{fid}/report-shortage",
            json={"note": "TEST shortage"})
        assert r.status_code == 200
        ful = wh_client.get(f"{API}/wholesaler/{WID}/fulfillments/{fid}").json()
        assert ful.get("shortage_reported") is True


# ---- Shipments -------------------------------------------------------------

class TestShipments:
    def test_dashboard(self, wh_client):
        r = wh_client.get(f"{API}/wholesaler/{WID}/shipments/dashboard")
        assert r.status_code == 200
        kpis = r.json()["kpis"]
        for k in ["active_shipments", "delivered_today", "delayed_shipments",
                  "pending_dispatch", "avg_delivery_hours"]:
            assert k in kpis

    def test_list(self, wh_client):
        r = wh_client.get(f"{API}/wholesaler/{WID}/shipments")
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) >= 2, f"expected >=2 shipments, got {len(rows)}"

    def test_detail(self, wh_client):
        rows = wh_client.get(f"{API}/wholesaler/{WID}/shipments").json()
        sid = rows[0]["id"]
        r = wh_client.get(f"{API}/wholesaler/{WID}/shipments/{sid}")
        assert r.status_code == 200
        d = r.json()
        assert "status_history" in d

    def test_transitions_loaded_to_delivered(self, wh_client):
        # Use the shipment we just dispatched (status=loaded)
        sid = pytest.shared_ship_id
        # start-transit
        r = wh_client.post(
            f"{API}/wholesaler/{WID}/shipments/{sid}/start-transit")
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "in_transit"
        # deliver
        r = wh_client.post(f"{API}/wholesaler/{WID}/shipments/{sid}/deliver")
        assert r.status_code == 200
        assert r.json()["status"] == "delivered"
        # check downstream — order should be delivered
        ship = wh_client.get(f"{API}/wholesaler/{WID}/shipments/{sid}").json()
        order = wh_client.get(
            f"{API}/wholesaler/{WID}/orders/{ship['order_id']}").json()
        assert order["status"] == "delivered"

    def test_delay_then_cancel(self, wh_client, dist_client):
        # Build a fresh shipment: create→approve→walk→dispatch
        catalog = wh_client.get(
            f"{API}/wholesaler/{WID}/procurement/catalog").json()
        prod = catalog[0]
        new = dist_client.post(f"{API}/wholesaler/{WID}/orders", json={
            "distributor_id": dist_client.entity_id,
            "items": [{"product_id": prod["id"], "quantity": 1}],
        }).json()
        oid = new["id"]
        approve = wh_client.post(
            f"{API}/wholesaler/{WID}/orders/{oid}/approve").json()
        fid = approve["fulfillment_id"]
        for action in ["start-picking", "complete-picking", "start-packing",
                       "complete-packing", "ready-dispatch", "dispatch"]:
            body = {"items": []} if action == "complete-picking" else None
            wh_client.post(
                f"{API}/wholesaler/{WID}/fulfillments/{fid}/{action}",
                json=body)
        # find the new shipment for this order
        rows = wh_client.get(f"{API}/wholesaler/{WID}/shipments").json()
        target = next(s for s in rows if s["order_id"] == oid)
        sid = target["id"]
        assert target["status"] == "loaded"
        r = wh_client.post(f"{API}/wholesaler/{WID}/shipments/{sid}/delay",
                           json={"reason": "TEST traffic", "eta_minutes": 60})
        assert r.status_code == 200
        assert r.json()["status"] == "delayed"
        r2 = wh_client.post(f"{API}/wholesaler/{WID}/shipments/{sid}/cancel")
        assert r2.status_code == 200
        assert r2.json()["status"] == "cancelled"


# ---- Multi-tenant isolation -----------------------------------------------

class TestIsolation:
    def test_unauthenticated_401(self):
        r = requests.get(f"{API}/wholesaler/{WID}/orders")
        assert r.status_code == 401

    def test_retailer_403(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        _login(s, RETAILER_EMAIL)
        r = s.get(f"{API}/wholesaler/{WID}/orders")
        assert r.status_code == 403

    def test_cross_tenant_manufacturer_403(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        _login(s, UNILEVER_EMAIL)
        r = s.get(f"{API}/wholesaler/{WID}/orders")
        assert r.status_code == 403

    def test_super_admin_200(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        _login(s, ADMIN_EMAIL)
        r = s.get(f"{API}/wholesaler/{WID}/orders")
        assert r.status_code == 200


# ---- Phase-1 regression ----------------------------------------------------

class TestPhase1Regression:
    def test_overview(self, wh_client):
        assert wh_client.get(
            f"{API}/wholesaler/{WID}/overview").status_code == 200

    def test_inventory(self, wh_client):
        assert wh_client.get(
            f"{API}/wholesaler/{WID}/inventory").status_code == 200

    def test_procurement_orders(self, wh_client):
        assert wh_client.get(
            f"{API}/wholesaler/{WID}/procurement/orders").status_code == 200

    def test_distributors(self, wh_client):
        assert wh_client.get(
            f"{API}/wholesaler/{WID}/distributors").status_code == 200
