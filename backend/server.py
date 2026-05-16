from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import io
import csv
import logging
import uuid
import random
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Literal, Dict, Any, Tuple
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
DATA_DIR = ROOT_DIR / "data"
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="Supply Chain Hub API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def clean(doc: dict) -> dict:
    if not doc:
        return doc
    d = dict(doc)
    d.pop("_id", None)
    return d


ShipmentStatus = Literal["pending", "in_transit", "received"]
RequestStatus = Literal["pending", "approved", "rejected", "fulfilled"]
PartyRole = Literal["manufacturer", "distributor", "retailer"]


# ----------------------------- Models ----------------------------------------
class Manufacturer(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    name: str
    headquarters: str = "Global"
    contact_email: str = ""
    created_at: str = Field(default_factory=now_iso)


class Distributor(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    name: str
    region: str
    city: str = ""
    contact_email: str = ""
    manufacturer_id: str = ""
    created_at: str = Field(default_factory=now_iso)


class Retailer(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    name: str
    region: str
    city: str = ""
    address: str = ""
    contact_email: str = ""
    distributor_id: str
    created_at: str = Field(default_factory=now_iso)


class Product(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    sku: str
    name: str
    category: str
    unit_price: float
    barcode: str = ""
    manufacturer_id: str = ""


class InventoryItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    owner_type: PartyRole
    owner_id: str
    product_id: str
    quantity: int
    reorder_level: int = 10
    updated_at: str = Field(default_factory=now_iso)


class ShipmentLine(BaseModel):
    product_id: str
    quantity: int


class Shipment(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    # Generic source/destination
    from_role: PartyRole
    from_id: str
    to_role: PartyRole
    to_id: str
    # Denormalized convenience fields for back-compat with existing UI/queries:
    distributor_id: str = ""   # set if a distributor is involved
    retailer_id: str = ""      # set if a retailer is involved
    manufacturer_id: str = ""  # set if a manufacturer is involved
    items: List[ShipmentLine]
    status: ShipmentStatus = "pending"
    tracking_code: str = Field(default_factory=lambda: "SHP-" + uuid.uuid4().hex[:8].upper())
    notes: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    dispatched_at: Optional[str] = None
    received_at: Optional[str] = None
    request_id: Optional[str] = None


class ShipmentCreate(BaseModel):
    from_role: PartyRole
    from_id: str
    to_role: PartyRole
    to_id: str
    items: List[ShipmentLine]
    notes: Optional[str] = None


class ShipmentStatusUpdate(BaseModel):
    status: ShipmentStatus


class RequestLine(BaseModel):
    product_id: str
    quantity: int


class StockRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    retailer_id: str
    distributor_id: str
    items: List[RequestLine]
    status: RequestStatus = "pending"
    note: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    resolved_at: Optional[str] = None


class RequestCreate(BaseModel):
    retailer_id: str
    distributor_id: str
    items: List[RequestLine]
    note: Optional[str] = None


class RequestDecision(BaseModel):
    action: Literal["approve", "reject"]


class Notification(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    target_type: PartyRole
    target_id: str
    title: str
    message: str
    type: Literal["shipment", "request", "inventory", "system"] = "system"
    read: bool = False
    created_at: str = Field(default_factory=now_iso)


# ----------------------------- helpers ---------------------------------------
async def push_notification(target_type: str, target_id: str, title: str, message: str, ntype: str = "system"):
    n = Notification(target_type=target_type, target_id=target_id, title=title, message=message, type=ntype)
    await db.notifications.insert_one(n.model_dump())


def _denorm_ids(from_role: str, from_id: str, to_role: str, to_id: str) -> Dict[str, str]:
    """Map generic from/to to legacy denormalized fields."""
    out = {"manufacturer_id": "", "distributor_id": "", "retailer_id": ""}
    out[f"{from_role}_id"] = from_id
    out[f"{to_role}_id"] = to_id
    return out


async def _adjust_inventory(owner_type: str, owner_id: str, product_id: str, delta: int) -> Tuple[int, int]:
    existing = await db.inventory.find_one({"owner_type": owner_type, "owner_id": owner_id, "product_id": product_id})
    if existing:
        new_qty = max(0, int(existing.get("quantity", 0)) + delta)
        await db.inventory.update_one(
            {"id": existing["id"]},
            {"$set": {"quantity": new_qty, "updated_at": now_iso()}},
        )
        return new_qty, int(existing.get("reorder_level", 10))
    item = InventoryItem(
        owner_type=owner_type, owner_id=owner_id, product_id=product_id,
        quantity=max(0, delta),
    )
    await db.inventory.insert_one(item.model_dump())
    return item.quantity, item.reorder_level


async def _entity_name(role: str, eid: str) -> str:
    coll = {"manufacturer": "manufacturers", "distributor": "distributors", "retailer": "retailers"}.get(role)
    if not coll:
        return eid
    doc = await db[coll].find_one({"id": eid}, {"_id": 0, "name": 1})
    return (doc or {}).get("name", eid)


# ----------------------------- Routes ----------------------------------------
@api_router.get("/")
async def root():
    return {"message": "Supply Chain Hub API", "status": "ok"}


# ---- Entities -----
@api_router.get("/manufacturers", response_model=List[Manufacturer])
async def list_manufacturers():
    return await db.manufacturers.find({}, {"_id": 0}).to_list(100)


@api_router.get("/distributors", response_model=List[Distributor])
async def list_distributors(manufacturer_id: Optional[str] = None):
    q = {"manufacturer_id": manufacturer_id} if manufacturer_id else {}
    return await db.distributors.find(q, {"_id": 0}).sort("name", 1).to_list(2000)


@api_router.get("/retailers", response_model=List[Retailer])
async def list_retailers(distributor_id: Optional[str] = None):
    q = {"distributor_id": distributor_id} if distributor_id else {}
    return await db.retailers.find(q, {"_id": 0}).sort("name", 1).to_list(2000)


@api_router.get("/products", response_model=List[Product])
async def list_products(manufacturer_id: Optional[str] = None):
    q = {"manufacturer_id": manufacturer_id} if manufacturer_id else {}
    return await db.products.find(q, {"_id": 0}).sort("name", 1).to_list(2000)


# ---- Inventory ----
@api_router.get("/inventory")
async def get_inventory(owner_type: str, owner_id: str):
    items = await db.inventory.find({"owner_type": owner_type, "owner_id": owner_id}, {"_id": 0}).to_list(5000)
    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(5000)}
    for it in items:
        it["product"] = products.get(it["product_id"], {})
    # sort by product name
    items.sort(key=lambda x: (x.get("product", {}).get("name") or "").lower())
    return items


# ---- Shipments ----
@api_router.get("/shipments")
async def list_shipments(
    distributor_id: Optional[str] = None,
    retailer_id: Optional[str] = None,
    manufacturer_id: Optional[str] = None,
    party_role: Optional[str] = None,
    party_id: Optional[str] = None,
):
    q: Dict[str, Any] = {}
    if distributor_id:
        q["distributor_id"] = distributor_id
    if retailer_id:
        q["retailer_id"] = retailer_id
    if manufacturer_id:
        q["manufacturer_id"] = manufacturer_id
    if party_role and party_id:
        # filter shipments where this entity is either source or destination
        q["$or"] = [
            {"from_role": party_role, "from_id": party_id},
            {"to_role": party_role, "to_id": party_id},
        ]
    docs = await db.shipments.find(q, {"_id": 0}).sort("created_at", -1).to_list(5000)
    manufacturers = {m["id"]: m for m in await db.manufacturers.find({}, {"_id": 0}).to_list(100)}
    distributors = {d["id"]: d for d in await db.distributors.find({}, {"_id": 0}).to_list(5000)}
    retailers = {r["id"]: r for r in await db.retailers.find({}, {"_id": 0}).to_list(5000)}
    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(5000)}
    party_map = {"manufacturer": manufacturers, "distributor": distributors, "retailer": retailers}
    for s in docs:
        s["from_party"] = party_map.get(s.get("from_role", ""), {}).get(s.get("from_id", ""), {})
        s["to_party"] = party_map.get(s.get("to_role", ""), {}).get(s.get("to_id", ""), {})
        # back-compat fields used by existing UI
        s["distributor"] = distributors.get(s.get("distributor_id", ""), {})
        s["retailer"] = retailers.get(s.get("retailer_id", ""), {})
        for it in s.get("items", []):
            it["product"] = products.get(it["product_id"], {})
    return docs


@api_router.post("/shipments", response_model=Shipment)
async def create_shipment(payload: ShipmentCreate):
    denorm = _denorm_ids(payload.from_role, payload.from_id, payload.to_role, payload.to_id)
    sh = Shipment(
        from_role=payload.from_role, from_id=payload.from_id,
        to_role=payload.to_role, to_id=payload.to_id,
        items=payload.items, notes=payload.notes,
        **denorm,
    )
    await db.shipments.insert_one(sh.model_dump())
    sender_name = await _entity_name(payload.from_role, payload.from_id)
    await push_notification(
        payload.to_role, payload.to_id,
        "New Shipment Created",
        f"Shipment {sh.tracking_code} from {sender_name} is pending dispatch.",
        "shipment",
    )
    return sh


@api_router.patch("/shipments/{shipment_id}/status")
async def update_shipment_status(shipment_id: str, payload: ShipmentStatusUpdate):
    sh = await db.shipments.find_one({"id": shipment_id})
    if not sh:
        raise HTTPException(404, "Shipment not found")
    current = sh["status"]
    target = payload.status
    valid = {"pending": ["in_transit"], "in_transit": ["received"]}
    if target not in valid.get(current, []):
        raise HTTPException(400, f"Cannot transition from {current} to {target}")

    update: Dict[str, Any] = {"status": target}
    from_role = sh.get("from_role", "distributor")
    from_id = sh.get("from_id", sh.get("distributor_id", ""))
    to_role = sh.get("to_role", "retailer")
    to_id = sh.get("to_id", sh.get("retailer_id", ""))

    if target == "in_transit":
        update["dispatched_at"] = now_iso()
        for it in sh.get("items", []):
            await _adjust_inventory(from_role, from_id, it["product_id"], -int(it["quantity"]))
        await push_notification(
            to_role, to_id,
            "Shipment In Transit",
            f"Shipment {sh['tracking_code']} has been dispatched.",
            "shipment",
        )
    elif target == "received":
        update["received_at"] = now_iso()
        for it in sh.get("items", []):
            await _adjust_inventory(to_role, to_id, it["product_id"], int(it["quantity"]))
        await push_notification(
            from_role, from_id,
            "Shipment Received",
            f"Receipt confirmed for shipment {sh['tracking_code']}.",
            "shipment",
        )
        if sh.get("request_id"):
            await db.requests.update_one(
                {"id": sh["request_id"]},
                {"$set": {"status": "fulfilled", "resolved_at": now_iso()}},
            )

    await db.shipments.update_one({"id": shipment_id}, {"$set": update})
    return clean(await db.shipments.find_one({"id": shipment_id}, {"_id": 0}))


# ---- Requests (Retailer ↔ Distributor) ----
@api_router.get("/requests")
async def list_requests(distributor_id: Optional[str] = None, retailer_id: Optional[str] = None):
    q: Dict[str, Any] = {}
    if distributor_id:
        q["distributor_id"] = distributor_id
    if retailer_id:
        q["retailer_id"] = retailer_id
    docs = await db.requests.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    distributors = {d["id"]: d for d in await db.distributors.find({}, {"_id": 0}).to_list(5000)}
    retailers = {r["id"]: r for r in await db.retailers.find({}, {"_id": 0}).to_list(5000)}
    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(5000)}
    for r in docs:
        r["distributor"] = distributors.get(r["distributor_id"], {})
        r["retailer"] = retailers.get(r["retailer_id"], {})
        for it in r.get("items", []):
            it["product"] = products.get(it["product_id"], {})
    return docs


@api_router.post("/requests", response_model=StockRequest)
async def create_request(payload: RequestCreate):
    req = StockRequest(**payload.model_dump())
    await db.requests.insert_one(req.model_dump())
    await push_notification(
        "distributor", req.distributor_id,
        "New Stock Request",
        f"Retailer submitted a new stock request ({len(req.items)} item(s)).",
        "request",
    )
    return req


@api_router.patch("/requests/{request_id}")
async def decide_request(request_id: str, payload: RequestDecision):
    req = await db.requests.find_one({"id": request_id})
    if not req:
        raise HTTPException(404, "Request not found")
    if req["status"] != "pending":
        raise HTTPException(400, "Request already resolved")

    if payload.action == "reject":
        await db.requests.update_one(
            {"id": request_id},
            {"$set": {"status": "rejected", "resolved_at": now_iso()}},
        )
        await push_notification(
            "retailer", req["retailer_id"], "Request Rejected",
            "Your stock request was rejected by the distributor.", "request",
        )
        return {"ok": True, "status": "rejected"}

    # approve -> create shipment distributor → retailer
    denorm = _denorm_ids("distributor", req["distributor_id"], "retailer", req["retailer_id"])
    sh = Shipment(
        from_role="distributor", from_id=req["distributor_id"],
        to_role="retailer", to_id=req["retailer_id"],
        items=[ShipmentLine(**it) for it in req["items"]],
        request_id=req["id"],
        notes=f"Auto-created from request {req['id'][:8]}",
        **denorm,
    )
    await db.shipments.insert_one(sh.model_dump())
    await db.requests.update_one(
        {"id": request_id},
        {"$set": {"status": "approved", "resolved_at": now_iso()}},
    )
    await push_notification(
        "retailer", req["retailer_id"], "Request Approved",
        f"Your request was approved. Shipment {sh.tracking_code} is now pending dispatch.",
        "request",
    )
    return {"ok": True, "status": "approved", "shipment_id": sh.id, "tracking_code": sh.tracking_code}


# ---- Notifications ----
@api_router.get("/notifications")
async def list_notifications(target_type: str, target_id: str):
    return await db.notifications.find(
        {"target_type": target_type, "target_id": target_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)


@api_router.patch("/notifications/{notif_id}/read")
async def mark_notification_read(notif_id: str):
    res = await db.notifications.update_one({"id": notif_id}, {"$set": {"read": True}})
    if res.matched_count == 0:
        raise HTTPException(404, "Notification not found")
    return {"ok": True}


@api_router.patch("/notifications/read-all")
async def mark_all_read(target_type: str, target_id: str):
    await db.notifications.update_many(
        {"target_type": target_type, "target_id": target_id, "read": False},
        {"$set": {"read": True}},
    )
    return {"ok": True}


# ---- Analytics ----
@api_router.get("/analytics")
async def analytics(role: str, entity_id: str):
    if role not in ("manufacturer", "distributor", "retailer"):
        raise HTTPException(400, "Invalid role")

    if role == "manufacturer":
        q = {"manufacturer_id": entity_id}
    elif role == "distributor":
        q = {"distributor_id": entity_id}
    else:
        q = {"retailer_id": entity_id}

    shipments = await db.shipments.find(q, {"_id": 0}).to_list(5000)
    # only retailer/distributor have requests
    if role in ("distributor", "retailer"):
        rq = {"distributor_id": entity_id} if role == "distributor" else {"retailer_id": entity_id}
        requests_docs = await db.requests.find(rq, {"_id": 0}).to_list(5000)
    else:
        requests_docs = []

    kpis = {
        "total_shipments": len(shipments),
        "pending": sum(1 for s in shipments if s["status"] == "pending"),
        "in_transit": sum(1 for s in shipments if s["status"] == "in_transit"),
        "received": sum(1 for s in shipments if s["status"] == "received"),
        "open_requests": sum(1 for r in requests_docs if r["status"] == "pending"),
    }

    status_breakdown = [
        {"name": "Pending", "value": kpis["pending"]},
        {"name": "In Transit", "value": kpis["in_transit"]},
        {"name": "Received", "value": kpis["received"]},
    ]

    today = datetime.now(timezone.utc).date()
    buckets = {(today - timedelta(days=i)).isoformat(): 0 for i in range(13, -1, -1)}
    for s in shipments:
        try:
            d = datetime.fromisoformat(s["created_at"]).date().isoformat()
            if d in buckets:
                buckets[d] += 1
        except Exception:
            pass
    timeline = [{"date": k[5:], "shipments": v} for k, v in buckets.items()]

    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(5000)}
    product_volume: Dict[str, int] = {}
    for s in shipments:
        for it in s.get("items", []):
            product_volume[it["product_id"]] = product_volume.get(it["product_id"], 0) + int(it["quantity"])
    top_products = sorted(
        [{"name": (products.get(pid, {}).get("name", pid) or pid)[:30], "units": v}
         for pid, v in product_volume.items()],
        key=lambda x: -x["units"],
    )[:6]

    inv = await db.inventory.find({"owner_type": role, "owner_id": entity_id}, {"_id": 0}).to_list(5000)
    inventory_total = sum(int(i.get("quantity", 0)) for i in inv)
    low_stock = sum(1 for i in inv if int(i.get("quantity", 0)) <= int(i.get("reorder_level", 10)))

    extra: Dict[str, Any] = {}
    if role == "manufacturer":
        extra["distributors_count"] = await db.distributors.count_documents({"manufacturer_id": entity_id})
        extra["retailers_count"] = await db.retailers.count_documents({})
    elif role == "distributor":
        extra["retailers_count"] = await db.retailers.count_documents({"distributor_id": entity_id})

    return {
        "kpis": {**kpis, "inventory_total": inventory_total, "low_stock": low_stock, **extra},
        "status_breakdown": status_breakdown,
        "timeline": timeline,
        "top_products": top_products,
    }


# ---- Reports ----
@api_router.get("/reports/shipments.csv")
async def export_shipments_csv(role: str, entity_id: str):
    if role == "manufacturer":
        q = {"manufacturer_id": entity_id}
    elif role == "distributor":
        q = {"distributor_id": entity_id}
    else:
        q = {"retailer_id": entity_id}

    shipments = await db.shipments.find(q, {"_id": 0}).sort("created_at", -1).to_list(5000)
    manufacturers = {m["id"]: m for m in await db.manufacturers.find({}, {"_id": 0}).to_list(100)}
    distributors = {d["id"]: d for d in await db.distributors.find({}, {"_id": 0}).to_list(5000)}
    retailers = {r["id"]: r for r in await db.retailers.find({}, {"_id": 0}).to_list(5000)}
    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(5000)}
    party_map = {"manufacturer": manufacturers, "distributor": distributors, "retailer": retailers}

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "Tracking Code", "Status", "From", "To",
        "Products", "Total Units", "Created", "Dispatched", "Received",
    ])
    for s in shipments:
        prods = "; ".join(
            f"{products.get(it['product_id'], {}).get('name', it['product_id'])} x{it['quantity']}"
            for it in s.get("items", [])
        )
        total = sum(int(it["quantity"]) for it in s.get("items", []))
        frm = party_map.get(s.get("from_role", ""), {}).get(s.get("from_id", ""), {}).get("name", "")
        to_ = party_map.get(s.get("to_role", ""), {}).get(s.get("to_id", ""), {}).get("name", "")
        writer.writerow([
            s.get("tracking_code", ""), s.get("status", ""), frm, to_,
            prods, total,
            s.get("created_at", ""), s.get("dispatched_at") or "", s.get("received_at") or "",
        ])
    buf.seek(0)
    headers = {"Content-Disposition": f"attachment; filename=shipments_{role}_{entity_id[:8]}.csv"}
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers=headers)


