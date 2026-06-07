"""Pydantic models for all collections + request/response payloads."""
from __future__ import annotations

import uuid
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from core import PartyRole, RequestStatus, ShipmentStatus, new_id, now_iso


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
    velocity: float = 0.0
    updated_at: str = Field(default_factory=now_iso)


class ShipmentLine(BaseModel):
    product_id: str
    quantity: int


class Shipment(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    from_role: PartyRole
    from_id: str
    to_role: PartyRole
    to_id: str
    # Denormalized convenience fields for back-compat with existing UI/queries:
    distributor_id: str = ""
    retailer_id: str = ""
    manufacturer_id: str = ""
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
    type: Literal["shipment", "request", "inventory", "system", "order"] = "system"
    read: bool = False
    created_at: str = Field(default_factory=now_iso)


# ---- Retailer OS / Assistant payloads -----
class QuickReorderPayload(BaseModel):
    shipment_id: Optional[str] = None
    items: Optional[List[dict]] = None  # [{product_id, quantity}]
    note: Optional[str] = None


class AssistantMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AssistantPayload(BaseModel):
    message: str
    history: List[AssistantMessage] = Field(default_factory=list)
    session_id: Optional[str] = None


class AssistantActionPayload(BaseModel):
    action: dict


# ---- Sales (Retailer Sales Book) ----
class SaleLineItem(BaseModel):
    product_id: str
    quantity: int
    unit_price: float


class SaleCreate(BaseModel):
    items: List[SaleLineItem]
    payment_method: Literal["cash", "transfer", "pos", "credit"]
    customer_name: Optional[str] = ""
    attendant: Optional[str] = ""
    notes: Optional[str] = ""


class SaleMarkPaid(BaseModel):
    payment_method: Literal["cash", "transfer", "pos"] = "cash"



# ---- Procurement (Cart, Purchase Orders, Quotes) ----------------------------
from core import POStatus, QuoteStatus  # noqa: E402


class CartItem(BaseModel):
    product_id: str
    distributor_id: str
    quantity: int
    unit_cost: float


class Cart(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    retailer_id: str
    items: List[CartItem] = Field(default_factory=list)
    note: Optional[str] = None
    updated_at: str = Field(default_factory=now_iso)


class CartItemUpsert(BaseModel):
    product_id: str
    distributor_id: str
    quantity: int = Field(ge=1)
    unit_cost: float = Field(ge=0)


class CartItemUpdate(BaseModel):
    quantity: int = Field(ge=1)


class POLine(BaseModel):
    product_id: str
    quantity: int
    unit_cost: float = 0.0
    line_total: float = 0.0


class StatusEvent(BaseModel):
    status: POStatus
    at: str = Field(default_factory=now_iso)
    by: Optional[str] = None
    note: Optional[str] = None


class PurchaseOrder(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    po_number: str
    retailer_id: str
    distributor_id: str
    items: List[POLine]
    total_amount: float = 0.0
    status: POStatus = "draft"
    note: Optional[str] = None
    cancel_reason: Optional[str] = None
    reject_reason: Optional[str] = None
    shipment_id: Optional[str] = None
    duplicate_of: Optional[str] = None
    status_history: List[StatusEvent] = Field(default_factory=list)
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)
    submitted_at: Optional[str] = None
    approved_at: Optional[str] = None
    processed_at: Optional[str] = None
    shipped_at: Optional[str] = None
    delivered_at: Optional[str] = None
    cancelled_at: Optional[str] = None


class PurchaseOrderCreate(BaseModel):
    retailer_id: str
    distributor_id: str
    items: List[CartItemUpsert]
    note: Optional[str] = None


class POAction(BaseModel):
    reason: Optional[str] = None


class QuoteResponse(BaseModel):
    distributor_id: str
    unit_price: float
    lead_time_days: int
    moq: int
    valid_until: str
    notes: Optional[str] = None
    responded_at: str = Field(default_factory=now_iso)


class SupplierQuote(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    quote_number: str
    retailer_id: str
    product_id: str
    quantity: int
    distributor_ids: List[str]
    responses: List[QuoteResponse] = Field(default_factory=list)
    status: QuoteStatus = "open"
    note: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    closed_at: Optional[str] = None


class QuoteCreate(BaseModel):
    retailer_id: str
    product_id: str
    quantity: int = Field(ge=1)
    distributor_ids: List[str] = Field(min_length=1)
    note: Optional[str] = None


class QuoteRespondPayload(BaseModel):
    distributor_id: str
    unit_price: float = Field(ge=0)
    lead_time_days: int = Field(ge=0)
    moq: int = Field(ge=1)
    valid_until: str  # ISO date
    notes: Optional[str] = None
