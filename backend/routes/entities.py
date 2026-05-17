"""Entity directory endpoints (manufacturers, distributors, retailers, products)."""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter

from core import db
from models import Distributor, Manufacturer, Product, Retailer

router = APIRouter()


@router.get("/")
async def root():
    return {"message": "TradeKonekt API", "status": "ok"}


@router.get("/manufacturers", response_model=List[Manufacturer])
async def list_manufacturers():
    return await db.manufacturers.find({}, {"_id": 0}).to_list(100)


@router.get("/distributors", response_model=List[Distributor])
async def list_distributors(manufacturer_id: Optional[str] = None):
    q = {"manufacturer_id": manufacturer_id} if manufacturer_id else {}
    return await db.distributors.find(q, {"_id": 0}).sort("name", 1).to_list(2000)


@router.get("/retailers", response_model=List[Retailer])
async def list_retailers(distributor_id: Optional[str] = None):
    q = {"distributor_id": distributor_id} if distributor_id else {}
    return await db.retailers.find(q, {"_id": 0}).sort("name", 1).to_list(20000)


@router.get("/products", response_model=List[Product])
async def list_products(manufacturer_id: Optional[str] = None):
    q = {"manufacturer_id": manufacturer_id} if manufacturer_id else {}
    return await db.products.find(q, {"_id": 0}).sort("name", 1).to_list(2000)
