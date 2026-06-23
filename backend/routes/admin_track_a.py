"""Track A admin / smoke-test endpoints.

These are NOT meant for the end-user UI — they're operator utilities for
the QA / mobile-app validation team. Auth: requires ``super_admin`` OR the
``manufacturer`` admin role (so only the dispatching tenant can mint test
data inside its own fleet).

Routes
------
* ``POST /api/_admin/seed-track-a-shipment``
    Mints a fresh ``ready_for_dispatch`` shipment for the canonical Track A
    test driver (``DRV-W0-11542``) and starter vehicle (``LAG-W0-001``).
    Picks the first available distributor in the manufacturer's network as
    the destination and 3 realistic product lines from the catalogue.
    Returns the new shipment doc — the dispatcher can immediately call
    ``POST /api/shipments/{id}/assign`` with the seeded driver + vehicle to
    kick off the 8-state replay.

The endpoint is intentionally NOT idempotent — every call produces a new
shipment so the team can run repeated dry-runs without un-sticking state.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException

from core import db, new_id, now_iso
from models import Shipment, ShipmentLine
from services.auth import get_current_user as require_auth
from services.seed_test_driver import (
    TEST_DRIVER_CODE,
    TEST_VEHICLE_REGISTRATION,
)

router = APIRouter()


DEFAULT_LINES = [
    {"sku": "UL-OMO-DETERGENT",   "name": "Omo Detergent 1kg",        "quantity": 120},
    {"sku": "UL-CLOSEUP-TOOTHP",  "name": "Close-Up Toothpaste 100ml", "quantity": 240},
    {"sku": "UL-LIPTON-TEA",      "name": "Lipton Yellow Label 100s",  "quantity": 60},
]


async def _pick_destination(
    manufacturer_id: str,
    explicit_distributor_id: Optional[str],
) -> Dict[str, Any]:
    if explicit_distributor_id:
        dist = await db.distributors.find_one(
            {"id": explicit_distributor_id, "manufacturer_id": manufacturer_id},
            {"_id": 0},
        )
        if not dist:
            raise HTTPException(
                404,
                f"Distributor {explicit_distributor_id} not in this manufacturer's network",
            )
        return dist

    # Prefer Abuja → Lagos → first available
    for region_re in ("abuja|fct", "lagos"):
        dist = await db.distributors.find_one(
            {"manufacturer_id": manufacturer_id,
             "region": {"$regex": region_re, "$options": "i"}},
            {"_id": 0},
        )
        if dist:
            return dist
    dist = await db.distributors.find_one(
        {"manufacturer_id": manufacturer_id}, {"_id": 0},
    )
    if not dist:
        raise HTTPException(
            422,
            "No distributors in this manufacturer's network — cannot mint shipment",
        )
    return dist


async def _resolve_lines(
    manufacturer_id: str,
    overrides: Optional[List[Dict[str, Any]]],
) -> List[ShipmentLine]:
    """Resolve product references to full ShipmentLine docs.

    Each spec is ``{"sku"?: str, "product_id"?: str, "quantity": int}``.
    Falls back to DEFAULT_LINES if nothing supplied.
    """
    specs = overrides or DEFAULT_LINES
    out: List[ShipmentLine] = []
    for spec in specs:
        qty = int(spec.get("quantity") or 0)
        if qty <= 0:
            continue
        q: Dict[str, Any] = {"manufacturer_id": manufacturer_id}
        if spec.get("product_id"):
            q["id"] = spec["product_id"]
        elif spec.get("sku"):
            q["sku"] = spec["sku"]
        elif spec.get("name"):
            q["name"] = spec["name"]
        else:
            continue
        product = await db.products.find_one(q, {"_id": 0})
        if not product:
            # Fall back to ANY product if the requested sku is missing in
            # this DB — Track A QA must not be blocked by catalogue drift.
            product = await db.products.find_one(
                {"manufacturer_id": manufacturer_id}, {"_id": 0},
            )
            if not product:
                continue
        unit_price = float(product.get("unit_price") or 0)
        gross = round(unit_price * qty, 2)
        out.append(ShipmentLine(
            product_id=product["id"],
            quantity=qty,
            unit_price=unit_price,
            gross_value=gross,
            discount=0.0,
            net_value=gross,
            product_name=product.get("name"),
            sku=product.get("sku"),
        ))
    if not out:
        raise HTTPException(422, "Could not resolve any product lines")
    return out


@router.post("/_admin/seed-track-a-shipment", response_model=Dict[str, Any])
async def seed_track_a_shipment(
    body: Dict[str, Any] = Body(default_factory=dict),
    user: Dict[str, Any] = Depends(require_auth),
):
    """Mint a fresh ready_for_dispatch shipment wired to the Track A driver.

    Body (all optional):
    ::

        {
          "to_distributor_id": "<distributor uuid>",   # explicit destination
          "items": [
            {"sku": "UL-KNORR-CUBES", "quantity": 100},
            {"product_id": "<uuid>",  "quantity": 24}
          ],
          "notes": "Free-text shown in dispatch UI"
        }
    """
    role = user.get("role")
    if role not in ("super_admin", "manufacturer"):
        raise HTTPException(
            403,
            "Track A shipment seed is restricted to super_admin or manufacturer roles",
        )

    # ---- 1. Find the test driver -------------------------------------
    drv = await db.drivers.find_one(
        {"employee_number": TEST_DRIVER_CODE},
        {"_id": 0},
    )
    if not drv:
        raise HTTPException(
            404,
            f"Test driver {TEST_DRIVER_CODE} not found — run "
            f"`POST /api/_admin/seed-test-driver` or restart the backend first",
        )
    manufacturer_id = drv["employer_org_id"]

    # Manufacturer admins can only seed inside their own fleet.
    if role == "manufacturer" and user.get("entity_id") != manufacturer_id:
        raise HTTPException(
            403,
            "You are not the test driver's employer; super_admin required",
        )

    # ---- 2. Verify starter vehicle exists ----------------------------
    veh = await db.vehicles.find_one(
        {"owner_org_id": manufacturer_id,
         "registration_number": TEST_VEHICLE_REGISTRATION},
        {"_id": 0},
    )
    if not veh:
        raise HTTPException(
            422,
            f"Starter vehicle {TEST_VEHICLE_REGISTRATION} is missing — run the test-driver seed first",
        )

    # ---- 3. Destination ----------------------------------------------
    dist = await _pick_destination(manufacturer_id, body.get("to_distributor_id"))

    # ---- 4. Line items -----------------------------------------------
    items = await _resolve_lines(manufacturer_id, body.get("items"))
    total_units = sum(int(it.quantity) for it in items)
    total_value = round(sum(float(it.net_value or 0) for it in items), 2)

    # ---- 5. Build the shipment ---------------------------------------
    now = now_iso()
    shp = Shipment(
        from_role="manufacturer",
        from_id=manufacturer_id,
        to_role="distributor",
        to_id=dist["id"],
        items=items,
        notes=body.get("notes") or "Track A end-to-end test shipment",
        owner_org_id=manufacturer_id,
        owner_org_type="manufacturer",
        total_units=total_units,
        total_value=total_value,
        manufacturer_id=manufacturer_id,
        distributor_id=dist["id"],
        source="manual",
        status="ready_for_dispatch",
    )
    doc = shp.dict()
    doc["status_history"] = [
        {
            "from_status": None, "to_status": "created", "at": now,
            "by_user_id": user.get("id"), "by_role": role,
            "notes": "Seeded via /_admin/seed-track-a-shipment",
        },
        {
            "from_status": "created", "to_status": "ready_for_dispatch", "at": now,
            "by_user_id": user.get("id"), "by_role": role,
            "notes": "Auto-advanced to ready_for_dispatch (Track A seed)",
        },
    ]
    doc["schema_version"] = 2

    await db.shipments.insert_one(doc)

    # Audit-log entries in the immutable history collection too.
    base = {
        "shipment_id": shp.id, "owner_org_id": manufacturer_id,
        "by_user_id": user.get("id"), "by_role": role, "created_at": now,
    }
    await db.shipment_status_history.insert_many([
        {**base, "id": new_id(),
         "from_status": None, "to_status": "created", "at": now},
        {**base, "id": new_id(),
         "from_status": "created", "to_status": "ready_for_dispatch", "at": now},
    ])

    doc.pop("_id", None)
    doc.pop("delivery_code", None)
    return {
        "shipment": doc,
        "next_steps": {
            "assign": (
                f"POST /api/shipments/{shp.id}/assign "
                f"with body {{\"driver_id\": \"{drv['id']}\", "
                f"\"vehicle_id\": \"{veh['id']}\"}}"
            ),
            "driver_id": drv["id"],
            "driver_code": drv.get("employee_number"),
            "vehicle_id": veh["id"],
            "vehicle_code": veh.get("vehicle_code"),
            "destination": {
                "distributor_id": dist["id"],
                "name": dist.get("name"),
                "region": dist.get("region"),
            },
        },
    }



@router.get("/_admin/distributor-driver-logins", response_model=Dict[str, Any])
async def list_distributor_driver_logins(
    user: Dict[str, Any] = Depends(require_auth),
) -> Dict[str, Any]:
    """Return one driver login per distributor for mobile-app QA.

    Restricted to ``super_admin`` and ``manufacturer`` roles. Lists the
    email + ``employee_number`` of the driver claimed by
    ``seed_distributor_driver_logins.py``. Password is the shared
    ``DEMO_PASSWORD`` env value — same one used by every demo account in
    /app/memory/test_credentials.md.
    """
    role = user.get("role")
    if role not in ("super_admin", "manufacturer"):
        raise HTTPException(status_code=403, detail="forbidden")

    rows: List[Dict[str, Any]] = []
    async for d in db.distributors.find(
        {}, {"_id": 0, "id": 1, "name": 1, "manufacturer_id": 1},
    ).sort("name", 1):
        email = f"driver-{d['id'][:8]}@tradekonekt.io"
        u = await db.users.find_one(
            {"email": email, "role": "driver"},
            {"_id": 0, "id": 1, "entity_id": 1, "status": 1},
        )
        if not u:
            rows.append({
                "distributor": d.get("name"),
                "distributor_id": d["id"],
                "email": email,
                "status": "missing",
            })
            continue
        drv = await db.drivers.find_one(
            {"id": u.get("entity_id")},
            {"_id": 0, "employee_number": 1, "full_name": 1,
             "assigned_shipment_id": 1, "status": 1},
        ) or {}
        rows.append({
            "distributor": d.get("name"),
            "distributor_id": d["id"],
            "email": email,
            "driver_id": u.get("entity_id"),
            "driver_code": drv.get("employee_number"),
            "driver_name": drv.get("full_name"),
            "driver_status": drv.get("status"),
            "assigned_shipment_id": drv.get("assigned_shipment_id"),
            "user_status": u.get("status"),
            "status": "ok",
        })
    return {"rows": rows, "total": len(rows),
            "password_hint": "Shared DEMO_PASSWORD env (same as other demo accounts)."}
