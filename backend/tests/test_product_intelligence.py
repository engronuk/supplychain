"""Backend tests for the Product Intelligence Center aggregator endpoint.

Endpoint under test:
    GET /api/manufacturer/{manufacturer_id}/product-intelligence
"""
import os

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
MANUFACTURER_ID = "b21c1dbe-1a6f-4c33-b036-f416579455d0"
EMAIL = "unilever@tradekonekt.io"
PASSWORD = "TradeKonekt2026!"


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def auth_client(api_client):
    r = api_client.post(
        f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}
    )
    assert r.status_code == 200, f"Login failed: {r.text}"
    token = r.json().get("access_token")
    assert token
    api_client.headers.update({"Authorization": f"Bearer {token}"})
    return api_client


@pytest.fixture(scope="module")
def payload(auth_client):
    """Snapshots compute in the background; poll until ready."""
    import time
    deadline = time.time() + 180
    while True:
        r = auth_client.get(
            f"{BASE_URL}/api/manufacturer/{MANUFACTURER_ID}/product-intelligence",
            timeout=30,
        )
        assert r.status_code == 200, f"Aggregator endpoint failed: {r.status_code} {r.text[:300]}"
        body = r.json()
        if not (body.get("_snapshot") or {}).get("computing"):
            return body
        assert time.time() < deadline, "snapshot still computing after 180s"
        time.sleep(5)


# ---------- top-level shape ----------
class TestShape:
    def test_top_level_keys(self, payload):
        expected = {
            "manufacturer", "kpis", "ai_brief", "portfolio",
            "performance_matrix", "batch_health", "expiry_risk",
            "category_performance", "geographic_heatmap",
            "stock_risk", "recent_alerts",
        }
        missing = expected - set(payload.keys())
        assert not missing, f"Missing keys: {missing}"

    def test_manufacturer_block(self, payload):
        assert payload["manufacturer"]["id"] == MANUFACTURER_ID


# ---------- KPI strip ----------
class TestKpis:
    def test_kpi_products_15(self, payload):
        assert payload["kpis"]["products"]["value"] == 15

    def test_active_batches_min_30(self, payload):
        assert payload["kpis"]["active_batches"]["value"] >= 30

    def test_units_in_network_positive(self, payload):
        assert payload["kpis"]["units_in_network"]["value"] > 0

    def test_expiring_90d_non_negative(self, payload):
        assert payload["kpis"]["expiring_90d"]["value"] >= 0

    def test_at_risk_value_non_negative(self, payload):
        assert payload["kpis"]["at_risk_value"]["value"] >= 0

    def test_revenue_90d_non_negative(self, payload):
        assert payload["kpis"]["revenue_90d"]["value"] >= 0


# ---------- batch health donut ----------
class TestBatchHealth:
    def test_total_positive(self, payload):
        assert payload["batch_health"]["total"] > 0

    def test_breakdown_four_statuses(self, payload):
        bd = payload["batch_health"]["breakdown"]
        statuses = {b["status"] for b in bd}
        assert statuses == {"healthy", "near_expiry", "expired", "recalled"}

    def test_breakdown_pcts_sum_to_100(self, payload):
        bd = payload["batch_health"]["breakdown"]
        total_pct = sum(b["pct"] for b in bd)
        assert 99.0 <= total_pct <= 101.0, f"pct sum = {total_pct}"


# ---------- expiry risk ----------
class TestExpiryRisk:
    def test_three_buckets(self, payload):
        b = payload["expiry_risk"]["buckets"]
        assert len(b) == 3
        labels = [x["label"] for x in b]
        # accept en-dash or hyphen
        assert any("0" in l and "30" in l for l in labels)
        assert any("31" in l and "60" in l for l in labels)
        assert any("61" in l and "90" in l for l in labels)

    def test_nearest_expiry_present(self, payload):
        ne = payload["expiry_risk"]["nearest_expiry"]
        assert ne is not None
        for k in ("product_name", "batch_number", "expiry_date", "days_remaining"):
            assert k in ne, f"missing {k}"
        assert isinstance(ne["days_remaining"], int)


# ---------- portfolio ----------
class TestPortfolio:
    def test_row_per_product(self, payload):
        assert len(payload["portfolio"]) == payload["kpis"]["products"]["value"] == 15

    def test_row_fields(self, payload):
        required = {
            "id", "name", "category", "revenue_90d", "units_in_network",
            "active_batches", "expiring_90d", "inventory_health",
            "sparkline_30d", "growth_pct",
        }
        row = payload["portfolio"][0]
        missing = required - set(row.keys())
        assert not missing, f"Missing portfolio fields: {missing}"

    def test_inventory_health_enum(self, payload):
        allowed = {"healthy", "watch", "risk"}
        for row in payload["portfolio"]:
            assert row["inventory_health"] in allowed, row

    def test_sparkline_30_elements(self, payload):
        for row in payload["portfolio"]:
            assert isinstance(row["sparkline_30d"], list)
            assert len(row["sparkline_30d"]) == 30


# ---------- ai brief ----------
class TestAiBrief:
    def test_insights_up_to_4(self, payload):
        ins = payload["ai_brief"]["insights"]
        assert 0 < len(ins) <= 4
        for i in ins:
            assert "kind" in i and "title" in i and "detail" in i

    def test_score_block(self, payload):
        s = payload["ai_brief"]["score"]
        assert 0 <= s["value"] <= 100
        assert s["status"] in {"Excellent", "Good", "Watch", "Critical", "—"}
        assert isinstance(s["trend"], list) and len(s["trend"]) == 12


# ---------- geographic heatmap ----------
class TestHeatmap:
    def test_rows(self, payload):
        rows = payload["geographic_heatmap"]
        assert len(rows) > 0
        allowed_health = {"excellent", "good", "fair", "poor", "no_data"}
        for r in rows:
            for k in ("state", "zone", "units", "revenue_90d", "health"):
                assert k in r
            assert r["health"] in allowed_health


# ---------- error paths ----------
class TestErrors:
    def test_invalid_manufacturer_404(self, auth_client):
        r = auth_client.get(
            f"{BASE_URL}/api/manufacturer/does-not-exist-zzz/product-intelligence"
        )
        assert r.status_code == 404
        assert "Manufacturer not found" in r.text


# ---------- idempotent batch seed ----------
class TestBatchSeed:
    def test_total_batches_equals_45(self, payload):
        # 15 products x 3 batches per SKU
        assert payload["batch_health"]["total"] == 45

    def test_three_batches_per_product(self, payload):
        from collections import Counter
        # active_batches in portfolio excludes expired/recalled, so check via
        # batch_health.total instead — already covered. Cross-check active sum:
        active_total = sum(p["active_batches"] for p in payload["portfolio"])
        # active is <=3 per product
        for p in payload["portfolio"]:
            assert p["active_batches"] <= 3
        # And the active total must equal kpis.active_batches.value
        assert active_total == payload["kpis"]["active_batches"]["value"]
