"""Multi-tenant isolation validation.

Exercises every visibility / scoping rule across the Unilever and Flour
Mills Nigeria tenants and emits a Markdown validation report.

What it checks
--------------
 1. Tenant orgs are visible to their own users (full subtree).
 2. Tenant orgs are NOT visible to the other tenant's users.
 3. Retailers cannot see ANY organization other than themselves.
 4. Permissions endpoint reports the correct `can_create_types` for each tier.
 5. Hierarchy traversal returns only descendants of the user's org root.
 6. Direct GET by id of a foreign org returns 403 (not 200, not 404).
 7. Super-admin sees both tenants (control case).

Run with:
    python3 -m tests.test_multi_tenant_isolation
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://supply-chain-hub-189.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

# Test accounts -------------------------------------------------------------
UNILEVER_USERS = {
    "super_admin":  ("admin@tradekonekt.io",            "TradeKonekt2026!"),
    "manufacturer": ("unilever@tradekonekt.io",         "TradeKonekt2026!"),
    "distributor":  ("lagos.distributor@tradekonekt.io", "TradeKonekt2026!"),
    "retailer":     ("retailer1@tradekonekt.io",        "TradeKonekt2026!"),
}
FLOUR_USERS = {
    "manufacturer": ("flour.admin@tradekonekt.io",       "TradeKonekt2026!"),
    "warehouse":    ("flour.warehouse@tradekonekt.io",   "TradeKonekt2026!"),
    "distributor":  ("prime.distributor@tradekonekt.io", "TradeKonekt2026!"),
    "wholesaler":   ("lagos.wholesaler@tradekonekt.io",  "TradeKonekt2026!"),
    "retailer":     ("flour.retailer1@tradekonekt.io",   "TradeKonekt2026!"),
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login",
                      json={"email": email, "password": password},
                      timeout=15)
    r.raise_for_status()
    return r.json()["access_token"]


def auth(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def get(token: str, path: str, **kwargs) -> requests.Response:
    return requests.get(f"{API}{path}", headers=auth(token), timeout=20, **kwargs)


# ---------------------------------------------------------------------------
# Test cases
# ---------------------------------------------------------------------------
def collect_org_ids_and_names() -> Tuple[Dict[str, Dict], Dict[str, Dict]]:
    """As super_admin, pull each tenant's org tree once so we know which ids
    belong to whom."""
    token = login(*UNILEVER_USERS["super_admin"])
    all_orgs = get(token, "/organizations").json()
    unilever = {o["id"]: o for o in all_orgs
                if o.get("organization_name") == "Unilever"
                or (o.get("metadata") or {}).get("seeded_by") == "migrate_regional_topology"
                or (o.get("metadata") or {}).get("seeded_by") == "seed"}
    flour    = {o["id"]: o for o in all_orgs
                if (o.get("metadata") or {}).get("seeded_by") == "seed_flour_mills_tenant"}
    # Walk descendants so we catch ALL of each tenant (including ones lacking
    # a clear `seeded_by` marker, e.g. the 3080 retailers).
    unilever_root_id = next((o["id"] for o in all_orgs
                             if o["organization_type"] == "manufacturer"
                             and o["organization_name"] == "Unilever"), None)
    flour_root_id    = next((o["id"] for o in all_orgs
                             if o["organization_type"] == "manufacturer"
                             and o["organization_name"] == "Flour Mills Nigeria"), None)
    assert unilever_root_id and flour_root_id, \
        f"Missing root orgs: uni={unilever_root_id!r} flour={flour_root_id!r}"

    def subtree(root_id: str) -> Dict[str, Dict]:
        out: Dict[str, Dict] = {}
        frontier = [root_id]
        index = {o["id"]: o for o in all_orgs}
        while frontier:
            nxt = []
            for fid in frontier:
                if fid in index:
                    out[fid] = index[fid]
                # children
                for o in all_orgs:
                    if o.get("parent_organization_id") == fid and o["id"] not in out:
                        nxt.append(o["id"])
            frontier = nxt
        return out

    return subtree(unilever_root_id), subtree(flour_root_id)


def main() -> int:
    print("Multi-tenant isolation validation\n" + "=" * 50)
    results: List[Dict[str, Any]] = []

    def record(name: str, passed: bool, detail: str = ""):
        results.append({"test": name, "pass": passed, "detail": detail})
        flag = "PASS" if passed else "FAIL"
        print(f"  [{flag}] {name}" + (f" — {detail}" if detail else ""))

    # ---- Sub-1: collect the universe ---------------------------------------
    uni_subtree, flour_subtree = collect_org_ids_and_names()
    uni_ids   = set(uni_subtree.keys())
    flour_ids = set(flour_subtree.keys())
    print(f"  Unilever subtree size: {len(uni_ids)}")
    print(f"  Flour Mills subtree size: {len(flour_ids)}")
    record("super_admin sees both tenants",
           len(uni_ids) > 1 and len(flour_ids) >= 9,
           f"uni={len(uni_ids)} flour={len(flour_ids)}")
    record("Tenant subtrees are disjoint",
           uni_ids.isdisjoint(flour_ids),
           f"intersection={len(uni_ids & flour_ids)}")

    # ---- 1. Flour Mills users see ONLY Flour Mills orgs --------------------
    for role, (email, pwd) in FLOUR_USERS.items():
        token = login(email, pwd)
        orgs = get(token, "/organizations").json()
        ids = {o["id"] for o in orgs}
        in_flour = ids <= flour_ids
        no_uni_leak = not (ids & uni_ids)
        record(
            f"Flour [{role}] only sees Flour orgs",
            in_flour and no_uni_leak,
            f"count={len(ids)} flour_overlap={len(ids & flour_ids)} unilever_overlap={len(ids & uni_ids)}",
        )

    # ---- 2. Unilever users do NOT see any Flour Mills org ------------------
    for role, (email, pwd) in UNILEVER_USERS.items():
        if role == "super_admin":
            continue  # control: super admin sees everything
        token = login(email, pwd)
        orgs = get(token, "/organizations").json()
        ids = {o["id"] for o in orgs}
        no_flour_leak = not (ids & flour_ids)
        record(
            f"Unilever [{role}] cannot see any Flour Mills org",
            no_flour_leak,
            f"count={len(ids)} flour_overlap={len(ids & flour_ids)}",
        )

    # ---- 3. Retailer sees ONLY their own org -------------------------------
    for tenant_label, (email, pwd) in [
        ("Unilever retailer", UNILEVER_USERS["retailer"]),
        ("Flour retailer",    FLOUR_USERS["retailer"]),
    ]:
        token = login(email, pwd)
        orgs = get(token, "/organizations").json()
        record(
            f"{tenant_label} sees only own org",
            len(orgs) == 1,
            f"count={len(orgs)}",
        )

    # ---- 4. Permissions matrix --------------------------------------------
    expected_perms = {
        "manufacturer": (["warehouse", "distributor"], True),
        "warehouse":    (["distributor"],              True),
        "distributor":  (["wholesaler"],               True),
        "wholesaler":   (["retailer"],                 True),
        "retailer":     ([],                            False),
    }
    for role, (email, pwd) in FLOUR_USERS.items():
        token = login(email, pwd)
        perms = get(token, "/organizations/me/permissions").json()
        exp_create, exp_manage = expected_perms[role]
        actual_create = sorted(perms.get("can_create_types") or [])
        ok_create = actual_create == sorted(exp_create)
        ok_manage = bool(perms.get("can_manage")) == exp_manage
        record(
            f"Permissions [{role}]",
            ok_create and ok_manage,
            f"can_create={actual_create!r} expected={exp_create!r} "
            f"can_manage={perms.get('can_manage')} expected={exp_manage}",
        )

    # ---- 5. Hierarchy traversal (Flour Mills root) -------------------------
    flour_admin_tok = login(*FLOUR_USERS["manufacturer"])
    network = get(flour_admin_tok, "/organizations/me/network").json()

    def walk(n: Dict, acc: set):
        acc.add(n["id"])
        for c in n.get("children") or []:
            walk(c, acc)

    visited = set()
    walk(network, visited)
    record(
        "Flour Mfg `/me/network` returns full 9-node tree",
        len(visited) == 9 and visited == flour_ids,
        f"visited={len(visited)} flour={len(flour_ids)} match={visited == flour_ids}",
    )

    # ---- 6. Direct foreign-org access returns 403 --------------------------
    # Pick one Flour Mills org id and try to GET it as a Unilever user.
    flour_dist_id = next(
        o["id"] for o in flour_subtree.values()
        if o["organization_type"] == "distributor"
    )
    uni_mfg_tok = login(*UNILEVER_USERS["manufacturer"])
    r = get(uni_mfg_tok, f"/organizations/{flour_dist_id}")
    record(
        "Unilever mfg → GET Flour distributor returns 403",
        r.status_code == 403,
        f"status={r.status_code} body={(r.text or '')[:80]}",
    )

    # The reverse direction.
    uni_dist_id = next(
        o["id"] for o in uni_subtree.values()
        if o["organization_type"] == "distributor"
    )
    flour_mfg_tok = login(*FLOUR_USERS["manufacturer"])
    r = get(flour_mfg_tok, f"/organizations/{uni_dist_id}")
    record(
        "Flour mfg → GET Unilever distributor returns 403",
        r.status_code == 403,
        f"status={r.status_code} body={(r.text or '')[:80]}",
    )

    # ---- 7. Descendant query for Flour root (super admin lens) -------------
    sa_tok = login(*UNILEVER_USERS["super_admin"])
    flour_root_id = next(o["id"] for o in flour_subtree.values()
                         if o["organization_type"] == "manufacturer")
    hierarchy = get(sa_tok, f"/organizations/{flour_root_id}/hierarchy").json()
    h_visited = set()
    walk(hierarchy, h_visited)
    record(
        "Super-admin descendant query on Flour root == 9 nodes",
        len(h_visited) == 9 and h_visited == flour_ids,
        f"size={len(h_visited)}",
    )

    # ---- 8. Super-admin lens on Unilever root still works ------------------
    uni_root_id = next(o["id"] for o in uni_subtree.values()
                       if o["organization_type"] == "manufacturer")
    uni_h = get(sa_tok, f"/organizations/{uni_root_id}/hierarchy").json()
    uh = set()
    walk(uni_h, uh)
    record(
        "Super-admin descendant query on Unilever root still works",
        uh == uni_ids,
        f"size={len(uh)} expected={len(uni_ids)}",
    )

    # ---- summary -----------------------------------------------------------
    total = len(results)
    passed = sum(1 for r in results if r["pass"])
    print("\n" + "=" * 50)
    print(f"  RESULTS: {passed}/{total} PASSED")
    print("=" * 50)

    # Write report
    report_path = Path("/app/memory/MULTI_TENANT_VALIDATION_REPORT.md")
    lines: List[str] = []
    lines.append("# Multi-Tenant Isolation — Validation Report")
    lines.append("")
    lines.append(f"_Date: 2026-06-08 · Result: **{passed}/{total} PASSED**_")
    lines.append("")
    lines.append("## Tenants")
    lines.append("")
    lines.append("| Tenant | Root org code | Orgs in subtree |")
    lines.append("|---|---|---:|")
    lines.append(f"| Unilever | (legacy) | {len(uni_ids)} |")
    lines.append(f"| Flour Mills Nigeria | MFR-0002 | {len(flour_ids)} |")
    lines.append("")
    lines.append("## Flour Mills network (verified hierarchy)")
    lines.append("")
    lines.append("```")
    def dump(n: Dict, depth: int = 0):
        lines.append(f"{'  ' * depth}{n['organization_type']:<14} {n.get('organization_code','--'):<8} {n['organization_name']}")
        for c in n.get("children") or []:
            dump(c, depth + 1)
    dump(network)
    lines.append("```")
    lines.append("")
    lines.append("## Test accounts (Flour Mills tenant)")
    lines.append("")
    lines.append("| Email | Role | Org tier |")
    lines.append("|---|---|---|")
    for role, (email, _) in FLOUR_USERS.items():
        lines.append(f"| `{email}` | `{role}` | {role} |")
    lines.append("")
    lines.append("Password (all accounts): `FlourMills2026!`")
    lines.append("")
    lines.append("## Test matrix")
    lines.append("")
    lines.append("| # | Test | Result | Detail |")
    lines.append("|---:|---|:---:|---|")
    for i, r in enumerate(results, 1):
        emoji = "✅" if r["pass"] else "❌"
        lines.append(f"| {i} | {r['test']} | {emoji} | {r['detail']} |")
    lines.append("")
    lines.append(f"## Result: {passed}/{total} PASSED")
    lines.append("")
    if passed != total:
        lines.append("### Failures")
        for r in results:
            if not r["pass"]:
                lines.append(f"- **{r['test']}** — {r['detail']}")
        lines.append("")
    else:
        lines.append("All multi-tenant isolation invariants verified — Flour Mills "
                     "and Unilever subtrees are fully isolated and respect the "
                     "hierarchy / permission rules defined in `ORG_CHILDREN_ALLOWED`.")
    report_path.write_text("\n".join(lines))
    print(f"\nReport written to: {report_path}")

    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
