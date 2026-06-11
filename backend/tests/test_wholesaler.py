"""Wholesaler Workspace — Phase 1 backend tests.

Covers:
- Auth (lagos.wholesaler@tradekonekt.io)
- Entity hydration: GET /api/wholesaler/{id}
- Overview KPIs, inventory health, AI insights, stockout watchlist
- Inventory list (+ multi-tenant isolation: Flour Mills only, no Unilever)
- Inventory receive / adjust / cycle-count + movements feed
- Procurement: list, suppliers, catalog, create PO, transition lifecycle
- Distributors: directory + totals + insights
"""
import os
import time
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
WHOLESALER_EMAIL = "lagos.wholesaler@tradekonekt.io"
PASSWORD = "TradeKonekt2026!"
LAGOS_WHOLESALE_HUB_ID = "a81a9c78-6135-4f6d-bb08-05e1955abf6e"
FLOUR_MILLS_TENANT_HINT = "Flour Mills"


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def auth_client(client):
    r = client.post(f"{API}/auth/login",
                    json={"email": WHOLESALER_EMAIL, "password": PASSWORD})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "access_token" in data
    client.headers.update({"Authorization": f"Bearer {data['access_token']}"})
    return client


# ---- Auth + entity hydration ----------------------------------------------

class TestAuthAndEntity:
    def test_login_returns_wholesaler(self, client):
        r = client.post(f"{API}/auth/login",
                        json={"email": WHOLESALER_EMAIL, "password": PASSWORD})
        assert r.status_code == 200
        user = r.json()["user"]
        assert user["role"] == "wholesaler"
        assert user.get("entity_id") == LAGOS_WHOLESALE_HUB_ID

    def test_get_wholesaler_entity(self, auth_client):
        r = auth_client.get(f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}")
        assert r.status_code == 200
        d = r.json()
        assert d["id"] == LAGOS_WHOLESALE_HUB_ID
        assert d["name"]
        assert d["code"]

    def test_get_wholesaler_unknown_404(self, auth_client):
        r = auth_client.get(f"{API}/wholesaler/does-not-exist")
        assert r.status_code == 404


# ---- Dashboard overview ----------------------------------------------------

