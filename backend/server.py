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

app = FastAPI(title="TradeKonekt API")
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
    store_code: str = ""
    phone: str = ""
    latitude: Optional[float] = None
    longitude: Optional[float] = None
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
    velocity: float = 0.0  # units sold per day (synthetic for retailer items)
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
    return {"message": "TradeKonekt API", "status": "ok"}


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
    return await db.retailers.find(q, {"_id": 0}).sort("name", 1).to_list(20000)


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
    retailers = {r["id"]: r for r in await db.retailers.find({}, {"_id": 0}).to_list(20000)}
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
    retailers = {r["id"]: r for r in await db.retailers.find({}, {"_id": 0}).to_list(20000)}
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
    retailers = {r["id"]: r for r in await db.retailers.find({}, {"_id": 0}).to_list(20000)}
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


# ----------------------------- Hierarchy (radial graph) ----------------------
def _health_from_low_stock(low_count: int, total_skus: int) -> str:
    """Translate low-stock ratio into a coarse health bucket."""
    if total_skus <= 0:
        return "healthy"
    ratio = low_count / total_skus
    if low_count >= 5 or ratio >= 0.5:
        return "critical"
    if low_count >= 2 or ratio >= 0.2:
        return "warning"
    return "healthy"


async def _low_stock_by_owner(owner_type: str) -> Dict[str, Tuple[int, int]]:
    """Return {owner_id: (low_count, total_skus)} for the given owner_type."""
    pipeline = [
        {"$match": {"owner_type": owner_type}},
        {"$group": {
            "_id": "$owner_id",
            "total": {"$sum": 1},
            "low": {"$sum": {"$cond": [{"$lte": ["$quantity", "$reorder_level"]}, 1, 0]}},
        }},
    ]
    cur = db.inventory.aggregate(pipeline)
    out: Dict[str, Tuple[int, int]] = {}
    async for r in cur:
        out[r["_id"]] = (int(r["low"]), int(r["total"]))
    return out


async def _retailer_count_by_distributor() -> Dict[str, int]:
    pipeline = [{"$group": {"_id": "$distributor_id", "count": {"$sum": 1}}}]
    out: Dict[str, int] = {}
    async for r in db.retailers.aggregate(pipeline):
        out[r["_id"]] = int(r["count"])
    return out


async def _shipment_activity_by_distributor() -> Dict[str, int]:
    """Count active (non-received) shipments per distributor (incoming + outgoing)."""
    pipeline = [
        {"$match": {"status": {"$in": ["pending", "in_transit"]}}},
        {"$match": {"distributor_id": {"$ne": ""}}},
        {"$group": {"_id": "$distributor_id", "count": {"$sum": 1}}},
    ]
    out: Dict[str, int] = {}
    async for r in db.shipments.aggregate(pipeline):
        out[r["_id"]] = int(r["count"])
    return out


@api_router.get("/hierarchy/manufacturer/{mfg_id}")
async def hierarchy_root(mfg_id: str):
    mfg = await db.manufacturers.find_one({"id": mfg_id}, {"_id": 0})
    if not mfg:
        raise HTTPException(404, "Manufacturer not found")
    distributors = await db.distributors.find({"manufacturer_id": mfg_id}, {"_id": 0}).to_list(5000)
    retailers_count = await db.retailers.count_documents({})
    low_mfg = await _low_stock_by_owner("manufacturer")
    low, total = low_mfg.get(mfg_id, (0, 0))
    pending_ship = await db.shipments.count_documents({"status": {"$in": ["pending", "in_transit"]}, "manufacturer_id": mfg_id})
    return {
        "id": f"mfg:{mfg_id}",
        "ref_id": mfg_id,
        "parent_id": None,
        "name": mfg["name"],
        "type": "manufacturer",
        "status": _health_from_low_stock(low, total),
        "alerts": low + pending_ship,
        "summary": {
            "regions": len({d.get("region") or "—" for d in distributors}),
            "distributors": len(distributors),
            "retailers": retailers_count,
            "low_stock_skus": low,
        },
        "has_children": True,
    }


@api_router.get("/hierarchy/regions/{mfg_id}")
async def hierarchy_regions(mfg_id: str):
    distributors = await db.distributors.find({"manufacturer_id": mfg_id}, {"_id": 0}).to_list(5000)
    retailers = await db.retailers.find({}, {"_id": 0, "id": 1, "distributor_id": 1}).to_list(20000)

    dist_to_region = {d["id"]: (d.get("region") or "—") for d in distributors}
    region_map: Dict[str, Dict[str, Any]] = {}
    for d in distributors:
        r = d.get("region") or "—"
        rm = region_map.setdefault(r, {"distributors": 0, "retailers": 0, "cities": set()})
        rm["distributors"] += 1
        rm["cities"].add(d.get("city") or "—")
    for ret in retailers:
        r = dist_to_region.get(ret["distributor_id"])
        if r and r in region_map:
            region_map[r]["retailers"] += 1

    low_dist = await _low_stock_by_owner("distributor")
    low_retail = await _low_stock_by_owner("retailer")

    out = []
    for name, info in region_map.items():
        dist_ids = [d["id"] for d in distributors if (d.get("region") or "—") == name]
        ret_ids = [ret["id"] for ret in retailers if dist_to_region.get(ret["distributor_id"]) == name]
        low = sum(low_dist.get(d, (0, 0))[0] for d in dist_ids) + sum(low_retail.get(r, (0, 0))[0] for r in ret_ids)
        total = sum(low_dist.get(d, (0, 0))[1] for d in dist_ids) + sum(low_retail.get(r, (0, 0))[1] for r in ret_ids)
        out.append({
            "id": f"region:{mfg_id}:{name}",
            "parent_id": f"mfg:{mfg_id}",
            "name": name,
            "type": "region",
            "status": _health_from_low_stock(low, total),
            "alerts": low,
            "summary": {
                "cities": len(info["cities"]),
                "distributors": info["distributors"],
                "retailers": info["retailers"],
            },
            "has_children": info["distributors"] > 0,
        })
    out.sort(key=lambda x: x["name"])
    return out


