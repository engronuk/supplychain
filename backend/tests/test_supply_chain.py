"""Iteration 2 backend test suite for Supply Chain Hub API.
Covers: manufacturers, distributors (91), retailers (91), products (15),
inventory by owner_type, generic shipments with from_role/to_role,
mfg→dist + dist→retailer lifecycles, requests, notifications, analytics,
reports and seed.
"""
import os
import io
import csv
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip()
                break
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"


# ---- Module-level fixture: re-seed and collect IDs ----
@pytest.fixture(scope="module")
def seeded():
    r = requests.post(f"{API}/seed", timeout=60)
    assert r.status_code == 200, r.text
    body = r.json()
    manufacturers = requests.get(f"{API}/manufacturers").json()
    distributors = requests.get(f"{API}/distributors").json()
    retailers = requests.get(f"{API}/retailers").json()
    products = requests.get(f"{API}/products").json()
    return {
        "seed_body": body,
        "manufacturers": manufacturers,
        "distributors": distributors,
        "retailers": retailers,
        "products": products,
    }


# ---- Seed endpoint ----
class TestSeed:
    def test_seed_counts(self, seeded):
        b = seeded["seed_body"]
        assert b["manufacturers"] == 1
        assert b["distributors"] == 91
        assert b["retailers"] >= 91  # expanded retailer dataset (3,080 in current seed)
        assert b["products"] == 15
        assert b["shipments"] >= 12
        assert b.get("primary_distributor_id")
        assert b.get("primary_retailer_id")


# ---- Master data ----
class TestMasterData:
    def test_root(self):
        r = requests.get(f"{API}/")
        assert r.status_code == 200
        assert r.json().get("status") == "ok"

    def test_manufacturers(self, seeded):
        ms = seeded["manufacturers"]
        assert len(ms) == 1
        assert ms[0]["name"] == "Unilever"
        assert "id" in ms[0]
        assert "_id" not in ms[0]

    def test_distributors_count_and_link(self, seeded):
        ds = seeded["distributors"]
        assert len(ds) == 91
        mfg_id = seeded["manufacturers"][0]["id"]
        assert all(d["manufacturer_id"] == mfg_id for d in ds)
        # Filter by manufacturer
        r = requests.get(f"{API}/distributors", params={"manufacturer_id": mfg_id})
        assert r.status_code == 200
        assert len(r.json()) == 91

    def test_distributors_filter_by_unknown_mfg(self):
        r = requests.get(f"{API}/distributors", params={"manufacturer_id": "nope"})
        assert r.status_code == 200
        assert r.json() == []

    def test_retailers_count_and_filter(self, seeded):
        rs = seeded["retailers"]
        assert len(rs) >= 91
        # Find a distributor with retailers
        d_id = seeded["seed_body"]["primary_distributor_id"]
        r = requests.get(f"{API}/retailers", params={"distributor_id": d_id})
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 1
        assert all(x["distributor_id"] == d_id for x in data)

    def test_products(self, seeded):
        ps = seeded["products"]
        assert len(ps) == 15
        for p in ps:
            assert p.get("sku")
            assert p.get("name")
            # Barcode is optional but should be present
            assert "barcode" in p
            assert p["manufacturer_id"] == seeded["manufacturers"][0]["id"]


