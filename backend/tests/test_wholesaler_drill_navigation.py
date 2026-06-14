"""Iteration 27 — Strict navigation: Distributor → Wholesaler → Retailer drill paths."""
import os
import pytest
import requests

BASE_URL = "https://supply-chain-hub-189.preview.emergentagent.com"
APEX_DID = "f9dfaf08-4ee2-3c64-e96b-983c385625b2"
ROYAL_WID = "6458308e-3b90-283c-f156-1a385cc22dd1"


@pytest.fixture(scope="module")
def dist_headers():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "unilever.distributor@tradekonekt.io", "password": "TradeKonekt2026!"},
    )
    assert r.status_code == 200
    tok = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def mfr_headers():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "fmn@tradekonekt.io", "password": "TradeKonekt2026!"},
    )
    assert r.status_code == 200
    tok = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {tok}"}


# Wholesaler drill detail endpoint
def test_wholesaler_detail_endpoint_shape(dist_headers):
    r = requests.get(
        f"{BASE_URL}/api/distributor/{APEX_DID}/wholesaler/{ROYAL_WID}/detail",
        headers=dist_headers,
    )
    assert r.status_code == 200
    d = r.json()
    assert "wholesaler" in d and "kpis" in d and "retailers" in d
    w = d["wholesaler"]
    for k in ("id", "name", "code", "region", "city"):
        assert k in w
    assert w["name"] == "Royal Trading 1"
    k = d["kpis"]
    for k2 in (
        "total_retailers",
        "active_retailers_30d",
        "revenue_90d",
        "pending_orders_from_retailers",
        "pending_procurement_to_distributor",
    ):
        assert k2 in k
    assert k["total_retailers"] == 6


def test_royal_trading_contains_shoprite_and_spar(dist_headers):
    r = requests.get(
        f"{BASE_URL}/api/distributor/{APEX_DID}/wholesaler/{ROYAL_WID}/detail",
        headers=dist_headers,
    )
    retailers = r.json()["retailers"]
    assert len(retailers) == 6
    names = {x["name"] for x in retailers}
    assert "Shoprite Apapa" in names
    assert "Spar Ikeja" in names
    # each retailer has required fields
    sample = retailers[0]
    for f in ("id", "name", "code", "region", "city", "revenue_90d", "units_90d", "last_sale_date", "status"):
        assert f in sample, f"missing field {f}"


def test_wholesaler_detail_mismatched_ids_returns_404(dist_headers):
    r = requests.get(
        f"{BASE_URL}/api/distributor/{APEX_DID}/wholesaler/00000000-0000-0000-0000-000000000000/detail",
        headers=dist_headers,
    )
    assert r.status_code in (403, 404)


# Distributor /wholesaler-network endpoint
def test_distributor_wholesaler_network(dist_headers):
    r = requests.get(
        f"{BASE_URL}/api/distributor/{APEX_DID}/wholesaler-network",
        headers=dist_headers,
    )
    assert r.status_code == 200
    d = r.json()
    assert d["kpis"]["total_wholesalers"] == 3
    assert len(d["wholesalers"]) == 3


# Manufacturer drill — wholesaler network used by ManufacturerDistributorDetail
def test_manufacturer_can_see_distributor_wholesaler_network(mfr_headers):
    # FMN distributor id — fetch list first
    r = requests.get(f"{BASE_URL}/api/distributors", headers=mfr_headers)
    assert r.status_code == 200
    dists = r.json()
    assert len(dists) > 0
    did = dists[0].get("id") or dists[0].get("entity_id")
    r2 = requests.get(
        f"{BASE_URL}/api/distributor/{did}/wholesaler-network",
        headers=mfr_headers,
    )
    assert r2.status_code == 200
    assert "wholesalers" in r2.json()
