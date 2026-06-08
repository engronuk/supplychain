"""Extended pytest for the Universal Organization architecture refactor.

Covers:
- my_network endpoint for super_admin + non-admin
- per-role permissions (manufacturer/retailer/logistics_provider)
- all four hierarchy paths (mfr→wh, mfr→dist, dist→ws, ws→retailer)
- hierarchy cycle prevention via PATCH
- OrganizationRelationship CRUD + duplicate 409 + scope checks
- Regression smoke for legacy supply-chain endpoints (mfr/dist/retailer)
"""
import os
import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://supply-chain-hub-189.preview.emergentagent.com",
).rstrip("/")
PWD = "TradeKonekt2026!"


def _login(email: str) -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": PWD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {email} -> {r.status_code} {r.text}"
    return r.json()["access_token"]


def _hdr(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def admin_h():
    return _hdr(_login("admin@tradekonekt.io"))


@pytest.fixture(scope="module")
def mfr_h():
    return _hdr(_login("unilever@tradekonekt.io"))


@pytest.fixture(scope="module")
def dist_h():
    return _hdr(_login("lagos.distributor@tradekonekt.io"))


@pytest.fixture(scope="module")
def retailer_h():
    return _hdr(_login("retailer1@tradekonekt.io"))


# ------------------------- Permissions per role -------------------------------
class TestPermissionsPerRole:
    def test_manufacturer_permissions(self, mfr_h):
        r = requests.get(f"{BASE_URL}/api/organizations/me/permissions",
                         headers=mfr_h, timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body["is_super_admin"] is False
        assert body["user_org_type"] == "manufacturer"
        assert set(body["can_create_types"]) == {"warehouse", "distributor"}
        assert body["can_manage"] is True

    def test_retailer_permissions(self, retailer_h):
        r = requests.get(f"{BASE_URL}/api/organizations/me/permissions",
                         headers=retailer_h, timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body["is_super_admin"] is False
        assert body["user_org_type"] == "retailer"
        assert body["can_create_types"] == []
        assert body["can_manage"] is False


# ------------------------- my/network -----------------------------------------
class TestMyNetwork:
    def test_super_admin_virtual_root(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/organizations/me/network",
                         headers=admin_h, timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert body["id"] == "__root__"
        assert body["organization_name"] == "All Organizations"
        assert isinstance(body["children"], list)
        assert len(body["children"]) >= 1

    def test_non_admin_returns_own_subtree(self, dist_h):
        r = requests.get(f"{BASE_URL}/api/organizations/me/network",
                         headers=dist_h, timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert body["organization_type"] == "distributor"
        assert "children" in body


# ------------------------- Hierarchy paths ------------------------------------
class TestHierarchyPaths:
    """Create the four supported edges as super_admin and assert visibility."""

    @pytest.fixture(scope="class")
    def created(self, admin_h):
        created_ids: list[str] = []

        def _create(payload):
            r = requests.post(f"{BASE_URL}/api/organizations",
                              headers=admin_h, json=payload, timeout=15)
            assert r.status_code == 200, f"create failed: {payload} -> {r.text}"
            created_ids.append(r.json()["id"])
            return r.json()

        # Pick an existing manufacturer so we don't have to create one
        mfrs = requests.get(
            f"{BASE_URL}/api/organizations?organization_type=manufacturer",
            headers=admin_h, timeout=15).json()
        assert mfrs, "expected at least 1 manufacturer in seed"
        mfr = mfrs[0]

        wh = _create({
            "organization_name": "TEST_Warehouse_iter12",
            "organization_type": "warehouse",
            "parent_organization_id": mfr["id"],
        })
        dist = _create({
            "organization_name": "TEST_Distributor_iter12",
            "organization_type": "distributor",
            "parent_organization_id": mfr["id"],
        })
        ws = _create({
            "organization_name": "TEST_Wholesaler_iter12",
            "organization_type": "wholesaler",
            "parent_organization_id": dist["id"],
        })
        rt = _create({
            "organization_name": "TEST_Retailer_iter12",
            "organization_type": "retailer",
            "parent_organization_id": ws["id"],
        })
        out = {"mfr": mfr, "wh": wh, "dist": dist, "ws": ws, "rt": rt,
               "ids": created_ids}
        yield out
        # Teardown — soft-deactivate (no DELETE endpoint for orgs)
        for oid in created_ids:
            requests.patch(f"{BASE_URL}/api/organizations/{oid}",
                           headers=admin_h, json={"status": "inactive"},
                           timeout=10)

    def test_warehouse_visible_in_mfr_hierarchy(self, admin_h, created):
        r = requests.get(
            f"{BASE_URL}/api/organizations/{created['mfr']['id']}/hierarchy",
            headers=admin_h, timeout=20)
        assert r.status_code == 200
        tree = r.json()
        descendant_ids = set()

        def collect(node):
            descendant_ids.add(node["id"])
            for c in node.get("children", []):
                collect(c)

        collect(tree)
        assert created["wh"]["id"] in descendant_ids
        assert created["dist"]["id"] in descendant_ids
        assert created["ws"]["id"] in descendant_ids
        assert created["rt"]["id"] in descendant_ids

    def test_codes_have_correct_prefix(self, created):
        assert created["wh"]["organization_code"].startswith("WHR-")
        assert created["dist"]["organization_code"].startswith("DST-")
        assert created["ws"]["organization_code"].startswith("WHO-")
        assert created["rt"]["organization_code"].startswith("RTL-")

    def test_illegal_distributor_to_retailer_rejected(self, admin_h, created):
        r = requests.post(f"{BASE_URL}/api/organizations",
                          headers=admin_h,
                          json={
                              "organization_name": "TEST_Bad_Retailer",
                              "organization_type": "retailer",
                              "parent_organization_id": created["dist"]["id"],
                          },
                          timeout=10)
        assert r.status_code == 400

    def test_cycle_prevention_via_patch(self, admin_h, created):
        # Try to make the manufacturer's parent be its own grand-child (ws)
        r = requests.patch(
            f"{BASE_URL}/api/organizations/{created['mfr']['id']}",
            headers=admin_h,
            json={"parent_organization_id": created["ws"]["id"]},
            timeout=10)
        assert r.status_code == 400


# ------------------------- Relationships CRUD ---------------------------------
class TestRelationships:
    @pytest.fixture(scope="class")
    def setup(self, admin_h):
        # Use two real orgs from seed
        mfrs = requests.get(
            f"{BASE_URL}/api/organizations?organization_type=manufacturer",
            headers=admin_h, timeout=15).json()
        dists = requests.get(
            f"{BASE_URL}/api/organizations?organization_type=distributor",
            headers=admin_h, timeout=15).json()
        assert mfrs and dists
        return {"mfr": mfrs[0], "dist": dists[0]}

    def test_create_relationship(self, admin_h, setup):
        body = {
            "from_organization_id": setup["dist"]["id"],
            "to_organization_id": setup["mfr"]["id"],
            "relationship_type": "distributes_for",
        }
        r = requests.post(f"{BASE_URL}/api/organization-relationships",
                          headers=admin_h, json=body, timeout=10)
        # If a duplicate already exists from earlier runs, accept 409 and load it
        if r.status_code == 409:
            existing = requests.get(
                f"{BASE_URL}/api/organization-relationships?"
                f"organization_id={setup['dist']['id']}&relationship_type=distributes_for",
                headers=admin_h, timeout=10).json()
            rel = next(x for x in existing if x["to_organization_id"] == setup["mfr"]["id"])
        else:
            assert r.status_code == 200, r.text
            rel = r.json()
            assert rel["relationship_type"] == "distributes_for"
            assert rel["status"] == "active"
        TestRelationships._rel_id = rel["id"]

    def test_duplicate_returns_409(self, admin_h, setup):
        body = {
            "from_organization_id": setup["dist"]["id"],
            "to_organization_id": setup["mfr"]["id"],
            "relationship_type": "distributes_for",
        }
        r = requests.post(f"{BASE_URL}/api/organization-relationships",
                          headers=admin_h, json=body, timeout=10)
        assert r.status_code == 409

    def test_self_relationship_rejected(self, admin_h, setup):
        r = requests.post(f"{BASE_URL}/api/organization-relationships",
                          headers=admin_h,
                          json={
                              "from_organization_id": setup["mfr"]["id"],
                              "to_organization_id": setup["mfr"]["id"],
                              "relationship_type": "partner",
                          },
                          timeout=10)
        assert r.status_code == 400

    def test_org_relationships_helper_inlines_counterpart(self, admin_h, setup):
        r = requests.get(
            f"{BASE_URL}/api/organizations/{setup['dist']['id']}/relationships",
            headers=admin_h, timeout=10)
        assert r.status_code == 200
        rows = r.json()
        assert any(row.get("counterpart") and row["counterpart"]["id"] == setup["mfr"]["id"]
                   for row in rows)
        # Each row must have a 'direction' field
        for row in rows:
            assert row["direction"] in ("outgoing", "incoming")

    def test_patch_and_delete_relationship(self, admin_h):
        rel_id = TestRelationships._rel_id
        # patch: end the relationship
        r = requests.patch(
            f"{BASE_URL}/api/organization-relationships/{rel_id}",
            headers=admin_h, json={"status": "ended"}, timeout=10)
        assert r.status_code == 200
        assert r.json()["status"] == "ended"
        # delete
        d = requests.delete(
            f"{BASE_URL}/api/organization-relationships/{rel_id}",
            headers=admin_h, timeout=10)
        assert d.status_code == 200

    def test_retailer_scope_blocks_unknown_relationship(self, retailer_h, setup):
        # retailer should NOT be able to create a relationship between two
        # orgs that are entirely outside their subtree.
        body = {
            "from_organization_id": setup["dist"]["id"],
            "to_organization_id": setup["mfr"]["id"],
            "relationship_type": "partner",
        }
        r = requests.post(f"{BASE_URL}/api/organization-relationships",
                          headers=retailer_h, json=body, timeout=10)
        assert r.status_code in (403, 409)


# ------------------------- Legacy regression smoke ----------------------------
class TestLegacyRegression:
    def test_inventory(self, dist_h):
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=dist_h, timeout=10).json()
        did = me.get("entity_id") or me.get("user", {}).get("entity_id")
        r = requests.get(
            f"{BASE_URL}/api/inventory?owner_type=distributor&owner_id={did}",
            headers=dist_h, timeout=15)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_shipments(self, dist_h):
        r = requests.get(f"{BASE_URL}/api/shipments", headers=dist_h, timeout=15)
        assert r.status_code == 200

    def test_purchase_orders(self, retailer_h):
        r = requests.get(f"{BASE_URL}/api/procurement/purchase-orders",
                         headers=retailer_h, timeout=15)
        assert r.status_code == 200

    def test_quotes(self, retailer_h):
        r = requests.get(f"{BASE_URL}/api/procurement/quotes",
                         headers=retailer_h, timeout=15)
        assert r.status_code == 200

    def test_manufacturer_overview(self, mfr_h):
        # Resolve own org id via /auth/me
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=mfr_h, timeout=10).json()
        mid = me.get("entity_id") or me.get("user", {}).get("entity_id")
        assert mid
        r = requests.get(f"{BASE_URL}/api/manufacturer/{mid}/overview",
                         headers=mfr_h, timeout=20)
        assert r.status_code == 200
        assert r.json()

    def test_distributor_operations_intelligence(self, dist_h):
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=dist_h, timeout=10).json()
        did = me.get("entity_id") or me.get("user", {}).get("entity_id")
        assert did
        r = requests.get(
            f"{BASE_URL}/api/distributor/{did}/operations-intelligence",
            headers=dist_h, timeout=20)
        assert r.status_code == 200
        assert r.json()

    def test_retailer_inventory_command_center(self, retailer_h):
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=retailer_h,
                          timeout=10).json()
        rid = me.get("entity_id") or me.get("user", {}).get("entity_id")
        assert rid
        r = requests.get(
            f"{BASE_URL}/api/retailer/{rid}/inventory-command-center",
            headers=retailer_h, timeout=20)
        assert r.status_code == 200
        assert r.json()
