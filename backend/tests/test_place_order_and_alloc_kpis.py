"""
Iteration 16: Verify
  1) POST /api/wholesaler/{wid}/orders (place on behalf) — wholesaler caller
  2) GET  /api/wholesaler/{wid}/distributors/{did}/detail surfaces new order
  3) GET  /api/allocation/kpis — manufacturer-only KPI payload shape
  4) Tenant scoping enforced (distributor → 403)
"""
import os
import requests
import pytest

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
PW = "TradeKonekt2026!"

WHOLESALER_EMAIL = "unilever.wholesaler@tradekonekt.io"
MANUFACTURER_EMAIL = "unilever@tradekonekt.io"
DISTRIBUTOR_EMAIL = "lagos.distributor@tradekonekt.io"

WID = "d81efddf-e1af-4bb4-bcd7-619f74153300"
DID_SAMPLE = "d95dc722-679b-4ece-ab5e-af5e0dedd8ce"
MFR_ID = "b21c1dbe-1a6f-4c33-b036-f416579455d0"


def _login(email: str) -> str:
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": PW}, timeout=20)
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def wholesaler_hdr():
    return {"Authorization": f"Bearer {_login(WHOLESALER_EMAIL)}"}


@pytest.fixture(scope="module")
def manufacturer_hdr():
    return {"Authorization": f"Bearer {_login(MANUFACTURER_EMAIL)}"}


@pytest.fixture(scope="module")
def distributor_hdr():
    return {"Authorization": f"Bearer {_login(DISTRIBUTOR_EMAIL)}"}


# ---------------- Distributor Detail smoke ----------------
class TestDistributorDetail:
    def test_detail_returns_kpis_and_history(self, wholesaler_hdr):
        r = requests.get(
            f"{BASE}/api/wholesaler/{WID}/distributors/{DID_SAMPLE}/detail",
            headers=wholesaler_hdr, timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "kpis" in data
        assert "orders" in data
        assert isinstance(data["orders"], list)


# ---------------- Place Order on Behalf ----------------
class TestPlaceOrderOnBehalf:
    created_order_no = None

    @pytest.fixture(scope="class")
    def product(self, wholesaler_hdr):
        r = requests.get(f"{BASE}/api/wholesaler/{WID}/procurement/catalog",
                         headers=wholesaler_hdr, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        items = body if isinstance(body, list) else body.get("items", [])
        assert items, "wholesaler catalog is empty"
        # find any product with a unit_price
        for p in items:
            if (p.get("unit_price") or p.get("price") or 0) > 0:
                # ensure product_id field present
                p.setdefault("id", p.get("product_id"))
                return p
        p = items[0]
        p.setdefault("id", p.get("product_id"))
        return p

    def test_create_order(self, wholesaler_hdr, product):
        pid = product["id"]
        price = float(product.get("unit_price") or product.get("price") or 0)
        payload = {
            "distributor_id": DID_SAMPLE,
            "priority": "normal",
            "note": "TEST_pytest place-on-behalf",
            "items": [{"product_id": pid, "quantity": 5}],
        }
        r = requests.post(f"{BASE}/api/wholesaler/{WID}/orders",
                          json=payload, headers=wholesaler_hdr, timeout=30)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
        body = r.json()
        order = body.get("order") or body
        assert order.get("order_number", "").startswith("WO-"), order
        assert order.get("status") == "submitted"
        # distributor enrichment
        assert order.get("distributor_id") == DID_SAMPLE
        # totals — accept either total or computed
        items = order.get("items") or order.get("lines") or []
        assert items, "items missing"
        if price > 0:
            line_total = items[0].get("line_total") or items[0].get("total") or items[0].get("subtotal")
            if line_total is not None:
                assert float(line_total) == pytest.approx(5 * price, rel=0.01)
        pytest.shared_order_no = order["order_number"]
        TestPlaceOrderOnBehalf.created_order_no = order["order_number"]

    def test_new_order_surfaces_in_detail(self, wholesaler_hdr):
        r = requests.get(
            f"{BASE}/api/wholesaler/{WID}/distributors/{DID_SAMPLE}/detail",
            headers=wholesaler_hdr, timeout=20,
        )
        assert r.status_code == 200
        nums = [o.get("order_number") for o in r.json().get("orders", [])]
        assert TestPlaceOrderOnBehalf.created_order_no in nums, (
            f"newly-created order {TestPlaceOrderOnBehalf.created_order_no} not in history; saw {nums[:5]}"
        )


# ---------------- Allocation KPIs ----------------
class TestAllocationKPIs:
    def test_payload_shape(self, manufacturer_hdr):
        r = requests.get(f"{BASE}/api/allocation/kpis?days=30",
                         headers=manufacturer_hdr, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "kpis" in data and "warehouses" in data
        k = data["kpis"]
        for key in ("fill_rate_pct", "allocated_units", "requested_units",
                    "avg_allocation_hours", "back_order_rate_pct", "back_orders",
                    "decided_orders", "service_level_pct", "completed_orders",
                    "on_time_orders"):
            assert key in k, f"missing kpi key {key}"
        assert isinstance(data["warehouses"], list)
        if data["warehouses"]:
            w = data["warehouses"][0]
            for key in ("warehouse_id", "warehouse_name", "fulfillments",
                        "delivered", "in_progress", "on_time_pct"):
                assert key in w, f"missing warehouse key {key}"

    def test_distributor_forbidden(self, distributor_hdr):
        r = requests.get(f"{BASE}/api/allocation/kpis?days=30",
                         headers=distributor_hdr, timeout=20)
        assert r.status_code in (401, 403), f"expected 403, got {r.status_code}: {r.text[:200]}"

    def test_super_admin_requires_manufacturer_id(self):
        tok = _login("admin@tradekonekt.io")
        hdr = {"Authorization": f"Bearer {tok}"}
        # Without manufacturer_id: should error
        r = requests.get(f"{BASE}/api/allocation/kpis?days=30", headers=hdr, timeout=20)
        assert r.status_code in (400, 403, 422), f"expected error without mfr id; got {r.status_code}"
        # With manufacturer_id: 200
        r2 = requests.get(f"{BASE}/api/allocation/kpis?days=30&manufacturer_id={MFR_ID}",
                          headers=hdr, timeout=20)
        assert r2.status_code == 200, r2.text