@api_router.get("/hierarchy/states/{mfg_id}/{region}")
async def hierarchy_states(mfg_id: str, region: str):
    """States = cities here, scoped by manufacturer & region."""
    distributors = await db.distributors.find(
        {"manufacturer_id": mfg_id, "region": region}, {"_id": 0}
    ).to_list(5000)
    if not distributors:
        return []
    dist_ids = [d["id"] for d in distributors]
    retailers = await db.retailers.find(
        {"distributor_id": {"$in": dist_ids}}, {"_id": 0, "id": 1, "distributor_id": 1}
    ).to_list(20000)
    dist_to_city = {d["id"]: (d.get("city") or "—") for d in distributors}

    city_map: Dict[str, Dict[str, Any]] = {}
    for d in distributors:
        c = d.get("city") or "—"
        cm = city_map.setdefault(c, {"distributors": 0, "retailers": 0, "dist_ids": [], "ret_ids": []})
        cm["distributors"] += 1
        cm["dist_ids"].append(d["id"])
    for ret in retailers:
        c = dist_to_city.get(ret["distributor_id"], "—")
        if c in city_map:
            city_map[c]["retailers"] += 1
            city_map[c]["ret_ids"].append(ret["id"])

    low_dist = await _low_stock_by_owner("distributor")
    low_retail = await _low_stock_by_owner("retailer")

    out = []
    for name, info in city_map.items():
        low = sum(low_dist.get(d, (0, 0))[0] for d in info["dist_ids"]) + sum(low_retail.get(r, (0, 0))[0] for r in info["ret_ids"])
        total = sum(low_dist.get(d, (0, 0))[1] for d in info["dist_ids"]) + sum(low_retail.get(r, (0, 0))[1] for r in info["ret_ids"])
        out.append({
            "id": f"state:{mfg_id}:{region}:{name}",
            "parent_id": f"region:{mfg_id}:{region}",
            "name": name,
            "type": "state",
            "status": _health_from_low_stock(low, total),
            "alerts": low,
            "summary": {
                "distributors": info["distributors"],
                "retailers": info["retailers"],
            },
            "has_children": info["distributors"] > 0,
        })
    out.sort(key=lambda x: x["name"])
    return out


@api_router.get("/hierarchy/distributors/{mfg_id}/{region}/{state}")
async def hierarchy_distributors_in_state(mfg_id: str, region: str, state: str):
    distributors = await db.distributors.find(
        {"manufacturer_id": mfg_id, "region": region, "city": state}, {"_id": 0}
    ).to_list(5000)
    low_dist = await _low_stock_by_owner("distributor")
    low_retail = await _low_stock_by_owner("retailer")
    retailers_by_dist = await _retailer_count_by_distributor()
    activity = await _shipment_activity_by_distributor()

    # low-stock retailer counts per distributor
    all_retailers = await db.retailers.find(
        {"distributor_id": {"$in": [d["id"] for d in distributors]}},
        {"_id": 0, "id": 1, "distributor_id": 1},
    ).to_list(20000)
    low_ret_per_dist: Dict[str, int] = {}
    for r in all_retailers:
        rid = r["id"]
        if low_retail.get(rid, (0, 0))[0] > 0:
            low_ret_per_dist[r["distributor_id"]] = low_ret_per_dist.get(r["distributor_id"], 0) + 1

    out = []
    for d in distributors:
        low, total = low_dist.get(d["id"], (0, 0))
        out.append({
            "id": f"dist:{d['id']}",
            "ref_id": d["id"],
            "parent_id": f"state:{mfg_id}:{region}:{state}",
            "name": d["name"],
            "type": "distributor",
            "status": _health_from_low_stock(low, total),
            "alerts": low,
            "summary": {
                "total_retailers": retailers_by_dist.get(d["id"], 0),
                "low_stock_retailers": low_ret_per_dist.get(d["id"], 0),
                "shipment_activity": activity.get(d["id"], 0),
                "region": d.get("region", ""),
                "city": d.get("city", ""),
            },
            "has_children": retailers_by_dist.get(d["id"], 0) > 0,
        })
    out.sort(key=lambda x: x["name"])
    return out


@api_router.get("/hierarchy/retailers/{distributor_id}")
async def hierarchy_retailers(distributor_id: str):
    retailers = await db.retailers.find({"distributor_id": distributor_id}, {"_id": 0}).to_list(5000)
    low_retail = await _low_stock_by_owner("retailer")
    out = []
    for r in retailers:
        low, total = low_retail.get(r["id"], (0, 0))
        out.append({
            "id": f"ret:{r['id']}",
            "ref_id": r["id"],
            "parent_id": f"dist:{distributor_id}",
            "name": r["name"],
            "type": "retailer",
            "status": _health_from_low_stock(low, total),
            "alerts": low,
            "summary": {
                "region": r.get("region", ""),
                "city": r.get("city", ""),
                "address": r.get("address", ""),
                "low_stock_skus": low,
            },
            "has_children": False,
        })
    out.sort(key=lambda x: x["name"])
    return out


