"""Phase 3B-3E backend regression: Inventory Analytics Center, Forecast Center,
Intelligence Center briefing, Control Tower. Plus Phase 3A regression and
tenant-scoping checks. Pure rule-based math — no AI.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://supply-chain-hub-189.preview.emergentagent.com").rstrip("/")
PASSWORD = "TradeKonekt2026!"
WHOLESALER_EMAIL = "unilever.wholesaler@tradekonekt.io"
WID = "d81efddf-e1af-4bb4-bcd7-619f74153300"
MANUFACTURER_EMAIL = "unilever@tradekonekt.io"
DISTRIBUTOR_EMAIL = "lagos.distributor@tradekonekt.io"
TENANT2_WHOLESALER_EMAIL = "lagos.wholesaler@tradekonekt.io"


def _login(email: str) -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def wholesaler_headers():
    return {"Authorization": f"Bearer {_login(WHOLESALER_EMAIL)}"}


@pytest.fixture(scope="module")
def manufacturer_headers():
    return {"Authorization": f"Bearer {_login(MANUFACTURER_EMAIL)}"}


@pytest.fixture(scope="module")
def distributor_headers():
    return {"Authorization": f"Bearer {_login(DISTRIBUTOR_EMAIL)}"}


@pytest.fixture(scope="module")
def analytics_payload(wholesaler_headers):
    r = requests.get(f"{BASE_URL}/api/wholesaler/{WID}/analytics",
                     headers=wholesaler_headers, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Tenant scoping
# ---------------------------------------------------------------------------
class TestTenantScoping:
    def test_same_wholesaler_can_read(self, analytics_payload):
        assert analytics_payload["wholesaler_id"] == WID

    def test_same_tenant_distributor_allowed_read_only(self, distributor_headers):
        # Per require_wholesaler_access: same-tenant distributor is allowed read.
        r = requests.get(f"{BASE_URL}/api/wholesaler/{WID}/analytics",
                         headers=distributor_headers, timeout=20)
        assert r.status_code == 200

    def test_same_tenant_manufacturer_allowed_read(self, manufacturer_headers):
        # Per require_wholesaler_access: same-tenant manufacturer is allowed read.
        r = requests.get(f"{BASE_URL}/api/wholesaler/{WID}/analytics",
                         headers=manufacturer_headers, timeout=20)
        assert r.status_code == 200

    def test_other_tenant_wholesaler_cannot_read(self):
        token = _login(TENANT2_WHOLESALER_EMAIL)
        r = requests.get(f"{BASE_URL}/api/wholesaler/{WID}/analytics",
                         headers={"Authorization": f"Bearer {token}"}, timeout=20)
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# Phase 3B — Inventory Analytics deep
# ---------------------------------------------------------------------------
class TestInventoryAnalyticsCenter:
    def test_block_present(self, analytics_payload):
        assert "deep" in analytics_payload["inventory"]
        deep = analytics_payload["inventory"]["deep"]
        for k in ("kpis", "days_of_supply", "aging", "dead_stock",
                  "expiry", "turnover_by_category", "turnover_by_warehouse"):
            assert k in deep, f"missing inventory.deep.{k}"

    def test_kpis_keys_and_types(self, analytics_payload):
        k = analytics_payload["inventory"]["deep"]["kpis"]
        for key in ("inventory_value", "total_units", "turnover_per_year",
                    "stock_coverage_pct", "stockout_risk_count",
                    "expiring_value_60d", "dead_stock_value"):
            assert key in k
        assert k["total_units"] >= 0
        assert k["inventory_value"] >= 0

    def test_dos_bands_keys(self, analytics_payload):
        dos = analytics_payload["inventory"]["deep"]["days_of_supply"]
        for k in ("green", "yellow", "red"):
            assert k in dos

    def test_aging_buckets(self, analytics_payload):
        ag = analytics_payload["inventory"]["deep"]["aging"]["buckets"]
        for k in ("0_30", "31_60", "61_90", "over_90"):
            assert k in ag

    def test_dead_stock_buckets(self, analytics_payload):
        ds = analytics_payload["inventory"]["deep"]["dead_stock"]["buckets"]
        for k in ("dead_30", "dead_60", "dead_90"):
            assert k in ds

    def test_expiry_buckets(self, analytics_payload):
        ex = analytics_payload["inventory"]["deep"]["expiry"]["buckets"]
        for k in ("expired", "exp_30", "exp_60", "exp_90"):
            assert k in ex


# ---------------------------------------------------------------------------
# Phase 3C — Forecast Center deep
# ---------------------------------------------------------------------------
class TestForecastCenter:
    def test_block_present(self, analytics_payload):
        deep = analytics_payload["demand_forecast"]["deep"]
        for k in ("kpis", "products", "regional", "distributors",
                  "replenishment", "safety"):
            assert k in deep, f"missing demand_forecast.deep.{k}"

    def test_kpis_keys(self, analytics_payload):
        k = analytics_payload["demand_forecast"]["deep"]["kpis"]
        for key in ("total_projected_demand_7d", "total_projected_demand_30d",
                    "total_projected_demand_90d", "total_projected_revenue_30d",
                    "urgent_replenishments", "safety_stock_breaches",
                    "products_in_forecast"):
            assert key in k

    def test_product_rows_have_projections(self, analytics_payload):
        products = analytics_payload["demand_forecast"]["deep"]["products"]
        if products:
            row = products[0]
            for key in ("projected_7d", "projected_30d", "projected_90d",
                        "growth_pct", "product_name", "on_hand"):
                assert key in row

    def test_replenishment_priority_values(self, analytics_payload):
        for r in analytics_payload["demand_forecast"]["deep"]["replenishment"]:
            assert r["priority"] in ("urgent", "soon", "plan")

    def test_safety_status_values(self, analytics_payload):
        for r in analytics_payload["demand_forecast"]["deep"]["safety"]:
            assert r["status"] in ("breach", "warn", "ok", "unknown")


# ---------------------------------------------------------------------------
# Phase 3D — Intelligence Briefing
# ---------------------------------------------------------------------------
class TestIntelligenceCenter:
    def test_block_present(self, analytics_payload):
        intel = analytics_payload["intelligence"]
        for k in ("headlines", "opportunities", "risks", "actions", "snapshot"):
            assert k in intel

    def test_headlines_at_least_three(self, analytics_payload):
        headlines = analytics_payload["intelligence"]["headlines"]
        assert isinstance(headlines, list)
        assert len(headlines) >= 3, f"only {len(headlines)} headlines"

    def test_risks_have_severity(self, analytics_payload):
        risks = analytics_payload["intelligence"]["risks"]
        for r in risks:
            assert r.get("severity") in ("high", "medium", "low")

    def test_actions_have_priority(self, analytics_payload):
        actions = analytics_payload["intelligence"]["actions"]
        for a in actions:
            assert a.get("priority") in ("high", "medium", "low")

    def test_snapshot_keys(self, analytics_payload):
        snap = analytics_payload["intelligence"]["snapshot"]
        for key in ("active_distributors", "total_revenue_90d",
                    "projected_revenue_30d", "urgent_replenishments",
                    "high_churn", "safety_breaches"):
            assert key in snap


# ---------------------------------------------------------------------------
# Phase 3E — Control Tower
# ---------------------------------------------------------------------------
class TestControlTower:
    def test_block_present(self, analytics_payload):
        ct = analytics_payload["control_tower"]
        for k in ("health_score", "heat_maps", "network"):
            assert k in ct

    def test_health_score_range_and_band(self, analytics_payload):
        hs = analytics_payload["control_tower"]["health_score"]
        assert 0 <= hs["composite"] <= 100, hs
        assert hs["band"] in ("excellent", "good", "watch", "critical")
        for k in ("inventory_health", "distributor_health",
                  "fulfillment_performance", "shipment_reliability"):
            assert k in hs["components"]

    def test_heat_maps_have_intensity(self, analytics_payload):
        hm = analytics_payload["control_tower"]["heat_maps"]
        for key in ("revenue_by_region", "inventory_by_category", "distributor_activity"):
            assert key in hm
            for row in hm[key]:
                assert "intensity" in row
                assert 0 <= row["intensity"] <= 1

    def test_network_summary(self, analytics_payload):
        net = analytics_payload["control_tower"]["network"]
        assert "nodes" in net and "summary" in net
        for k in ("warehouses", "distributors", "active_shipments"):
            assert k in net["summary"]


# ---------------------------------------------------------------------------
# Phase 3A regression
# ---------------------------------------------------------------------------
class TestPhase3ARegression:
    def test_distributors_deep_block(self, analytics_payload):
        d = analytics_payload["distributors"]["deep"]
        for k in ("kpis", "ranking", "bcg", "churn",
                  "trend_months", "monthly_purchases"):
            assert k in d

    def test_bcg_has_items_with_quadrants(self, analytics_payload):
        items = analytics_payload["distributors"]["deep"]["bcg"]["items"]
        assert len(items) >= 1
        valid = {"star", "cash_cow", "question_mark", "at_risk"}
        for i in items:
            assert i["quadrant"] in valid

    def test_ranking_has_status_badges(self, analytics_payload):
        ranking = analytics_payload["distributors"]["deep"]["ranking"]
        valid = {"high_growth", "stable", "at_risk"}
        for r in ranking:
            assert r["status"] in valid


# ---------------------------------------------------------------------------
# Other regressions
# ---------------------------------------------------------------------------
class TestStandaloneRoutes:
    def test_wholesaler_orders(self, wholesaler_headers):
        r = requests.get(f"{BASE_URL}/api/wholesaler/{WID}/orders",
                         headers=wholesaler_headers, timeout=20)
        assert r.status_code == 200

    def test_wholesaler_shipments(self, wholesaler_headers):
        r = requests.get(f"{BASE_URL}/api/wholesaler/{WID}/shipments",
                         headers=wholesaler_headers, timeout=20)
        assert r.status_code == 200

    def test_allocation_kpis_manufacturer_200(self, manufacturer_headers):
        r = requests.get(f"{BASE_URL}/api/allocation/kpis",
                         headers=manufacturer_headers, timeout=20)
        assert r.status_code == 200

    def test_allocation_kpis_distributor_403(self, distributor_headers):
        r = requests.get(f"{BASE_URL}/api/allocation/kpis",
                         headers=distributor_headers, timeout=20)
        assert r.status_code == 403

    def test_allocation_kpis_wholesaler_403(self, wholesaler_headers):
        r = requests.get(f"{BASE_URL}/api/allocation/kpis",
                         headers=wholesaler_headers, timeout=20)
        assert r.status_code == 403