@api_router.get("/reports/inventory.csv")
async def export_inventory_csv(role: str, entity_id: str):
    inv = await db.inventory.find({"owner_type": role, "owner_id": entity_id}, {"_id": 0}).to_list(5000)
    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(5000)}
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["SKU", "Product", "Category", "Barcode", "Quantity", "Reorder Level", "Updated"])
    for it in inv:
        p = products.get(it["product_id"], {})
        writer.writerow([
            p.get("sku", ""), p.get("name", ""), p.get("category", ""), p.get("barcode", ""),
            it.get("quantity", 0), it.get("reorder_level", 10), it.get("updated_at", ""),
        ])
    buf.seek(0)
    headers = {"Content-Disposition": f"attachment; filename=inventory_{role}_{entity_id[:8]}.csv"}
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers=headers)


# ----------------------------- Seed from CSVs --------------------------------
PRODUCT_COL_MAP = {
    # CSV column → canonical product name (matches products.csv)
    "Blue Band Margarine": "Blue Band Margarine",
    "Lipton Yellow Label Tea": "Lipton Yellow Label Tea",
    "Royco Bouillon Cubes": "Royco Bouillon Cubes",
    "Knorr Bouillon Cubes": "Knorr Bouillon Cubes",
    "OMO Detergent": "OMO Multi-Active Detergent",
    "Sunlight Washing Powder": "Sunlight Washing Powder",
    "Sunlight Dishwashing Liquid": "Sunlight Dishwashing Liquid",
    "Close-Up Toothpaste": "Close-Up Toothpaste",
    "Pepsodent Toothpaste": "Pepsodent Toothpaste",
    "Lux Soap": "LUX Beauty Soap",
    "Lifebuoy Soap": "Lifebuoy Soap",
    "Rexona": "Rexona Deodorant",
    "Pears": "Pears Baby Products",
    "Vaseline": "Vaseline Lotion & Jelly",
    "Axe Body Spray": "Axe Body Spray",
}

