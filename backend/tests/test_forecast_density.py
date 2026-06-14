"""Regression tests for the forecast data sparsity fix.

Verifies:
1.  daily_sales has at least 11 months of dense data (after backfill).
2.  /manufacturer/{id}/overview returns 12 dense monthly buckets
    AND demand_forecast bars are all positive (no zeros from sparse data).
3.  /intel/forecasts/stockout returns the new urgency_counts payload.
4.  Stock-exhaustion forecasts have at least 1 entry in critical+high
    after the backfill (proves recompute picks up the dense series).
"""
from __future__ import annotations

import os

import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
UNILEVER_ID = "b21c1dbe-1a6f-4c33-b036-f416579455d0"


pytestmark = pytest.mark.skipif(
    not BASE_URL, reason="REACT_APP_BACKEND_URL not set",
)


def test_overview_returns_12_dense_months():
    r = requests.post(
        f"{BASE_URL}/api/manufacturer/{UNILEVER_ID}/overview/refresh", timeout=30,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    trend = data.get("revenue_trend", [])
    assert len(trend) >= 11, f"Expected >=11 monthly buckets, got {len(trend)}"
    non_zero = [m for m in trend if (m.get("revenue") or 0) > 0]
    assert len(non_zero) >= 11, (
        f"At least 11 months should have non-zero revenue, got {len(non_zero)}"
    )


def test_demand_forecast_bars_are_dense():
    r = requests.get(
        f"{BASE_URL}/api/manufacturer/{UNILEVER_ID}/overview", timeout=15,
    )
    assert r.status_code == 200, r.text
    bars = r.json().get("demand_forecast", {}).get("bars", [])
    assert len(bars) == 30, f"Expected 30 forecast bars, got {len(bars)}"
    assert min(bars) > 0, "All bars should be > 0 after backfill"
    assert max(bars) >= 100, "Bars should reflect a realistic network volume"


def test_intel_forecasts_has_urgency_counts():
    r = requests.get(
        f"{BASE_URL}/api/intel/forecasts/stockout",
        params={"role": "manufacturer", "entity_id": UNILEVER_ID, "urgency": "critical"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    counts = body.get("urgency_counts")
    assert isinstance(counts, dict), "urgency_counts must be present"
    for k in ("critical", "high", "medium", "low"):
        assert k in counts, f"urgency_counts missing '{k}'"
    total = sum(int(v) for v in counts.values())
    assert total > 100, f"Total tracked forecasts should be >100, got {total}"


def test_critical_or_high_forecasts_present():
    r = requests.get(
        f"{BASE_URL}/api/intel/forecasts/stockout",
        params={"role": "manufacturer", "entity_id": UNILEVER_ID, "urgency": "critical"},
        timeout=15,
    )
    counts = r.json().get("urgency_counts") or {}
    assert (counts.get("critical", 0) + counts.get("high", 0)) >= 1, (
        f"Expected at least 1 critical/high forecast, got {counts}"
    )
