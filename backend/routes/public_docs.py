"""Public docs endpoint — serves the mobile-handoff Markdown briefs as
plain text so the mobile-agent (in a separate pod, no shared FS) can curl
them. No auth required; read-only; whitelist of paths only."""
from __future__ import annotations
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse

router = APIRouter()

# Whitelisted public docs. Keys are URL slugs, values are absolute paths
# inside this pod. Anything not in this map → 404.
_PUBLIC_DOCS: dict[str, str] = {
    "wholesaler-mobile-brief":     "/app/docs/WHOLESALER_MOBILE_BUILD_BRIEF.md",
    "wholesaler-functional":       "/app/docs/WHOLESALER_WORKSPACE_FUNCTIONAL_SPEC.md",
    "wholesaler-mobile-ux":        "/app/docs/WHOLESALER_MOBILE_UX_PLAN.md",
    "wholesaler-api-validation":   "/app/memory/wholesaler_api_validation.md",
    "retailer-functional":         "/app/docs/RETAILER_WORKSPACE_FUNCTIONAL_SPEC.md",
    "manufacturer-mobile-brief":   "/app/docs/MANUFACTURER_MOBILE_BUILD_BRIEF.md",
    "manufacturer-functional":     "/app/docs/MANUFACTURER_WORKSPACE_FUNCTIONAL_SPEC.md",
    "manufacturer-mobile-ux":      "/app/docs/MANUFACTURER_MOBILE_UX_PLAN.md",
    "manufacturer-api-validation": "/app/memory/manufacturer_api_validation.md",
    "distributor-mobile-brief":    "/app/docs/DISTRIBUTOR_MOBILE_BUILD_BRIEF.md",
    "distributor-functional":      "/app/docs/DISTRIBUTOR_WORKSPACE_FUNCTIONAL_SPEC.md",
    "distributor-mobile-ux":       "/app/docs/DISTRIBUTOR_MOBILE_UX_PLAN.md",
    "distributor-api-validation":  "/app/memory/distributor_api_validation.md",
    "logistics-validation-audit":  "/app/docs/LOGISTICS_VALIDATION_AUDIT.md",
    "logistics-foundation-design": "/app/docs/LOGISTICS_FOUNDATION_DESIGN.md",
    "otp-pod-architecture":        "/app/docs/OTP_POD_ARCHITECTURE.md",
    "driver-api-spec":             "/app/docs/DRIVER_API_SPEC.md",
    "fleet-management-spec":       "/app/docs/FLEET_MANAGEMENT_SPEC.md",
    "track-a-readiness":           "/app/docs/TRACK_A_READINESS_REPORT.md",
    "driver-mobile-brief":         "/app/docs/DRIVER_MOBILE_BUILD_BRIEF.md",
    "driver-mobile-ux":            "/app/docs/DRIVER_MOBILE_UX_PLAN.md",
    "driver-functional":           "/app/docs/DRIVER_WORKSPACE_FUNCTIONAL_SPEC.md",
    "driver-api-validation":       "/app/memory/driver_api_validation.md",
    "driver-mobile-deployment":    "/app/docs/DRIVER_MOBILE_DEPLOYMENT.md",
    "fleet-functional-spec":       "/app/docs/FLEET_MANAGEMENT_FUNCTIONAL_SPEC.md",
    "phase-b-b1-b2-validation":    "/app/docs/PHASE_B_B1_B2_VALIDATION_REPORT.md",
    "phase-b3-validation":         "/app/docs/PHASE_B3_VALIDATION_REPORT.md",
    "fleet-ux-architecture":       "/app/docs/FLEET_UX_ARCHITECTURE.md",
    "phase-b4-fleet-dashboard":    "/app/docs/PHASE_B4_FLEET_DASHBOARD_VALIDATION.md",
    "phase-2-3-4-validation":      "/app/docs/PHASE_2_3_4_VALIDATION.md",
    "phase-5-compliance-centre":   "/app/docs/PHASE_5_COMPLIANCE_CENTRE_VALIDATION.md",
}


@router.get("/public-docs", response_class=PlainTextResponse)
async def list_public_docs() -> str:
    """Index of available public docs — plain-text bullet list."""
    lines = ["# Public docs available", ""]
    for slug, abs_path in _PUBLIC_DOCS.items():
        exists = Path(abs_path).is_file()
        marker = "✓" if exists else "✗"
        lines.append(f"  {marker} /api/public-docs/{slug}   (-> {os.path.basename(abs_path)})")
    return "\n".join(lines) + "\n"


@router.get("/public-docs/{slug}", response_class=PlainTextResponse)
async def get_public_doc(slug: str) -> str:
    """Return the raw Markdown content of a whitelisted doc."""
    abs_path = _PUBLIC_DOCS.get(slug)
    if not abs_path:
        raise HTTPException(404, f"Unknown doc '{slug}'. "
                                  f"List at /api/public-docs")
    p = Path(abs_path)
    if not p.is_file():
        raise HTTPException(404, f"Doc '{slug}' is registered but the file "
                                  f"is missing on disk")
    return p.read_text(encoding="utf-8")
