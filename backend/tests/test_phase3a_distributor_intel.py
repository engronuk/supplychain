"""Phase 3A — Wholesaler Distributor Analytics Center backend tests.

Covers:
 - GET /api/wholesaler/{wid}/analytics returns `distributors.deep`
 - deep.kpis / ranking / bcg / churn / trend_months / monthly_purchases
 - Regression: /api/allocation/kpis remains scoped to manufacturer (403
   for distributor + wholesaler roles).
"""
import os
import pytest
import requests
from pathlib import Path


def _load_env():
    env_file = Path("/app/frontend/.env")
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


_load_env()
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
PWD = "TradeKonekt2026!"
WID = "d81efddf-e1af-4bb4-bcd7-619f74153300"

MFR = "unilever@tradekonekt.io"
WHO = "unilever.wholesaler@tradekonekt.io"
DST = "lagos.distributor@tradekonekt.io"


def login(email: str) -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": PWD}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def who_h():
    return {"Authorization": f"Bearer {login(WHO)}"}


@pytest.fixture(scope="module")
def mfr_h():
    return {"Authorization": f"Bearer {login(MFR)}"}


@pytest.fixture(scope="module")
def dst_h():
    return {"Authorization": f"Bearer {login(DST)}"}


# ---------------------------------------------------------------------------
# /wholesaler/{wid}/analytics — distributors.deep payload
# ---------------------------------------------------------------------------
class TestDistributorsDeep:
    @pytest.fixture(scope="class")
    def deep(self, who_h):
        r = requests.get(f"{BASE_URL}/api/wholesaler/{WID}/analytics",
                         headers=who_h, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "distributors" in body
        deep = body["distributors"].get("deep")
        assert deep is not None, "Missing distributors.deep block"
        return deep

    def test_kpi_keys(self, deep):
        k = deep["kpis"]
        for key in ("active_distributors", "total_revenue",
                    "average_order_value", "average_order_frequency",
                    "fill_rate_pct", "service_level_pct",
                    "high_growth", "stable", "at_risk"):
            assert key in k, f"missing kpi key {key}"
        assert isinstance(k["active_distributors"], int)
        assert k["high_growth"] + k["stable"] + k["at_risk"] == \
            k["active_distributors"], (
                "Status mix counts must sum to active_distributors")

    def test_ranking_shape_and_sort(self, deep):
        rk = deep["ranking"]
        assert isinstance(rk, list) and len(rk) > 0
        revs = [r["revenue"] for r in rk]
        assert revs == sorted(revs, reverse=True), "ranking not sorted desc"
        valid_status = {"high_growth", "stable", "at_risk"}
        for row in rk:
            for key in ("id", "name", "region", "revenue",
                        "revenue_share_pct", "orders",
                        "growth_pct", "status", "fill_rate_pct"):
                assert key in row, f"ranking row missing {key}"
            assert row["status"] in valid_status

    def test_bcg_block(self, deep):
        bcg = deep["bcg"]
        assert "rev_threshold" in bcg and "growth_threshold" in bcg
        items = bcg["items"]
        assert len(items) == len(deep["ranking"])
        valid = {"star", "cash_cow", "question_mark", "at_risk"}
        for it in items:
            assert it["quadrant"] in valid

    def test_churn_block(self, deep):
        churn = deep["churn"]
        assert isinstance(churn, list) and len(churn) > 0
        valid = {"low", "medium", "high"}
        for c in churn:
            assert 0 <= c["score"] <= 100
            assert c["level"] in valid
            assert isinstance(c["reasons"], list) and len(c["reasons"]) >= 1
            for key in ("id", "name", "score", "level", "reasons"):
                assert key in c

    def test_trend_block(self, deep):
        months = deep["trend_months"]
        assert len(months) == 6
        mp = deep["monthly_purchases"]
        for m in months:
            assert m in mp


# ---------------------------------------------------------------------------
# Regression — Phase 2 security fix on /allocation/kpis
# ---------------------------------------------------------------------------
class TestAllocationKpisRegression:
    def test_manufacturer_ok(self, mfr_h):
        r = requests.get(f"{BASE_URL}/api/allocation/kpis?days=30",
                         headers=mfr_h, timeout=15)
        assert r.status_code == 200, r.text

    def test_distributor_forbidden(self, dst_h):
        r = requests.get(f"{BASE_URL}/api/allocation/kpis?days=30",
                         headers=dst_h, timeout=15)
        assert r.status_code == 403, (
            f"distributor should be forbidden, got {r.status_code}: {r.text[:200]}")

    def test_wholesaler_forbidden(self, who_h):
        r = requests.get(f"{BASE_URL}/api/allocation/kpis?days=30",
                         headers=who_h, timeout=15)
        assert r.status_code == 403, (
            f"wholesaler should be forbidden, got {r.status_code}: {r.text[:200]}")
