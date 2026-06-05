"""File-upload helpers — product images, etc.

Stores uploaded assets under ``/app/backend/static/uploads`` and exposes them
through the static mount at ``/api/static/...``. Returned URLs are relative
so the frontend can prepend its REACT_APP_BACKEND_URL.
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

router = APIRouter()

UPLOAD_ROOT = Path(__file__).resolve().parent.parent / "static" / "uploads"
PRODUCT_DIR = UPLOAD_ROOT / "products"
PRODUCT_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
MAX_BYTES = 5 * 1024 * 1024  # 5 MB


@router.post("/uploads/product-image")
async def upload_product_image(file: UploadFile = File(...)):
    """Persist a product image and return a public-relative URL.

    Response: ``{"image_url": "/api/static/uploads/products/<uuid>.<ext>"}``.
    """
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTS:
        raise HTTPException(400, f"Unsupported extension {ext!r}. Allowed: {sorted(ALLOWED_EXTS)}")

    blob = await file.read()
    if len(blob) == 0:
        raise HTTPException(400, "Empty upload")
    if len(blob) > MAX_BYTES:
        raise HTTPException(400, f"File too large ({len(blob)} bytes > {MAX_BYTES})")

    fname = f"{uuid.uuid4().hex}{ext}"
    dest = PRODUCT_DIR / fname
    dest.write_bytes(blob)

    return {"image_url": f"/api/static/uploads/products/{fname}"}