class TestOverview:
    def test_overview_shape(self, auth_client):
        r = auth_client.get(f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/overview")
        assert r.status_code == 200, r.text
        data = r.json()
        # KPIs
        kpis = data["kpis"]
        for k in ["inventory_value", "inventory_units", "pending_pos",
                  "incoming_shipments", "outgoing_shipments",
                  "active_distributors", "inventory_turnover", "stockout_risks"]:
            assert k in kpis, f"missing kpi {k}"
            assert "value" in kpis[k]
        # Inventory health
        ih = data["inventory_health"]
        for k in ["in_stock", "low_stock", "excess_stock", "expiring",
                  "total_skus", "health_score"]:
            assert k in ih
        # AI insights 1-4
        assert 1 <= len(data["ai_insights"]) <= 4
        for ins in data["ai_insights"]:
            assert "title" in ins and "body" in ins and "tone" in ins
        # Stockout risks (could be empty but key exists)
        assert isinstance(data["stockout_risks"], list)


# ---- Inventory -------------------------------------------------------------

class TestInventory:
    def test_inventory_list(self, auth_client):
        r = auth_client.get(f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/inventory")
        assert r.status_code == 200
        data = r.json()
        assert "rows" in data and "summary" in data
        rows = data["rows"]
        assert len(rows) >= 6, f"expected >=6 inventory rows, got {len(rows)}"
        for row in rows:
            for k in ["product_id", "product_name", "sku", "available",
                      "reserved", "damaged", "in_transit", "reorder_level",
                      "value", "health"]:
                assert k in row, f"missing field {k}"
            assert row["health"] in ("healthy", "low", "out", "excess")

    def test_multitenant_isolation(self, auth_client):
        """Lagos wholesaler is under Flour Mills — must NOT see Unilever products."""
        r = auth_client.get(f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/inventory")
        assert r.status_code == 200
        names = " ".join(row.get("product_name", "").lower()
                         for row in r.json()["rows"])
        # Unilever flagship brand names that must NOT appear
        for forbidden in ["knorr", "lipton", "omo ", "lux ", "vaseline"]:
            assert forbidden not in names, (
                f"Multi-tenant leak: '{forbidden}' surfaced for Flour Mills wholesaler"
            )

    def test_receive_then_movement_logged(self, auth_client):
        # Pick the first product
        inv = auth_client.get(
            f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/inventory").json()
        product_id = inv["rows"][0]["product_id"]
        before_qty = inv["rows"][0]["available"]

        payload = {"product_id": product_id, "quantity": 25,
                   "source": "test", "note": "TEST_receive",
                   "actor": "pytest"}
        r = auth_client.post(
            f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/inventory/receive",
            json=payload)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # Verify quantity increased
        inv2 = auth_client.get(
            f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/inventory").json()
        row = next(x for x in inv2["rows"] if x["product_id"] == product_id)
        assert row["available"] == before_qty + 25

        # Verify movement logged
        moves = auth_client.get(
            f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/inventory/movements").json()
        assert any(m.get("kind") == "receive" and m.get("product_id") == product_id
                   and m.get("note") == "TEST_receive" for m in moves)

    def test_adjust_inventory(self, auth_client):
        inv = auth_client.get(
            f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/inventory").json()
        row = inv["rows"][0]
        product_id = row["product_id"]
        before_qty = row["available"]

        r = auth_client.post(
            f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/inventory/{product_id}/adjust",
            json={"delta": -10, "reason": "damage", "note": "TEST_adjust",
                  "actor": "pytest"})
        assert r.status_code == 200, r.text

        inv2 = auth_client.get(
            f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/inventory").json()
        row2 = next(x for x in inv2["rows"] if x["product_id"] == product_id)
        assert row2["available"] == max(0, before_qty - 10)

    def test_cycle_count(self, auth_client):
        inv = auth_client.get(
            f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/inventory").json()
        row = inv["rows"][1]
        product_id = row["product_id"]
        target = 999
        r = auth_client.post(
            f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/inventory/{product_id}/cycle-count",
            json={"counted_quantity": target, "note": "TEST_cycle",
                  "actor": "pytest"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["new_quantity"] == target

        inv2 = auth_client.get(
            f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/inventory").json()
        row2 = next(x for x in inv2["rows"] if x["product_id"] == product_id)
        assert row2["available"] == target

    def test_movements_endpoint(self, auth_client):
        r = auth_client.get(
            f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/inventory/movements?limit=20")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        # there should be at least seeded movements
        assert len(data) >= 1


# ---- Procurement -----------------------------------------------------------

class TestProcurement:
    def test_list_pos(self, auth_client):
        r = auth_client.get(
            f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/procurement/orders")
        assert r.status_code == 200
        pos = r.json()
        assert len(pos) >= 3, f"expected >=3 seeded POs, got {len(pos)}"
        statuses = {p["status"] for p in pos}
        assert "delivered" in statuses or "shipped" in statuses
        for p in pos:
            assert p["po_number"].startswith("WPO-")
            assert "items" in p and len(p["items"]) >= 1

    def test_suppliers(self, auth_client):
        r = auth_client.get(
            f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/procurement/suppliers")
        assert r.status_code == 200
        suppliers = r.json()
        assert len(suppliers) >= 1
        types = {s["type"] for s in suppliers}
        assert "manufacturer" in types

    def test_catalog(self, auth_client):
        r = auth_client.get(
            f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/procurement/catalog")
        assert r.status_code == 200
        catalog = r.json()
        assert len(catalog) >= 1
        for p in catalog[:3]:
            assert "id" in p and "name" in p

    def test_create_po_and_lifecycle(self, auth_client):
        # Get supplier + product
        suppliers = auth_client.get(
            f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/procurement/suppliers").json()
        mfr = next(s for s in suppliers if s["type"] == "manufacturer")
        catalog = auth_client.get(
            f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/procurement/catalog").json()
        prod = catalog[0]

        payload = {
            "supplier_id": mfr["id"],
            "supplier_type": "manufacturer",
            "items": [{"product_id": prod["id"], "quantity": 50,
                       "unit_cost": 100.0}],
            "note": "TEST_PO",
        }
        r = auth_client.post(
            f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/procurement/orders",
            json=payload)
        assert r.status_code == 200, r.text
        po = r.json()
        assert po["status"] == "draft"
        assert po["po_number"].startswith("WPO-")
        po_id = po["id"]

        # Get inventory baseline for product
        inv_before = auth_client.get(
            f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/inventory").json()["rows"]
        bqty = next((x["available"] for x in inv_before
                     if x["product_id"] == prod["id"]), 0)

        # Walk through full state machine
        for action in ["submit", "approve", "allocate", "ship", "deliver"]:
            r = auth_client.post(
                f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/procurement/orders/{po_id}/transition",
                json={"action": action, "actor": "pytest"})
            assert r.status_code == 200, f"{action}: {r.status_code} {r.text}"

        # Confirm delivered status + inventory increment by 50
        pos = auth_client.get(
            f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/procurement/orders").json()
        po_final = next(p for p in pos if p["id"] == po_id)
        assert po_final["status"] == "delivered"

        inv_after = auth_client.get(
            f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/inventory").json()["rows"]
        aqty = next((x["available"] for x in inv_after
                     if x["product_id"] == prod["id"]), 0)
        assert aqty == bqty + 50, f"expected {bqty + 50}, got {aqty}"

    def test_invalid_transition(self, auth_client):
        # Create a PO and try to skip from draft → delivered (invalid)
        suppliers = auth_client.get(
            f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/procurement/suppliers").json()
        mfr = next(s for s in suppliers if s["type"] == "manufacturer")
        catalog = auth_client.get(
            f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/procurement/catalog").json()
        po = auth_client.post(
            f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/procurement/orders",
            json={"supplier_id": mfr["id"], "supplier_type": "manufacturer",
                  "items": [{"product_id": catalog[0]["id"],
                             "quantity": 10, "unit_cost": 50.0}]}).json()
        r = auth_client.post(
            f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/procurement/orders/{po['id']}/transition",
            json={"action": "deliver"})
        assert r.status_code == 400


# ---- Distributors network --------------------------------------------------

class TestDistributors:
    def test_distributor_directory(self, auth_client):
        r = auth_client.get(
            f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/distributors")
        assert r.status_code == 200
        data = r.json()
        assert "distributors" in data and "totals" in data and "insights" in data
        # 1 Flour Mills distributor in Lagos (Prime Distribution Services Ltd)
        assert data["totals"]["distributor_count"] >= 1
        names = [d["name"] for d in data["distributors"]]
        assert any("Prime" in n for n in names), \
            f"Prime Distribution not in network: {names}"

    def test_no_unilever_distributors(self, auth_client):
        r = auth_client.get(
            f"{API}/wholesaler/{LAGOS_WHOLESALE_HUB_ID}/distributors")
        names = " ".join(d["name"].lower() for d in r.json()["distributors"])
        for forbidden in ["suara", "renuzi", "lobic"]:
            assert forbidden not in names, (
                f"Multi-tenant leak: '{forbidden}' (Unilever distributor) "
                f"in Flour Mills wholesaler network"
            )