# ---- Inventory ----
class TestInventory:
    def test_manufacturer_inventory(self, seeded):
        m_id = seeded["manufacturers"][0]["id"]
        r = requests.get(f"{API}/inventory", params={"owner_type": "manufacturer", "owner_id": m_id})
        assert r.status_code == 200
        items = r.json()
        assert len(items) == 15
        assert all("product" in it and it["product"].get("sku") for it in items)

    def test_distributor_inventory(self, seeded):
        d_id = seeded["seed_body"]["primary_distributor_id"]
        r = requests.get(f"{API}/inventory", params={"owner_type": "distributor", "owner_id": d_id})
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 1
        assert "product" in items[0]

    def test_retailer_inventory(self, seeded):
        r_id = seeded["seed_body"]["primary_retailer_id"]
        r = requests.get(f"{API}/inventory", params={"owner_type": "retailer", "owner_id": r_id})
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---- Shipments: generic flow ----
class TestShipmentMfgToDist:
    def test_create_and_lifecycle_mfg_to_dist(self, seeded):
        m = seeded["manufacturers"][0]
        d = seeded["distributors"][0]
        p = seeded["products"][0]

        def inv_qty(owner_type, owner_id, pid):
            data = requests.get(f"{API}/inventory", params={"owner_type": owner_type, "owner_id": owner_id}).json()
            for it in data:
                if it["product_id"] == pid:
                    return it["quantity"]
            return 0

        m_start = inv_qty("manufacturer", m["id"], p["id"])
        d_start = inv_qty("distributor", d["id"], p["id"])

        QTY = 50
        create = requests.post(f"{API}/shipments", json={
            "from_role": "manufacturer", "from_id": m["id"],
            "to_role": "distributor", "to_id": d["id"],
            "items": [{"product_id": p["id"], "quantity": QTY}],
            "notes": "TEST mfg->dist",
        })
        assert create.status_code == 200, create.text
        sh = create.json()
        assert sh["status"] == "pending"
        assert sh["from_role"] == "manufacturer"
        assert sh["to_role"] == "distributor"
        assert sh["manufacturer_id"] == m["id"]
        assert sh["distributor_id"] == d["id"]
        sid = sh["id"]
        tc = sh["tracking_code"]

        # Notification to distributor
        notifs = requests.get(f"{API}/notifications",
                              params={"target_type": "distributor", "target_id": d["id"]}).json()
        assert any(tc in n["message"] for n in notifs)

        # Invalid transition pending->received
        bad = requests.patch(f"{API}/shipments/{sid}/status", json={"status": "received"})
        assert bad.status_code == 400

        # pending -> in_transit: deduct manufacturer
        mv = requests.patch(f"{API}/shipments/{sid}/status", json={"status": "in_transit"})
        assert mv.status_code == 200
        assert mv.json()["status"] == "in_transit"
        assert mv.json().get("dispatched_at")
        m_after = inv_qty("manufacturer", m["id"], p["id"])
        assert m_after == m_start - QTY

        # in_transit -> received: increment distributor and notify mfg
        rcv = requests.patch(f"{API}/shipments/{sid}/status", json={"status": "received"})
        assert rcv.status_code == 200
        d_after = inv_qty("distributor", d["id"], p["id"])
        assert d_after == d_start + QTY

        mfg_notifs = requests.get(f"{API}/notifications",
                                  params={"target_type": "manufacturer", "target_id": m["id"]}).json()
        assert any(tc in n["message"] for n in mfg_notifs)

        # Cannot re-transition
        again = requests.patch(f"{API}/shipments/{sid}/status", json={"status": "in_transit"})
        assert again.status_code == 400


class TestShipmentDistToRetailer:
    def test_dist_to_retailer_flow(self, seeded):
        d_id = seeded["seed_body"]["primary_distributor_id"]
        r_id = seeded["seed_body"]["primary_retailer_id"]
        p = seeded["products"][1]

        create = requests.post(f"{API}/shipments", json={
            "from_role": "distributor", "from_id": d_id,
            "to_role": "retailer", "to_id": r_id,
            "items": [{"product_id": p["id"], "quantity": 9}],
            "notes": "TEST dist->ret",
        })
        assert create.status_code == 200
        sh = create.json()
        assert sh["distributor_id"] == d_id and sh["retailer_id"] == r_id
        sid = sh["id"]
        requests.patch(f"{API}/shipments/{sid}/status", json={"status": "in_transit"})
        rcv = requests.patch(f"{API}/shipments/{sid}/status", json={"status": "received"})
        assert rcv.status_code == 200


class TestShipmentList:
    def test_list_filters_and_enrichment(self, seeded):
        m_id = seeded["manufacturers"][0]["id"]
        r = requests.get(f"{API}/shipments", params={"manufacturer_id": m_id})
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 1
        s0 = items[0]
        assert "from_party" in s0 and "to_party" in s0
        assert "distributor" in s0 and "retailer" in s0
        for it in s0.get("items", []):
            assert "product" in it

        # party_role/party_id filter
        d_id = seeded["seed_body"]["primary_distributor_id"]
        r2 = requests.get(f"{API}/shipments", params={"party_role": "distributor", "party_id": d_id})
        assert r2.status_code == 200
        for s in r2.json():
            assert s["from_id"] == d_id or s["to_id"] == d_id

    def test_status_404(self):
        r = requests.patch(f"{API}/shipments/does-not-exist/status", json={"status": "in_transit"})
        assert r.status_code == 404


