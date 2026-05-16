from fastapi import FastAPI, APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import io
import csv
import logging
import uuid
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Literal, Dict, Any
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="Supply Chain Hub API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


# ----------------------------- Helpers ---------------------------------------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def clean(doc: dict) -> dict:
    """Strip Mongo _id and return a fresh dict copy."""
    if not doc:
        return doc
    d = dict(doc)
    d.pop("_id", None)
    return d


ShipmentStatus = Literal["pending", "in_transit", "received"]
RequestStatus = Literal["pending", "approved", "rejected", "fulfilled"]


# ----------------------------- Models ----------------------------------------
class Distributor(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    name: str
    region: str
    contact_email: str
    created_at: str = Field(default_factory=now_iso)


class Retailer(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    name: str
    region: str
    contact_email: str
    distributor_id: str  # primary distributor relationship
    created_at: str = Field(default_factory=now_iso)


class Product(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    sku: str
    name: str
    category: str
    unit_price: float


class InventoryItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    owner_type: Literal["distributor", "retailer"]
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
    distributor_id: str
    retailer_id: str
    items: List[ShipmentLine]
    status: ShipmentStatus = "pending"
    tracking_code: str = Field(default_factory=lambda: "SHP-" + uuid.uuid4().hex[:8].upper())
    notes: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    dispatched_at: Optional[str] = None
    received_at: Optional[str] = None
    request_id: Optional[str] = None


class ShipmentCreate(BaseModel):
    distributor_id: str
    retailer_id: str
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
    target_type: Literal["distributor", "retailer"]
    target_id: str
    title: str
    message: str
    type: Literal["shipment", "request", "inventory", "system"] = "system"
    read: bool = False
    created_at: str = Field(default_factory=now_iso)


# ----------------------------- Notification helper ---------------------------
async def push_notification(target_type: str, target_id: str, title: str, message: str, ntype: str = "system"):
    n = Notification(target_type=target_type, target_id=target_id, title=title, message=message, type=ntype)
    await db.notifications.insert_one(n.model_dump())


# ----------------------------- Routes ----------------------------------------
@api_router.get("/")
async def root():
    return {"message": "Supply Chain Hub API", "status": "ok"}


# ---- Distributors / Retailers / Products ----
@api_router.get("/distributors", response_model=List[Distributor])
async def list_distributors():
    docs = await db.distributors.find({}, {"_id": 0}).to_list(1000)
    return docs


@api_router.get("/retailers", response_model=List[Retailer])
async def list_retailers(distributor_id: Optional[str] = None):
    q = {"distributor_id": distributor_id} if distributor_id else {}
    docs = await db.retailers.find(q, {"_id": 0}).to_list(1000)
    return docs


@api_router.get("/products", response_model=List[Product])
async def list_products():
    docs = await db.products.find({}, {"_id": 0}).to_list(1000)
    return docs


# ---- Inventory ----
@api_router.get("/inventory")
async def get_inventory(owner_type: str, owner_id: str):
    items = await db.inventory.find({"owner_type": owner_type, "owner_id": owner_id}, {"_id": 0}).to_list(1000)
    # join product details
    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(1000)}
    for it in items:
        p = products.get(it["product_id"], {})
        it["product"] = p
    return items


async def _adjust_inventory(owner_type: str, owner_id: str, product_id: str, delta: int):
    existing = await db.inventory.find_one({"owner_type": owner_type, "owner_id": owner_id, "product_id": product_id})
    if existing:
        new_qty = max(0, int(existing.get("quantity", 0)) + delta)
        await db.inventory.update_one(
            {"id": existing["id"]},
            {"$set": {"quantity": new_qty, "updated_at": now_iso()}},
        )
        return new_qty, int(existing.get("reorder_level", 10))
    else:
        item = InventoryItem(
            owner_type=owner_type, owner_id=owner_id, product_id=product_id,
            quantity=max(0, delta),
        )
        await db.inventory.insert_one(item.model_dump())
        return item.quantity, item.reorder_level


# ---- Shipments ----
@api_router.get("/shipments")
async def list_shipments(distributor_id: Optional[str] = None, retailer_id: Optional[str] = None):
    q: Dict[str, Any] = {}
    if distributor_id:
        q["distributor_id"] = distributor_id
    if retailer_id:
        q["retailer_id"] = retailer_id
    docs = await db.shipments.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    # enrich
    distributors = {d["id"]: d for d in await db.distributors.find({}, {"_id": 0}).to_list(1000)}
    retailers = {r["id"]: r for r in await db.retailers.find({}, {"_id": 0}).to_list(1000)}
    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(1000)}
    for s in docs:
        s["distributor"] = distributors.get(s["distributor_id"], {})
        s["retailer"] = retailers.get(s["retailer_id"], {})
        for it in s.get("items", []):
            it["product"] = products.get(it["product_id"], {})
    return docs


@api_router.post("/shipments", response_model=Shipment)
async def create_shipment(payload: ShipmentCreate):
    sh = Shipment(**payload.model_dump())
    await db.shipments.insert_one(sh.model_dump())
    await push_notification(
        "retailer", sh.retailer_id,
        "New Shipment Created",
        f"Shipment {sh.tracking_code} is pending dispatch.",
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
    valid_transitions = {"pending": ["in_transit"], "in_transit": ["received"]}
    if target not in valid_transitions.get(current, []):
        raise HTTPException(400, f"Cannot transition from {current} to {target}")

    update: Dict[str, Any] = {"status": target}
    if target == "in_transit":
        update["dispatched_at"] = now_iso()
        # deduct from distributor inventory
        for it in sh.get("items", []):
            await _adjust_inventory("distributor", sh["distributor_id"], it["product_id"], -int(it["quantity"]))
        await push_notification(
            "retailer", sh["retailer_id"],
            "Shipment In Transit",
            f"Shipment {sh['tracking_code']} has been dispatched.",
            "shipment",
        )
    elif target == "received":
        update["received_at"] = now_iso()
        # add to retailer inventory + check reorder
        for it in sh.get("items", []):
            qty, reorder = await _adjust_inventory("retailer", sh["retailer_id"], it["product_id"], int(it["quantity"]))
        await push_notification(
            "distributor", sh["distributor_id"],
            "Shipment Received",
            f"Retailer confirmed receipt of shipment {sh['tracking_code']}.",
            "shipment",
        )
        # if linked to a request, mark fulfilled
        if sh.get("request_id"):
            await db.requests.update_one(
                {"id": sh["request_id"]},
                {"$set": {"status": "fulfilled", "resolved_at": now_iso()}},
            )

    await db.shipments.update_one({"id": shipment_id}, {"$set": update})
    updated = await db.shipments.find_one({"id": shipment_id}, {"_id": 0})
    return clean(updated)


# ---- Requests ----
@api_router.get("/requests")
async def list_requests(distributor_id: Optional[str] = None, retailer_id: Optional[str] = None):
    q: Dict[str, Any] = {}
    if distributor_id:
        q["distributor_id"] = distributor_id
    if retailer_id:
        q["retailer_id"] = retailer_id
    docs = await db.requests.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    distributors = {d["id"]: d for d in await db.distributors.find({}, {"_id": 0}).to_list(1000)}
    retailers = {r["id"]: r for r in await db.retailers.find({}, {"_id": 0}).to_list(1000)}
    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(1000)}
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
            "retailer", req["retailer_id"],
            "Request Rejected",
            "Your stock request was rejected by the distributor.",
            "request",
        )
        return {"ok": True, "status": "rejected"}

    # approve -> create shipment
    sh = Shipment(
        distributor_id=req["distributor_id"],
        retailer_id=req["retailer_id"],
        items=[ShipmentLine(**it) for it in req["items"]],
        request_id=req["id"],
        notes=f"Auto-created from request {req['id'][:8]}",
    )
    await db.shipments.insert_one(sh.model_dump())
    await db.requests.update_one(
        {"id": request_id},
        {"$set": {"status": "approved", "resolved_at": now_iso()}},
    )
    await push_notification(
        "retailer", req["retailer_id"],
        "Request Approved",
        f"Your request was approved. Shipment {sh.tracking_code} is now pending dispatch.",
        "request",
    )
    return {"ok": True, "status": "approved", "shipment_id": sh.id, "tracking_code": sh.tracking_code}