# --------------------------- Geographic Network API ---------------------------
@api_router.get("/geo/network/{mfg_id}")
async def geo_network(mfg_id: str):
    """Returns the full geographic supply-chain network for the map view.
    Manufacturer position is a soft default (Lagos). Distributor positions are
    computed as the median of their retailers' GPS coords. Retailers carry
    their real lat/lon from the seed CSV.
    """
    mfg = await db.manufacturers.find_one({"id": mfg_id}, {"_id": 0})
    if not mfg:
        raise HTTPException(404, "Manufacturer not found")

    # Pull retailers with geo
    retailers = await db.retailers.find(
        {}, {"_id": 0, "id": 1, "name": 1, "city": 1, "region": 1,
             "address": 1, "store_code": 1, "phone": 1, "latitude": 1,
             "longitude": 1, "distributor_id": 1}
    ).to_list(20000)
    retailers = [r for r in retailers if r.get("latitude") is not None
                 and r.get("longitude") is not None]

    # Low-stock health for retailers
    low_retail = await _low_stock_by_owner("retailer")
    # Active shipments per retailer
    pending_per_retailer: Dict[str, int] = {}
    async for s in db.shipments.find(
        {"status": {"$in": ["pending", "in_transit"]},
         "to_role": "retailer"},
        {"_id": 0, "to_id": 1}
    ):
        rid = s.get("to_id", "")
        if rid:
            pending_per_retailer[rid] = pending_per_retailer.get(rid, 0) + 1

    retailer_out: List[dict] = []
    by_dist: Dict[str, List[dict]] = {}
    for r in retailers:
        low, total = low_retail.get(r["id"], (0, 0))
        status = _health_from_low_stock(low, total)
        item = {
            "id": r["id"],
            "name": r["name"],
            "city": r.get("city", ""),
            "region": r.get("region", ""),
            "address": r.get("address", ""),
            "store_code": r.get("store_code", ""),
            "phone": r.get("phone", ""),
            "lat": float(r["latitude"]),
            "lon": float(r["longitude"]),
            "distributor_id": r.get("distributor_id", ""),
            "status": status,
            "low_stock_skus": low,
            "active_shipments": pending_per_retailer.get(r["id"], 0),
        }
        retailer_out.append(item)
        by_dist.setdefault(item["distributor_id"], []).append(item)

    # Distributors — position = median of their retailers' coords
    distributors = await db.distributors.find(
        {"manufacturer_id": mfg_id},
        {"_id": 0, "id": 1, "name": 1, "city": 1, "region": 1}
    ).to_list(5000)
    low_dist = await _low_stock_by_owner("distributor")
    ship_activity = await _shipment_activity_by_distributor()

    distributor_out: List[dict] = []
    for d in distributors:
        kids = by_dist.get(d["id"], [])
        if kids:
            lats = sorted(k["lat"] for k in kids)
            lons = sorted(k["lon"] for k in kids)
            mid = len(lats) // 2
            d_lat = lats[mid] if len(lats) % 2 else (lats[mid - 1] + lats[mid]) / 2
            d_lon = lons[mid] if len(lons) % 2 else (lons[mid - 1] + lons[mid]) / 2
        else:
            d_lat, d_lon = 6.5244, 3.3792  # Lagos fallback
        low, total = low_dist.get(d["id"], (0, 0))
        low_kids = sum(1 for k in kids if k["status"] != "healthy")
        distributor_out.append({
            "id": d["id"],
            "name": d["name"],
            "city": d.get("city", ""),
            "region": d.get("region", ""),
            "lat": float(d_lat),
            "lon": float(d_lon),
            "status": _health_from_low_stock(low, total),
            "retailer_count": len(kids),
            "low_stock_retailers": low_kids,
            "shipment_activity": ship_activity.get(d["id"], 0),
        })

    # Regions — centroid of their distributors
    region_map: Dict[str, dict] = {}
    for d in distributor_out:
        r = d["region"] or "—"
        rm = region_map.setdefault(r, {
            "name": r, "lat_sum": 0.0, "lon_sum": 0.0, "n": 0,
            "distributors": 0, "retailers": 0, "low": 0,
        })
        rm["lat_sum"] += d["lat"]
        rm["lon_sum"] += d["lon"]
        rm["n"] += 1
        rm["distributors"] += 1
        rm["retailers"] += d["retailer_count"]
        rm["low"] += d["low_stock_retailers"]
    region_out: List[dict] = []
    for r in region_map.values():
        n = max(1, r["n"])
        region_out.append({
            "name": r["name"],
            "lat": r["lat_sum"] / n,
            "lon": r["lon_sum"] / n,
            "distributors": r["distributors"],
            "retailers": r["retailers"],
            "status": (
                "critical" if r["low"] > r["retailers"] * 0.3
                else "warning" if r["low"] > 0 else "healthy"
            ),
        })

    return {
        "manufacturer": {
            "id": mfg["id"],
            "name": mfg["name"],
            "lat": 6.5244,
            "lon": 3.3792,
        },
        "regions": region_out,
        "distributors": distributor_out,
        "retailers": retailer_out,
    }