PRODUCT_CATEGORY = {
    "Blue Band Margarine": "Food",
    "Lipton Yellow Label Tea": "Beverages",
    "Royco Bouillon Cubes": "Food",
    "Knorr Bouillon Cubes": "Food",
    "OMO Multi-Active Detergent": "Home Care",
    "Sunlight Washing Powder": "Home Care",
    "Sunlight Dishwashing Liquid": "Home Care",
    "Close-Up Toothpaste": "Personal Care",
    "Pepsodent Toothpaste": "Personal Care",
    "LUX Beauty Soap": "Personal Care",
    "Lifebuoy Soap": "Personal Care",
    "Rexona Deodorant": "Personal Care",
    "Pears Baby Products": "Personal Care",
    "Vaseline Lotion & Jelly": "Personal Care",
    "Axe Body Spray": "Personal Care",
}

PRODUCT_PRICE_NGN = {
    "Blue Band Margarine": 2200,
    "Lipton Yellow Label Tea": 3500,
    "Royco Bouillon Cubes": 800,
    "Knorr Bouillon Cubes": 850,
    "OMO Multi-Active Detergent": 4200,
    "Sunlight Washing Powder": 3800,
    "Sunlight Dishwashing Liquid": 1500,
    "Close-Up Toothpaste": 1800,
    "Pepsodent Toothpaste": 1700,
    "LUX Beauty Soap": 950,
    "Lifebuoy Soap": 900,
    "Rexona Deodorant": 3200,
    "Pears Baby Products": 2400,
    "Vaseline Lotion & Jelly": 2100,
    "Axe Body Spray": 4500,
}