# ---- Requests (retailer -> distributor) ----
class TestRequests:
    def test_create_and_approve_request(self, seeded):
        d_id = seeded["seed_body"]["primary_distributor_id"]
        r_id = seeded["seed_body"]["primary_retailer_id"]
        p = seeded["products"][2]
        resp = requests.post(f"{API}/requests", json={
            "retailer_id": r_id, "distributor_id": d_id,
            "items": [{"product_id": p["id"], "quantity": 5}],
            "note": "TEST request",
        })
        assert resp.status_code == 200
        req_id = resp.json()["id"]

        ap = requests.patch(f"{API}/requests/{req_id}", json={"action": "approve"})
        assert ap.status_code == 200
        body = ap.json()
        assert body["status"] == "approved"
        assert "shipment_id" in body

    def test_reject_request(self, seeded):
        d_id = seeded["seed_body"]["primary_distributor_id"]
        r_id = seeded["seed_body"]["primary_retailer_id"]
        p = seeded["products"][0]
        req = requests.post(f"{API}/requests", json={
            "retailer_id": r_id, "distributor_id": d_id,
            "items": [{"product_id": p["id"], "quantity": 3}],
        }).json()
        rej = requests.patch(f"{API}/requests/{req['id']}", json={"action": "reject"})
        assert rej.status_code == 200
        assert rej.json()["status"] == "rejected"


# ---- Notifications ----
class TestNotifications:
    def test_list_and_read_all(self, seeded):
        d_id = seeded["seed_body"]["primary_distributor_id"]
        notifs = requests.get(f"{API}/notifications",
                              params={"target_type": "distributor", "target_id": d_id}).json()
        assert isinstance(notifs, list) and len(notifs) >= 1
        r = requests.patch(f"{API}/notifications/read-all",
                           params={"target_type": "distributor", "target_id": d_id})
        assert r.status_code == 200
        after = requests.get(f"{API}/notifications",
                             params={"target_type": "distributor", "target_id": d_id}).json()
        assert all(n["read"] is True for n in after)

    def test_unknown_notification_404(self):
        r = requests.patch(f"{API}/notifications/nope/read")
        assert r.status_code == 404


# ---- Analytics ----
class TestAnalytics:
    def test_manufacturer_analytics(self, seeded):
        m_id = seeded["manufacturers"][0]["id"]
        r = requests.get(f"{API}/analytics", params={"role": "manufacturer", "entity_id": m_id})
        assert r.status_code == 200
        data = r.json()
        for key in ("kpis", "status_breakdown", "timeline", "top_products"):
            assert key in data
        kp = data["kpis"]
        assert kp.get("distributors_count") == 91
        assert kp.get("retailers_count") >= 91
        assert "inventory_total" in kp
        assert "low_stock" in kp
        assert len(data["timeline"]) == 14

    def test_distributor_analytics(self, seeded):
        d_id = seeded["seed_body"]["primary_distributor_id"]
        r = requests.get(f"{API}/analytics", params={"role": "distributor", "entity_id": d_id})
        assert r.status_code == 200
        data = r.json()
        assert "retailers_count" in data["kpis"]

    def test_invalid_role(self):
        r = requests.get(f"{API}/analytics", params={"role": "admin", "entity_id": "x"})
        assert r.status_code == 400


# ---- Reports ----
class TestReports:
    def test_shipments_csv_manufacturer(self, seeded):
        m_id = seeded["manufacturers"][0]["id"]
        r = requests.get(f"{API}/reports/shipments.csv",
                         params={"role": "manufacturer", "entity_id": m_id})
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        rows = list(csv.reader(io.StringIO(r.text)))
        assert rows[0] == ["Tracking Code", "Status", "From", "To",
                           "Products", "Total Units", "Created", "Dispatched", "Received"]
        assert len(rows) >= 2

    def test_shipments_csv_distributor(self, seeded):
        d_id = seeded["seed_body"]["primary_distributor_id"]
        r = requests.get(f"{API}/reports/shipments.csv",
                         params={"role": "distributor", "entity_id": d_id})
        assert r.status_code == 200
        rows = list(csv.reader(io.StringIO(r.text)))
        assert rows[0][2] == "From" and rows[0][3] == "To"

    def test_inventory_csv(self, seeded):
        m_id = seeded["manufacturers"][0]["id"]
        r = requests.get(f"{API}/reports/inventory.csv",
                         params={"role": "manufacturer", "entity_id": m_id})
        assert r.status_code == 200
        rows = list(csv.reader(io.StringIO(r.text)))
        assert rows[0][0] == "SKU"
        assert "Barcode" in rows[0]
        assert len(rows) >= 2