@api_router.get("/geo/retailer/{retailer_id}")
async def geo_retailer_detail(retailer_id: str):
    """Detailed view of a retailer for the map detail card — inventory health,
    7-day sales trend, pending requests, last shipment, AI insight summary."""
    r = await db.retailers.find_one({"id": retailer_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Retailer not found")
    d = await db.distributors.find_one({"id": r.get("distributor_id", "")}, {"_id": 0}) or {}

    # Inventory rollup
    inv = await db.inventory.find(
        {"owner_type": "retailer", "owner_id": retailer_id}, {"_id": 0}
    ).to_list(2000)
    in_stock = sum(1 for i in inv if int(i.get("quantity", 0)) > int(i.get("reorder_level", 0)))
    low_stock = sum(1 for i in inv if 0 < int(i.get("quantity", 0)) <= int(i.get("reorder_level", 0)))
    out_of_stock = sum(1 for i in inv if int(i.get("quantity", 0)) == 0)
    total = max(1, in_stock + low_stock + out_of_stock)
    health_pct = round(100 * in_stock / total)

    # 7-day sales
    today = datetime.now(timezone.utc).date()
    start = (today - timedelta(days=6)).isoformat()
    sales = await db.daily_sales.find(
        {"retailer_id": retailer_id, "date": {"$gte": start}}, {"_id": 0}
    ).to_list(5000)
    by_day: Dict[str, float] = {}
    for s in sales:
        by_day[s["date"]] = by_day.get(s["date"], 0) + float(s.get("revenue", 0))
    trend = []
    for i in range(7):
        day = (today - timedelta(days=6 - i)).isoformat()
        trend.append({"date": day, "revenue": round(by_day.get(day, 0), 2)})
    revenue_7d = round(sum(t["revenue"] for t in trend), 2)

    prev_start = (today - timedelta(days=13)).isoformat()
    prev_end = (today - timedelta(days=7)).isoformat()
    prev_sales = await db.daily_sales.find(
        {"retailer_id": retailer_id, "date": {"$gte": prev_start, "$lte": prev_end}},
        {"_id": 0, "revenue": 1},
    ).to_list(5000)
    revenue_prev_7d = round(sum(float(s.get("revenue", 0)) for s in prev_sales), 2)
    delta_pct = round(((revenue_7d - revenue_prev_7d) / revenue_prev_7d) * 100, 1) if revenue_prev_7d else 0.0

    # Pending requests
    pending = await db.requests.count_documents({"retailer_id": retailer_id, "status": "pending"})

    # Last shipment to this retailer
    last_ship = await db.shipments.find(
        {"to_role": "retailer", "to_id": retailer_id},
        {"_id": 0}
    ).sort("created_at", -1).to_list(1)
    last_ship_doc = last_ship[0] if last_ship else None
    last_shipment = None
    if last_ship_doc:
        eta = None
        if last_ship_doc.get("status") == "in_transit":
            try:
                dispatched = last_ship_doc.get("dispatched_at") or last_ship_doc.get("created_at")
                # naive ETA: dispatched + 3 days
                dt = datetime.fromisoformat(dispatched.replace("Z", "+00:00")) if isinstance(dispatched, str) else None
                if dt:
                    eta = (dt + timedelta(days=3)).date().isoformat()
            except Exception:
                eta = None
        last_shipment = {
            "tracking_code": last_ship_doc.get("tracking_code", ""),
            "status": last_ship_doc.get("status", "pending"),
            "eta": eta,
        }

    # AI insight (rule-based summary; the chat-AI uses LLM)
    insight_parts: List[str] = []
    if delta_pct >= 5:
        insight_parts.append(f"Sales are up {delta_pct}% week-over-week.")
    elif delta_pct <= -5:
        insight_parts.append(f"Sales are down {abs(delta_pct)}% week-over-week.")
    if low_stock + out_of_stock > 0:
        insight_parts.append(f"{low_stock + out_of_stock} SKU(s) need restocking soon.")
    if pending > 0:
        insight_parts.append(f"{pending} pending request(s) awaiting distributor approval.")
    if not insight_parts:
        insight_parts.append("Inventory healthy and sales steady — no action required.")
    ai_insight = " ".join(insight_parts)

    return {
        "retailer": {
            "id": r["id"],
            "name": r["name"],
            "city": r.get("city", ""),
            "region": r.get("region", ""),
            "address": r.get("address", ""),
            "store_code": r.get("store_code", ""),
            "phone": r.get("phone", ""),
            "lat": r.get("latitude"),
            "lon": r.get("longitude"),
            "status": _health_from_low_stock(low_stock, total),
        },
        "distributor": {"id": d.get("id", ""), "name": d.get("name", "")},
        "inventory": {
            "in_stock": in_stock,
            "low_stock": low_stock,
            "out_of_stock": out_of_stock,
            "health_pct": health_pct,
        },
        "sales": {
            "revenue_7d": revenue_7d,
            "delta_pct": delta_pct,
            "trend": trend,
        },
        "pending_requests": pending,
        "last_shipment": last_shipment,
        "ai_insight": ai_insight,
    }


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


def _safe_float(v) -> Optional[float]:
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return None
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


async def _seed_from_csv():
    for c in ["manufacturers", "distributors", "retailers", "products", "inventory", "shipments", "requests", "notifications", "daily_sales"]:
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
            store_code=(r.get("Store Code") or "").strip(),
            phone=(r.get("Phone") or "").strip(),
            latitude=_safe_float(r.get("Latitude")),
            longitude=_safe_float(r.get("Longitude")),
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

    # Retailer inventory — actual quantities from CSV (with synthetic velocity for AI insights)
    for ridx, ret in enumerate(retailer_docs):
        row = retailer_rows_by_id.get(ret.id, {})
        for pidx, (col, prod_name) in enumerate(PRODUCT_COL_MAP.items()):
            try:
                q = int(row.get(col, "0") or 0)
            except ValueError:
                q = 0
            pid = name_to_pid[prod_name]
            base = 0.4 + ((ridx * 13 + pidx * 7) % 9) * 0.5  # 0.4..4.4 units/day
            if prod_name in {"OMO Multi-Active Detergent", "Lipton Yellow Label Tea", "Blue Band Margarine"}:
                base *= 1.6
            velocity = round(base, 2)
            inv_docs.append(InventoryItem(
                owner_type="retailer", owner_id=ret.id, product_id=pid,
                quantity=q,
                reorder_level=30,
                velocity=velocity,
            ).model_dump())
    if inv_docs:
        await db.inventory.insert_many(inv_docs)

    # 4b. Seed 14 days of synthetic daily sales for the primary retailer (and a smaller sample of others)
    sales_docs: List[dict] = []
    today = datetime.now(timezone.utc).date()
    products_by_id = {p.id: p for p in product_docs}
    sample_retailers = (retailer_docs[:1] + retailer_docs[10:11] + retailer_docs[20:21]) if retailer_docs else []
    for ret in sample_retailers:
        # build a velocity lookup for this retailer
        ret_inv = [i for i in inv_docs if i["owner_id"] == ret.id and i["owner_type"] == "retailer"]
        for day in range(14, 0, -1):
            d = (today - timedelta(days=day - 1)).isoformat()
            for it in ret_inv:
                v = float(it.get("velocity", 0))
                if v <= 0:
                    continue
                # add a little jitter
                jitter = 0.6 + ((rng.random() if False else (hash(d + it["product_id"]) % 100) / 100.0) * 0.8)
                units = max(0, int(round(v * jitter)))
                if units == 0:
                    continue
                price = float(products_by_id.get(it["product_id"]).unit_price) if products_by_id.get(it["product_id"]) else 0.0
                sales_docs.append({
                    "id": new_id(),
                    "retailer_id": ret.id,
                    "product_id": it["product_id"],
                    "date": d,
                    "units": units,
                    "revenue": round(units * price, 2),
                })
    if sales_docs:
        await db.daily_sales.insert_many(sales_docs)

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
        title="Welcome to TradeKonekt", type="system",
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


# ----------------------------- Retailer OS endpoints -------------------------
def _urgency(quantity: int, velocity: float, reorder_level: int) -> Tuple[str, float]:
    """Return (urgency_level, days_remaining)."""
    if velocity <= 0:
        days = 999.0
    else:
        days = quantity / velocity
    if quantity <= 0:
        return "critical", 0.0
    if quantity <= reorder_level or days <= 3:
        return "critical", round(days, 1)
    if days <= 7 or quantity <= reorder_level * 1.5:
        return "warning", round(days, 1)
    return "healthy", round(days, 1)


async def _retailer_inventory_enriched(retailer_id: str) -> List[Dict[str, Any]]:
    inv = await db.inventory.find(
        {"owner_type": "retailer", "owner_id": retailer_id}, {"_id": 0}
    ).to_list(2000)
    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(2000)}
    enriched = []
    for it in inv:
        p = products.get(it["product_id"], {})
        urgency, days = _urgency(int(it["quantity"]), float(it.get("velocity", 0)), int(it.get("reorder_level", 10)))
        enriched.append({
            **it,
            "product": p,
            "urgency": urgency,
            "days_remaining": days,
        })
    return enriched


@api_router.get("/retailer/{retailer_id}/dashboard")
async def retailer_dashboard(retailer_id: str):
    retailer = await db.retailers.find_one({"id": retailer_id}, {"_id": 0})
    if not retailer:
        raise HTTPException(404, "Retailer not found")
    inv = await _retailer_inventory_enriched(retailer_id)
    # KPIs
    total_units = sum(int(i["quantity"]) for i in inv)
    low = [i for i in inv if i["urgency"] in ("warning", "critical")]
    critical = [i for i in inv if i["urgency"] == "critical"]
    # Pending deliveries: shipments to this retailer not yet received
    pending = await db.shipments.count_documents(
        {"retailer_id": retailer_id, "status": {"$in": ["pending", "in_transit"]}}
    )
    # Recent shipments
    shipments = await db.shipments.find(
        {"retailer_id": retailer_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(8)
    distributors = {d["id"]: d for d in await db.distributors.find({}, {"_id": 0}).to_list(2000)}
    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(2000)}
    for s in shipments:
        s["distributor"] = distributors.get(s.get("distributor_id", ""), {})
        for it in s.get("items", []):
            it["product"] = products.get(it["product_id"], {})

    # Today's sales (sum of last day in synthetic sales)
    today = datetime.now(timezone.utc).date().isoformat()
    sales_today = await db.daily_sales.aggregate([
        {"$match": {"retailer_id": retailer_id, "date": today}},
        {"$group": {"_id": None, "units": {"$sum": "$units"}, "revenue": {"$sum": "$revenue"}}},
    ]).to_list(1)
    sales_today = sales_today[0] if sales_today else {"units": 0, "revenue": 0}

    # Top selling (last 7 days)
    seven_ago = (datetime.now(timezone.utc).date() - timedelta(days=7)).isoformat()
    top = await db.daily_sales.aggregate([
        {"$match": {"retailer_id": retailer_id, "date": {"$gte": seven_ago}}},
        {"$group": {"_id": "$product_id", "units": {"$sum": "$units"}, "revenue": {"$sum": "$revenue"}}},
        {"$sort": {"units": -1}},
        {"$limit": 5},
    ]).to_list(5)
    for t in top:
        t["product"] = products.get(t["_id"], {})

    # Fast moving = top by velocity
    fast = sorted(inv, key=lambda x: -float(x.get("velocity", 0)))[:5]
    # Near stockout = lowest days remaining
    near = sorted(
        [i for i in inv if i["urgency"] != "healthy"],
        key=lambda x: x["days_remaining"],
    )[:6]

    return {
        "retailer": retailer,
        "kpis": {
            "inventory_units": total_units,
            "low_stock_count": len(low),
            "critical_count": len(critical),
            "pending_deliveries": pending,
            "sales_today_units": int(sales_today.get("units", 0)),
            "sales_today_revenue": round(float(sales_today.get("revenue", 0)), 2),
            "skus_tracked": len(inv),
        },
        "recent_shipments": shipments,
        "top_selling": top,
        "fast_moving": fast,
        "near_stockout": near,
    }


@api_router.get("/retailer/{retailer_id}/insights")
async def retailer_insights(retailer_id: str):
    inv = await _retailer_inventory_enriched(retailer_id)
    insights: List[Dict[str, Any]] = []

    for i in inv:
        name = (i.get("product") or {}).get("name", "Item")
        if i["urgency"] == "critical" and i["days_remaining"] < 999:
            insights.append({
                "id": f"stockout-{i['product_id']}",
                "type": "stockout_risk",
                "tone": "critical",
                "title": "Stockout risk",
                "message": f"{name} may run out in {i['days_remaining']:.0f} day{'s' if i['days_remaining'] != 1 else ''} based on current sales velocity.",
                "action": "Restock now",
                "product_id": i["product_id"],
            })
        elif i["urgency"] == "warning":
            insights.append({
                "id": f"warning-{i['product_id']}",
                "type": "low_stock",
                "tone": "warning",
                "title": "Low stock warning",
                "message": f"{name} is running low — about {i['days_remaining']:.0f} days of cover left.",
                "action": "Add to reorder",
                "product_id": i["product_id"],
            })

    # Fast-selling: velocity >= 3 units/day
    fast = [i for i in inv if float(i.get("velocity", 0)) >= 3]
    fast = sorted(fast, key=lambda x: -float(x.get("velocity", 0)))[:2]
    for i in fast:
        name = (i.get("product") or {}).get("name", "Item")
        insights.append({
            "id": f"fast-{i['product_id']}",
            "type": "fast_seller",
            "tone": "info",
            "title": "Top performer",
            "message": f"{name} is selling fast — about {i['velocity']:.1f} units/day. Keep stock high.",
            "action": "View",
            "product_id": i["product_id"],
        })

    # Slow / overstock: velocity <= 0.3 and quantity > reorder_level * 3
    slow = [i for i in inv if float(i.get("velocity", 0)) <= 0.3 and i["quantity"] > i["reorder_level"] * 3]
    for i in slow[:2]:
        name = (i.get("product") or {}).get("name", "Item")
        insights.append({
            "id": f"slow-{i['product_id']}",
            "type": "overstock",
            "tone": "info",
            "title": "Overstock detected",
            "message": f"{name} has {i['quantity']} units but is moving slowly. Consider a promotion.",
            "action": "Plan promo",
            "product_id": i["product_id"],
        })

    # Sort: critical first, then warning, then info
    tone_order = {"critical": 0, "warning": 1, "info": 2}
    insights.sort(key=lambda x: tone_order.get(x["tone"], 9))
    return insights[:8]


@api_router.get("/retailer/{retailer_id}/reorder-suggestions")
async def reorder_suggestions(retailer_id: str):
    inv = await _retailer_inventory_enriched(retailer_id)
    out = []
    target_days_cover = 14  # aim to cover ~2 weeks
    for i in inv:
        if i["urgency"] == "healthy":
            continue
        velocity = float(i.get("velocity", 0))
        target = max(int(round(velocity * target_days_cover)), int(i["reorder_level"]))
        recommended = max(target - int(i["quantity"]), 0)
        # round up to nearest 5 for cleaner pack sizes
        if recommended > 0:
            recommended = int((recommended + 4) // 5 * 5)
        if recommended <= 0:
            continue
        out.append({
            "product_id": i["product_id"],
            "product": i.get("product"),
            "current_quantity": int(i["quantity"]),
            "velocity": velocity,
            "days_remaining": i["days_remaining"],
            "urgency": i["urgency"],
            "recommended_quantity": recommended,
        })
    # Order by urgency then days
    order = {"critical": 0, "warning": 1, "healthy": 2}
    out.sort(key=lambda x: (order[x["urgency"]], x["days_remaining"]))
    return out


class QuickReorderPayload(BaseModel):
    shipment_id: Optional[str] = None
    items: Optional[List[Dict[str, Any]]] = None  # [{product_id, quantity}]
    note: Optional[str] = None


@api_router.post("/retailer/{retailer_id}/quick-reorder")
async def quick_reorder(retailer_id: str, payload: QuickReorderPayload):
    retailer = await db.retailers.find_one({"id": retailer_id}, {"_id": 0})
    if not retailer:
        raise HTTPException(404, "Retailer not found")
    items: List[Dict[str, Any]] = []
    if payload.shipment_id:
        sh = await db.shipments.find_one({"id": payload.shipment_id, "retailer_id": retailer_id})
        if not sh:
            raise HTTPException(404, "Shipment not found")
        items = [{"product_id": it["product_id"], "quantity": int(it["quantity"])} for it in sh.get("items", [])]
    elif payload.items:
        items = [{"product_id": it["product_id"], "quantity": int(it["quantity"])} for it in payload.items if int(it.get("quantity", 0)) > 0]
    if not items:
        raise HTTPException(400, "No items to reorder")

    req = StockRequest(
        retailer_id=retailer_id,
        distributor_id=retailer["distributor_id"],
        items=[RequestLine(**it) for it in items],
        note=payload.note or "Quick reorder",
    )
    await db.requests.insert_one(req.model_dump())
    await push_notification(
        "distributor", retailer["distributor_id"],
        "New Stock Request",
        f"{retailer['name']} submitted a quick reorder ({len(items)} item(s)).",
        "request",
    )
    return {"ok": True, "request_id": req.id, "items_count": len(items)}


@api_router.get("/retailer/{retailer_id}/sales-trend")
async def sales_trend(retailer_id: str, days: int = 7):
    days = max(1, min(30, days))
    today = datetime.now(timezone.utc).date()
    start = (today - timedelta(days=days - 1)).isoformat()
    rows = await db.daily_sales.aggregate([
        {"$match": {"retailer_id": retailer_id, "date": {"$gte": start}}},
        {"$group": {"_id": "$date", "units": {"$sum": "$units"}, "revenue": {"$sum": "$revenue"}}},
        {"$sort": {"_id": 1}},
    ]).to_list(60)
    by_date = {r["_id"]: r for r in rows}
    series = []
    for i in range(days - 1, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        r = by_date.get(d, {"units": 0, "revenue": 0})
        series.append({"date": d[5:], "units": int(r["units"]), "revenue": round(float(r["revenue"]), 2)})

    total_units = sum(s["units"] for s in series)
    total_revenue = sum(s["revenue"] for s in series)
    # Inventory turnover: total units sold / avg inventory
    inv = await db.inventory.find({"owner_type": "retailer", "owner_id": retailer_id}, {"_id": 0}).to_list(2000)
    avg_inv = max(sum(int(i["quantity"]) for i in inv) / max(len(inv), 1), 1)
    turnover = round(total_units / avg_inv, 2)

    # Reorder frequency: requests in window
    reorders = await db.requests.count_documents({
        "retailer_id": retailer_id,
        "created_at": {"$gte": (today - timedelta(days=days - 1)).isoformat()},
    })

    # Stock efficiency score: blend of turnover, low-stock ratio, reorder cadence
    healthy = sum(1 for i in inv if int(i["quantity"]) > int(i.get("reorder_level", 10)))
    health_ratio = healthy / max(len(inv), 1)
    score = max(0, min(100, int(round(40 * health_ratio + 30 * min(turnover, 2) / 2 + 30))))

    return {
        "series": series,
        "totals": {"units": total_units, "revenue": round(total_revenue, 2)},
        "inventory_turnover": turnover,
        "reorder_count": reorders,
        "stock_efficiency_score": score,
    }


@api_router.get("/retailer/{retailer_id}/activity")
async def retailer_activity(retailer_id: str, limit: int = 30):
    retailer = await db.retailers.find_one({"id": retailer_id}, {"_id": 0})
    if not retailer:
        raise HTTPException(404, "Retailer not found")

    notifs = await db.notifications.find(
        {"target_type": "retailer", "target_id": retailer_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(limit)
    shipments = await db.shipments.find(
        {"retailer_id": retailer_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(limit)
    distributors = {d["id"]: d for d in await db.distributors.find({}, {"_id": 0}).to_list(2000)}

    items = []
    for n in notifs:
        items.append({
            "kind": n.get("type", "system"),
            "title": n.get("title", ""),
            "message": n.get("message", ""),
            "ts": n.get("created_at", ""),
            "read": bool(n.get("read", False)),
        })
    for s in shipments:
        d_name = distributors.get(s.get("distributor_id", ""), {}).get("name", "Distributor")
        if s["status"] == "received":
            msg = f"Shipment {s['tracking_code']} from {d_name} was delivered."
            ts = s.get("received_at") or s.get("created_at")
        elif s["status"] == "in_transit":
            msg = f"Shipment {s['tracking_code']} from {d_name} is on the way."
            ts = s.get("dispatched_at") or s.get("created_at")
        else:
            msg = f"Shipment {s['tracking_code']} from {d_name} is being prepared."
            ts = s.get("created_at")
        items.append({
            "kind": "shipment",
            "title": f"Shipment · {s['status'].replace('_', ' ').title()}",
            "message": msg,
            "ts": ts or now_iso(),
            "tracking_code": s.get("tracking_code"),
            "status": s["status"],
        })

    # sort newest first
    items.sort(key=lambda x: x["ts"], reverse=True)
    return items[:limit]


# ----------------------------- Retailer AI Assistant -------------------------
class AssistantMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AssistantPayload(BaseModel):
    message: str
    history: List[AssistantMessage] = Field(default_factory=list)
    session_id: Optional[str] = None


async def _build_retailer_context(retailer_id: str) -> str:
    """Compact JSON-ish context the LLM can reference. Strictly scoped to this retailer."""
    retailer = await db.retailers.find_one({"id": retailer_id}, {"_id": 0})
    if not retailer:
        raise HTTPException(404, "Retailer not found")
    distributor = await db.distributors.find_one({"id": retailer["distributor_id"]}, {"_id": 0})
    inv = await _retailer_inventory_enriched(retailer_id)
    # Today + last-7d sales totals
    today = datetime.now(timezone.utc).date()
    seven_ago = (today - timedelta(days=6)).isoformat()
    sales = await db.daily_sales.aggregate([
        {"$match": {"retailer_id": retailer_id, "date": {"$gte": seven_ago}}},
        {"$group": {"_id": "$product_id", "units": {"$sum": "$units"}, "revenue": {"$sum": "$revenue"}}},
    ]).to_list(50)
    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(5000)}
    sales_by_pid = {s["_id"]: s for s in sales}

    inv_summary = []
    for it in inv:
        p = it.get("product") or {}
        s = sales_by_pid.get(it["product_id"], {})
        inv_summary.append({
            "product": p.get("name", "?"),
            "sku": p.get("sku", ""),
            "stock": int(it["quantity"]),
            "reorder_level": int(it["reorder_level"]),
            "velocity_per_day": float(it.get("velocity", 0)),
            "days_remaining": it["days_remaining"],
            "urgency": it["urgency"],
            "sales_7d_units": int(s.get("units", 0)),
            "sales_7d_revenue": round(float(s.get("revenue", 0)), 2),
        })

    # Recent shipments (last 5)
    ships = await db.shipments.find(
        {"retailer_id": retailer_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(5)
    distributors = {d["id"]: d for d in await db.distributors.find({}, {"_id": 0}).to_list(2000)}
    ship_summary = []
    for s in ships:
        ship_summary.append({
            "tracking_code": s.get("tracking_code"),
            "status": s.get("status"),
            "from": distributors.get(s.get("distributor_id", ""), {}).get("name", ""),
            "items": [
                {
                    "product": products.get(it["product_id"], {}).get("name", "?"),
                    "qty": int(it["quantity"]),
                }
                for it in s.get("items", [])
            ],
            "created_at": s.get("created_at"),
        })

    # Open requests
    open_reqs = await db.requests.count_documents({
        "retailer_id": retailer_id, "status": {"$in": ["pending", "approved"]}
    })

    import json as _json
    context = {
        "retailer": {
            "name": retailer["name"],
            "region": retailer.get("region", ""),
            "city": retailer.get("city", ""),
            "distributor": (distributor or {}).get("name", ""),
        },
        "inventory": inv_summary,
        "recent_shipments": ship_summary,
        "open_requests": open_reqs,
        "as_of": now_iso(),
    }
    return _json.dumps(context, indent=2)


_SYSTEM_PROMPT_TEMPLATE = """You are "Aisle", the in-store AI assistant for the retailer "{retailer_name}".

You help the retailer answer questions about THEIR own store and take actions for them.

Strict rules:
1. You ONLY have access to the data of "{retailer_name}". Never speculate about other retailers, distributors or manufacturers in the network. If asked about other retailers, politely explain you can only see this store's data.
2. Be concise. Use short paragraphs and bullet points. Speak in plain shopkeeper-friendly language.
3. Use Nigerian Naira (₦) for money. Numbers like "5 days of cover left", "₦12,400 sold today".
4. When the user asks to *do* something (reorder, restock, place order), respond with a short confirmation message AND append a single fenced JSON block at the end with action details.

Action JSON schema (only when needed):
```json
{{"action": "reorder", "items": [{{"product_name": "OMO Multi-Active Detergent", "quantity": 30}}]}}
```
Other actions:
- {{"action": "open_smart_reorder"}}  — open the AI smart reorder panel
- {{"action": "open_voice_order"}}     — open voice order modal
- {{"action": "show_low_stock"}}       — focus the low stock list

Only emit ONE action JSON block per response, and only when the user clearly asked for an action.
If you don't have enough info, ask one short clarifying question instead.

Today is {today}. Here is THIS RETAILER's live data (do not invent values outside this):

{context}
"""


@api_router.post("/retailer/{retailer_id}/assistant")
async def retailer_assistant(retailer_id: str, payload: AssistantPayload):
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(500, "Assistant unavailable: missing LLM key")

    retailer = await db.retailers.find_one({"id": retailer_id}, {"_id": 0})
    if not retailer:
        raise HTTPException(404, "Retailer not found")

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage  # type: ignore
    except Exception as e:
        raise HTTPException(500, f"emergentintegrations unavailable: {e}")

    context_blob = await _build_retailer_context(retailer_id)
    system_prompt = _SYSTEM_PROMPT_TEMPLATE.format(
        retailer_name=retailer["name"],
        today=datetime.now(timezone.utc).date().isoformat(),
        context=context_blob,
    )

    session_id = payload.session_id or f"retailer-{retailer_id}"

    chat = LlmChat(
        api_key=api_key,
        session_id=session_id,
        system_message=system_prompt,
    ).with_model("anthropic", "claude-haiku-4-5-20251001")

    # Replay short history (last 8 turns) so multi-turn works without DB persistence
    for h in payload.history[-8:]:
        if h.role == "user":
            try:
                await chat.send_message(UserMessage(text=h.content))
            except Exception:
                # If replay fails just continue — model still has system prompt + new message
                break

    try:
        response = await chat.send_message(UserMessage(text=payload.message))
    except Exception as e:
        logger.exception("Assistant call failed")
        raise HTTPException(502, f"Assistant error: {e}")

    text = str(response or "").strip()

    # Parse trailing ```json block for action commands
    action: Optional[Dict[str, Any]] = None
    import re
    import json as _json
    m = re.search(r"```json\s*(\{.*?\})\s*```", text, re.DOTALL)
    spoken = text
    if m:
        try:
            action = _json.loads(m.group(1))
            spoken = (text[: m.start()] + text[m.end():]).strip()
        except Exception:
            action = None

    return {
        "reply": spoken,
        "action": action,
        "session_id": session_id,
    }


class AssistantActionPayload(BaseModel):
    action: Dict[str, Any]


@api_router.post("/retailer/{retailer_id}/assistant/execute")
async def retailer_assistant_execute(retailer_id: str, payload: AssistantActionPayload):
    """Execute a structured action returned by the assistant (server-side validated)."""
    retailer = await db.retailers.find_one({"id": retailer_id}, {"_id": 0})
    if not retailer:
        raise HTTPException(404, "Retailer not found")

    a = payload.action or {}
    kind = a.get("action")
    if kind == "reorder":
        items_in = a.get("items", []) or []
        # Map product names -> ids by case-insensitive contains, scoped to this retailer's inventory products
        all_products = await db.products.find({}, {"_id": 0}).to_list(5000)
        items: List[Dict[str, Any]] = []
        unresolved: List[str] = []
        for it in items_in:
            name = str(it.get("product_name", "")).strip().lower()
            qty = int(it.get("quantity", 0) or 0)
            if not name or qty <= 0:
                continue
            best = None
            best_score = 0
            for p in all_products:
                pn = p["name"].lower()
                if name in pn or pn in name:
                    score = len(pn) - abs(len(pn) - len(name))
                    if score > best_score:
                        best = p
                        best_score = score
            if best:
                items.append({"product_id": best["id"], "quantity": qty})
            else:
                unresolved.append(it.get("product_name", "?"))
        if not items:
            return {"ok": False, "error": "No products resolved", "unresolved": unresolved}

        req = StockRequest(
            retailer_id=retailer_id,
            distributor_id=retailer["distributor_id"],
            items=[RequestLine(**it) for it in items],
            note="Reorder via AI assistant",
        )
        await db.requests.insert_one(req.model_dump())
        await push_notification(
            "distributor", retailer["distributor_id"],
            "New Stock Request",
            f"{retailer['name']} sent a reorder via AI assistant ({len(items)} item(s)).",
            "request",
        )
        return {"ok": True, "request_id": req.id, "items_count": len(items), "unresolved": unresolved}

    # Other action kinds are UI-only and handled on the frontend
    return {"ok": True, "ui_action": kind}


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