# ---- Notifications ----
@api_router.get("/notifications")
async def list_notifications(target_type: str, target_id: str):
    docs = await db.notifications.find(
        {"target_type": target_type, "target_id": target_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    return docs


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
    if role not in ("distributor", "retailer"):
        raise HTTPException(400, "Invalid role")
    q = {"distributor_id": entity_id} if role == "distributor" else {"retailer_id": entity_id}
    shipments = await db.shipments.find(q, {"_id": 0}).to_list(5000)
    requests = await db.requests.find(q, {"_id": 0}).to_list(5000)

    # KPIs
    kpis = {
        "total_shipments": len(shipments),
        "pending": sum(1 for s in shipments if s["status"] == "pending"),
        "in_transit": sum(1 for s in shipments if s["status"] == "in_transit"),
        "received": sum(1 for s in shipments if s["status"] == "received"),
        "open_requests": sum(1 for r in requests if r["status"] == "pending"),
    }

    # Status breakdown for pie
    status_breakdown = [
        {"name": "Pending", "value": kpis["pending"]},
        {"name": "In Transit", "value": kpis["in_transit"]},
        {"name": "Received", "value": kpis["received"]},
    ]

    # Shipments over last 14 days
    today = datetime.now(timezone.utc).date()
    buckets = {}
    for i in range(13, -1, -1):
        d = today - timedelta(days=i)
        buckets[d.isoformat()] = 0
    for s in shipments:
        try:
            d = datetime.fromisoformat(s["created_at"]).date().isoformat()
            if d in buckets:
                buckets[d] += 1
        except Exception:
            pass
    timeline = [{"date": k[5:], "shipments": v} for k, v in buckets.items()]

    # Top products by volume
    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(1000)}
    product_volume: Dict[str, int] = {}
    for s in shipments:
        for it in s.get("items", []):
            product_volume[it["product_id"]] = product_volume.get(it["product_id"], 0) + int(it["quantity"])
    top_products = sorted(
        [{"name": products.get(pid, {}).get("name", pid)[:18], "units": v} for pid, v in product_volume.items()],
        key=lambda x: -x["units"],
    )[:6]

    # Inventory snapshot
    inv = await db.inventory.find({"owner_type": role, "owner_id": entity_id}, {"_id": 0}).to_list(1000)
    inventory_total = sum(int(i.get("quantity", 0)) for i in inv)
    low_stock = sum(1 for i in inv if int(i.get("quantity", 0)) <= int(i.get("reorder_level", 10)))

    return {
        "kpis": {**kpis, "inventory_total": inventory_total, "low_stock": low_stock},
        "status_breakdown": status_breakdown,
        "timeline": timeline,
        "top_products": top_products,
    }


# ---- Reports (CSV export) ----
@api_router.get("/reports/shipments.csv")
async def export_shipments_csv(role: str, entity_id: str):
    q = {"distributor_id": entity_id} if role == "distributor" else {"retailer_id": entity_id}
    shipments = await db.shipments.find(q, {"_id": 0}).sort("created_at", -1).to_list(5000)
    distributors = {d["id"]: d for d in await db.distributors.find({}, {"_id": 0}).to_list(1000)}
    retailers = {r["id"]: r for r in await db.retailers.find({}, {"_id": 0}).to_list(1000)}
    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(1000)}

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "Tracking Code", "Status", "Distributor", "Retailer",
        "Products", "Total Units", "Created", "Dispatched", "Received",
    ])
    for s in shipments:
        prods = "; ".join(
            f"{products.get(it['product_id'], {}).get('name', it['product_id'])} x{it['quantity']}"
            for it in s.get("items", [])
        )
        total = sum(int(it["quantity"]) for it in s.get("items", []))
        writer.writerow([
            s.get("tracking_code", ""), s.get("status", ""),
            distributors.get(s["distributor_id"], {}).get("name", ""),
            retailers.get(s["retailer_id"], {}).get("name", ""),
            prods, total,
            s.get("created_at", ""), s.get("dispatched_at", "") or "",
            s.get("received_at", "") or "",
        ])
    buf.seek(0)
    headers = {"Content-Disposition": f"attachment; filename=shipments_{role}_{entity_id[:8]}.csv"}
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers=headers)