def _slug_sku(name: str) -> str:
    base = "".join(c for c in name.upper() if c.isalnum() or c == " ").split()
    return "UL-" + "-".join(base[:3])[:18]


async def _seed_from_csv():
    for c in ["manufacturers", "distributors", "retailers", "products", "inventory", "shipments", "requests", "notifications"]:
        await db[c].delete_many({})

    # 1. Manufacturer
    mfg = Manufacturer(name="Unilever", headquarters="London / Lagos", contact_email="ops@unilever.com")
    await db.manufacturers.insert_one(mfg.model_dump())

    # 2. Products (15 from CSV)
    products_path = DATA_DIR / "products.csv"
    barcodes: Dict[str, str] = {}
    if products_path.exists():
        with products_path.open(encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                name = r["Product"]
                if name and name not in barcodes:
                    barcodes[name] = r.get("Barcode", "")
    product_docs: List[Product] = []
    canonical_names = sorted(set(PRODUCT_COL_MAP.values()))
    name_to_pid: Dict[str, str] = {}
    for name in canonical_names:
        p = Product(
            sku=_slug_sku(name),
            name=name,
            category=PRODUCT_CATEGORY.get(name, "General"),
            unit_price=float(PRODUCT_PRICE_NGN.get(name, 1000)),
            barcode=barcodes.get(name, ""),
            manufacturer_id=mfg.id,
        )
        product_docs.append(p)
        name_to_pid[name] = p.id
    await db.products.insert_many([p.model_dump() for p in product_docs])

    # 3. Distributors + Retailers from CSV
    dist_path = DATA_DIR / "distributors.csv"
    distributor_docs: Dict[str, Distributor] = {}
    retailer_rows: List[dict] = []
    if dist_path.exists():
        with dist_path.open(encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                dname = (r.get("Distributor") or "").strip()
                rname = (r.get("Retailer") or "").strip()
                if not dname:
                    continue
                if dname not in distributor_docs:
                    distributor_docs[dname] = Distributor(
                        name=dname,
                        region=(r.get("Region") or "").strip() or "—",
                        city=(r.get("City") or "").strip(),
                        contact_email="",
                        manufacturer_id=mfg.id,
                    )
                if rname:
                    retailer_rows.append(r)

    distributor_list = list(distributor_docs.values())
    await db.distributors.insert_many([d.model_dump() for d in distributor_list])
    dist_by_name = {d.name: d for d in distributor_list}

    retailer_docs: List[Retailer] = []
    retailer_rows_by_id: Dict[str, dict] = {}
    for r in retailer_rows:
        dname = r["Distributor"].strip()
        rname = r["Retailer"].strip()
        d = dist_by_name.get(dname)
        if not d:
            continue
        ret = Retailer(
            name=rname,
            region=(r.get("Region") or "").strip() or "—",
            city=(r.get("City") or "").strip(),
            address=(r.get("Address") or "").strip(),
            contact_email="",
            distributor_id=d.id,
        )
        retailer_docs.append(ret)
        retailer_rows_by_id[ret.id] = r
    await db.retailers.insert_many([r.model_dump() for r in retailer_docs])

    # 4. Inventory
    rng = random.Random(42)
    inv_docs = []

    # Manufacturer inventory — large stock of every product
    for p in product_docs:
        inv_docs.append(InventoryItem(
            owner_type="manufacturer", owner_id=mfg.id, product_id=p.id,
            quantity=5000 + rng.randint(0, 5000), reorder_level=1000,
        ).model_dump())

    # Distributor inventory — aggregate of all retailer columns for that distributor
    for d in distributor_list:
        for col, prod_name in PRODUCT_COL_MAP.items():
            pid = name_to_pid[prod_name]
            inv_docs.append(InventoryItem(
                owner_type="distributor", owner_id=d.id, product_id=pid,
                quantity=400 + rng.randint(0, 600),
                reorder_level=100,
            ).model_dump())

    # Retailer inventory — actual quantities from CSV
    for ret in retailer_docs:
        row = retailer_rows_by_id.get(ret.id, {})
        for col, prod_name in PRODUCT_COL_MAP.items():
            try:
                q = int(row.get(col, "0") or 0)
            except ValueError:
                q = 0
            pid = name_to_pid[prod_name]
            inv_docs.append(InventoryItem(
                owner_type="retailer", owner_id=ret.id, product_id=pid,
                quantity=q,
                reorder_level=30,
            ).model_dump())
    if inv_docs:
        await db.inventory.insert_many(inv_docs)

    # 5. Seeded shipments (manufacturer → 3 distributors, distributor → 3 retailers, variety of statuses)
    now = datetime.now(timezone.utc)
    seed_shipments: List[dict] = []
    plan_mfg = [("received", 9), ("in_transit", 4), ("pending", 1),
                ("received", 12), ("in_transit", 2), ("pending", 0)]
    for idx, (status, days_ago) in enumerate(plan_mfg):
        if idx >= len(distributor_list):
            break
        d = distributor_list[idx]
        chosen = product_docs[idx % len(product_docs): idx % len(product_docs) + 2] or [product_docs[0]]
        items = [{"product_id": p.id, "quantity": 100 + idx * 50} for p in chosen]
        seed_shipments.append({
            "id": new_id(),
            "from_role": "manufacturer", "from_id": mfg.id,
            "to_role": "distributor", "to_id": d.id,
            "manufacturer_id": mfg.id, "distributor_id": d.id, "retailer_id": "",
            "items": items, "status": status,
            "tracking_code": "SHP-" + uuid.uuid4().hex[:8].upper(),
            "notes": None,
            "created_at": (now - timedelta(days=days_ago, hours=idx)).isoformat(),
            "dispatched_at": (now - timedelta(days=max(days_ago - 1, 0))).isoformat() if status in ("in_transit", "received") else None,
            "received_at": (now - timedelta(days=max(days_ago - 2, 0))).isoformat() if status == "received" else None,
            "request_id": None,
        })

    # Distributor → Retailer shipments (use first distributor's retailers)
    primary_d = distributor_list[0] if distributor_list else None
    primary_retailers = [r for r in retailer_docs if r.distributor_id == (primary_d.id if primary_d else "")]
    plan_ret = [("received", 8), ("received", 5), ("in_transit", 3), ("in_transit", 1),
                ("pending", 0), ("received", 11)]
    for idx, (status, days_ago) in enumerate(plan_ret):
        if not primary_retailers:
            break
        r = primary_retailers[idx % len(primary_retailers)]
        chosen = product_docs[idx % len(product_docs): idx % len(product_docs) + 2] or [product_docs[0]]
        items = [{"product_id": p.id, "quantity": 15 + idx * 5} for p in chosen]
        seed_shipments.append({
            "id": new_id(),
            "from_role": "distributor", "from_id": primary_d.id,
            "to_role": "retailer", "to_id": r.id,
            "manufacturer_id": "", "distributor_id": primary_d.id, "retailer_id": r.id,
            "items": items, "status": status,
            "tracking_code": "SHP-" + uuid.uuid4().hex[:8].upper(),
            "notes": None,
            "created_at": (now - timedelta(days=days_ago, hours=idx)).isoformat(),
            "dispatched_at": (now - timedelta(days=max(days_ago - 1, 0))).isoformat() if status in ("in_transit", "received") else None,
            "received_at": (now - timedelta(days=max(days_ago - 2, 0))).isoformat() if status == "received" else None,
            "request_id": None,
        })

    if seed_shipments:
        await db.shipments.insert_many(seed_shipments)

    # 6. Pending requests from primary retailer to primary distributor
    if primary_retailers and primary_d:
        r = primary_retailers[0]
        await db.requests.insert_one(StockRequest(
            retailer_id=r.id, distributor_id=primary_d.id,
            items=[
                RequestLine(product_id=product_docs[0].id, quantity=40),
                RequestLine(product_id=product_docs[3].id, quantity=25),
            ],
            note="Weekend rush prep — please prioritize.",
        ).model_dump())

    # 7. Welcome notifications
    notifs = []
    notifs.append(Notification(
        target_type="manufacturer", target_id=mfg.id,
        title="Welcome to Supply Hub", type="system",
        message=f"Unilever workspace is ready. You have {len(distributor_list)} distributors connected.",
    ).model_dump())
    if primary_d:
        notifs.append(Notification(
            target_type="distributor", target_id=primary_d.id,
            title="Workspace Ready", type="system",
            message=f"{primary_d.name} is connected to {len(primary_retailers)} retailers.",
        ).model_dump())
    if primary_retailers:
        notifs.append(Notification(
            target_type="retailer", target_id=primary_retailers[0].id,
            title="Workspace Ready", type="system",
            message=f"{primary_retailers[0].name} is connected to its distributor.",
        ).model_dump())
    if notifs:
        await db.notifications.insert_many(notifs)

    return {
        "manufacturers": 1,
        "distributors": len(distributor_list),
        "retailers": len(retailer_docs),
        "products": len(product_docs),
        "shipments": len(seed_shipments),
        "inventory_rows": len(inv_docs),
        "primary_distributor_id": (primary_d.id if primary_d else None),
        "primary_retailer_id": (primary_retailers[0].id if primary_retailers else None),
    }


@api_router.post("/seed")
async def seed_data():
    return await _seed_from_csv()


# ----------------------------- Register --------------------------------------
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def auto_seed_if_needed():
    # Seed only if no manufacturers (i.e. fresh DB or old schema)
    if await db.manufacturers.count_documents({}) == 0:
        logger.info("Empty manufacturer collection — auto-seeding from CSVs.")
        await _seed_from_csv()


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
