"""Pytest for the Universal Organization architecture."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001")


def _login(email, pwd="TradeKonekt2026!"):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": pwd}, timeout=10)
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def super_admin_headers():
    return {"Authorization": f"Bearer {_login('admin@tradekonekt.io')}"}


@pytest.fixture(scope="module")
def distributor_headers():
    return {"Authorization": f"Bearer {_login('lagos.distributor@tradekonekt.io')}"}


class TestOrganizations:
    def test_super_admin_sees_all(self, super_admin_headers):
        r = requests.get(f"{BASE_URL}/api/organizations",
                         headers=super_admin_headers, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert len(body) >= 90, f"expected >=90 orgs, got {len(body)}"

    def test_permissions_super_admin(self, super_admin_headers):
        r = requests.get(f"{BASE_URL}/api/organizations/me/permissions",
                         headers=super_admin_headers, timeout=10).json()
        assert r["is_super_admin"] is True
        assert len(r["can_create_types"]) == 6

    def test_permissions_distributor(self, distributor_headers):
        r = requests.get(f"{BASE_URL}/api/organizations/me/permissions",
                         headers=distributor_headers, timeout=10).json()
        assert r["is_super_admin"] is False
        assert r["user_org_type"] == "distributor"
        assert r["can_create_types"] == ["wholesaler"]

    def test_distributor_scope_limited(self, distributor_headers):
        r = requests.get(f"{BASE_URL}/api/organizations?organization_type=retailer",
                         headers=distributor_headers, timeout=15).json()
        # Distributors should only see their connected retailers (not all 3080)
        assert 1 <= len(r) <= 200

    def test_hierarchy_tree(self, super_admin_headers):
        # Get the manufacturer org
        orgs = requests.get(
            f"{BASE_URL}/api/organizations?organization_type=manufacturer",
            headers=super_admin_headers, timeout=10).json()
        assert len(orgs) >= 1
        root_id = orgs[0]["id"]
        tree = requests.get(
            f"{BASE_URL}/api/organizations/{root_id}/hierarchy",
            headers=super_admin_headers, timeout=15).json()
        assert tree["id"] == root_id
        assert "children" in tree
        assert len(tree["children"]) > 0
        # Each distributor child should have its own children (retailers)
        first_dist = tree["children"][0]
        assert first_dist["organization_type"] == "distributor"
        assert len(first_dist.get("children", [])) > 0

    def test_create_organization_super_admin(self, super_admin_headers):
        r = requests.post(f"{BASE_URL}/api/organizations",
                          headers=super_admin_headers,
                          json={
                              "organization_name": "Test Logistics Co",
                              "organization_type": "logistics_provider",
                              "region": "Lagos",
                          },
                          timeout=10)
        assert r.status_code == 200
        org = r.json()
        assert org["organization_code"].startswith("LOG-")
        assert org["organization_type"] == "logistics_provider"
        # cleanup
        requests.patch(f"{BASE_URL}/api/organizations/{org['id']}",
                       headers=super_admin_headers,
                       json={"status": "inactive"}, timeout=10)

    def test_distributor_cannot_create_distributor(self, distributor_headers):
        r = requests.post(f"{BASE_URL}/api/organizations",
                          headers=distributor_headers,
                          json={
                              "organization_name": "Forbidden Dist",
                              "organization_type": "distributor",
                          },
                          timeout=10)
        assert r.status_code == 403

    def test_distributor_can_create_wholesaler(self, distributor_headers):
        r = requests.post(f"{BASE_URL}/api/organizations",
                          headers=distributor_headers,
                          json={
                              "organization_name": "Test Wholesaler ABC",
                              "organization_type": "wholesaler",
                              "region": "Lagos",
                          },
                          timeout=10)
        assert r.status_code == 200
        wsr = r.json()
        assert wsr["organization_code"].startswith("WHO-")
        # parent should default to the distributor's own org
        assert wsr["parent_organization_id"] is not None
        # cleanup
        requests.patch(f"{BASE_URL}/api/organizations/{wsr['id']}",
                       headers=distributor_headers,
                       json={"status": "inactive"}, timeout=10)

    def test_invalid_parent_child_combo_400(self, super_admin_headers):
        orgs = requests.get(
            f"{BASE_URL}/api/organizations?organization_type=retailer",
            headers=super_admin_headers, timeout=10).json()
        retailer_id = orgs[0]["id"]
        r = requests.post(f"{BASE_URL}/api/organizations",
                          headers=super_admin_headers,
                          json={
                              "organization_name": "Bad Hierarchy",
                              "organization_type": "manufacturer",
                              "parent_organization_id": retailer_id,
                          },
                          timeout=10)
        assert r.status_code == 400

    def test_organization_codes_unique_per_type(self, super_admin_headers):
        orgs = requests.get(f"{BASE_URL}/api/organizations",
                            headers=super_admin_headers, timeout=15).json()
        codes = [o["organization_code"] for o in orgs]
        assert len(codes) == len(set(codes)), "duplicate organization_code detected"