@api_router.get("/reports/inventory.csv")
async def export_inventory_csv(role: str, entity_id: str):
    inv = await db.inventory.find({"owner_type": role, "owner_id": entity_id}, {"_id": 0}).to_list(2000)
    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(1000)}
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["SKU", "Product", "Category", "Quantity", "Reorder Level", "Updated"])
    for it in inv:
        p = products.get(it["product_id"], {})
        writer.writerow([
            p.get("sku", ""), p.get("name", ""), p.get("category", ""),
            it.get("quantity", 0), it.get("reorder_level", 10), it.get("updated_at", ""),
        ])
    buf.seek(0)
    headers = {"Content-Disposition": f"attachment; filename=inventory_{role}_{entity_id[:8]}.csv"}
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers=headers)


# ---- Seed ----
@api_router.post("/seed")
async def seed_data(reset: bool = True):
    if reset:
        for c in ["distributors", "retailers", "products", "inventory", "shipments", "requests", "notifications"]:
            await db[c].delete_many({})

    # Distributors
    distributors = [
        Distributor(name="Northwind Supplies", region="Northeast", contact_email="ops@northwind.io"),
        Distributor(name="Pacific Goods Co.", region="West Coast", contact_email="hello@pacificgoods.io"),
    ]
    # Products
    products = [
        Product(sku="SKU-001", name="Organic Coffee Beans 1kg", category="Beverages", unit_price=18.50),
        Product(sku="SKU-002", name="Whole Wheat Flour 5kg", category="Bakery", unit_price=12.00),
        Product(sku="SKU-003", name="Olive Oil 1L", category="Pantry", unit_price=14.75),
        Product(sku="SKU-004", name="Dark Chocolate Bars 100g", category="Confectionery", unit_price=3.20),
        Product(sku="SKU-005", name="Sparkling Water 12pk", category="Beverages", unit_price=8.90),
        Product(sku="SKU-006", name="Rolled Oats 2kg", category="Bakery", unit_price=9.40),
    ]
    await db.distributors.insert_many([d.model_dump() for d in distributors])
    await db.products.insert_many([p.model_dump() for p in products])

    # Retailers (split across distributors)
    retailers = [
        Retailer(name="Greenleaf Grocer", region="Brooklyn, NY", contact_email="store@greenleaf.com", distributor_id=distributors[0].id),
        Retailer(name="Sunrise Market", region="Boston, MA", contact_email="hi@sunrisemarket.com", distributor_id=distributors[0].id),
        Retailer(name="Coastal Pantry", region="San Diego, CA", contact_email="info@coastalpantry.com", distributor_id=distributors[1].id),
        Retailer(name="Harbor Foods", region="Seattle, WA", contact_email="orders@harborfoods.com", distributor_id=distributors[1].id),
    ]
    await db.retailers.insert_many([r.model_dump() for r in retailers])

    # Distributor inventory (high stock)
    inv_docs = []
    for d in distributors:
        for p in products:
            inv_docs.append(InventoryItem(
                owner_type="distributor", owner_id=d.id, product_id=p.id,
                quantity=200 + (hash(d.id + p.id) % 300),
                reorder_level=50,
            ).model_dump())
    # Retailer inventory (lower stock, some low)
    for i, r in enumerate(retailers):
        for j, p in enumerate(products):
            q = 5 + ((i * 7 + j * 3) % 40)
            inv_docs.append(InventoryItem(
                owner_type="retailer", owner_id=r.id, product_id=p.id,
                quantity=q,
                reorder_level=15,
            ).model_dump())
    await db.inventory.insert_many(inv_docs)

    # Shipments — variety of statuses across the past 14 days
    shipments = []
    now = datetime.now(timezone.utc)
    statuses_plan = [
        ("received", 12), ("received", 10), ("received", 8),
        ("in_transit", 6), ("in_transit", 4),
        ("pending", 2), ("pending", 1), ("pending", 0),
        ("received", 5), ("in_transit", 3),
    ]
    for idx, (status, days_ago) in enumerate(statuses_plan):
        d = distributors[idx % len(distributors)]
        # pick a retailer belonging to this distributor
        retailer_pool = [r for r in retailers if r.distributor_id == d.id]
        r = retailer_pool[idx % len(retailer_pool)]
        # pick 1-3 random products
        chosen = products[idx % len(products): idx % len(products) + 2] or [products[0]]
        items = [ShipmentLine(product_id=p.id, quantity=10 + (idx + i) * 4).model_dump() for i, p in enumerate(chosen)]
        created = (now - timedelta(days=days_ago, hours=idx)).isoformat()
        sh = {
            "id": new_id(),
            "distributor_id": d.id,
            "retailer_id": r.id,
            "items": items,
            "status": status,
            "tracking_code": "SHP-" + uuid.uuid4().hex[:8].upper(),
            "notes": None,
            "created_at": created,
            "dispatched_at": (now - timedelta(days=max(days_ago - 1, 0))).isoformat() if status in ("in_transit", "received") else None,
            "received_at": (now - timedelta(days=max(days_ago - 2, 0))).isoformat() if status == "received" else None,
            "request_id": None,
        }
        shipments.append(sh)
    await db.shipments.insert_many(shipments)

    # A couple of pending requests
    req_docs = []
    req_docs.append(StockRequest(
        retailer_id=retailers[0].id, distributor_id=distributors[0].id,
        items=[RequestLine(product_id=products[0].id, quantity=30), RequestLine(product_id=products[3].id, quantity=50)],
        note="Weekend rush prep — please prioritize.",
    ).model_dump())
    req_docs.append(StockRequest(
        retailer_id=retailers[2].id, distributor_id=distributors[1].id,
        items=[RequestLine(product_id=products[4].id, quantity=24)],
        note="Running low after promotion.",
    ).model_dump())
    await db.requests.insert_many(req_docs)

    # Seed a few welcome notifications
    notifs = []
    for d in distributors:
        notifs.append(Notification(
            target_type="distributor", target_id=d.id,
            title="Welcome to Supply Hub",
            message=f"{d.name} workspace is ready. You have new stock requests waiting.",
            type="system",
        ).model_dump())
    for r in retailers:
        notifs.append(Notification(
            target_type="retailer", target_id=r.id,
            title="Workspace Ready",
            message=f"{r.name} is connected to its distributor. Browse inventory to get started.",
            type="system",
        ).model_dump())
    await db.notifications.insert_many(notifs)

    return {
        "ok": True,
        "distributors": len(distributors),
        "retailers": len(retailers),
        "products": len(products),
        "shipments": len(shipments),
        "requests": len(req_docs),
    }


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
async def auto_seed_if_empty():
    # If no distributors exist, seed automatically so the UI has content
    count = await db.distributors.count_documents({})
    if count == 0:
        logger.info("Empty DB detected — auto-seeding sample data.")
        await seed_data(reset=False)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
