"""Idempotent index management — Mongo-equivalent of schema migrations.

MongoDB is schemaless, so there are no DDL migrations. What matters for
correctness + scale is having the right indexes on the right collections.
This module is idempotent — running it twice is a no-op.
"""
from __future__ import annotations

from typing import List, Tuple

from pymongo import ASCENDING, DESCENDING

from core import db, logger

# (collection_name, [(field, direction)], options)
INDEX_SPECS: List[Tuple[str, list, dict]] = [
    # Master data
    ("manufacturers", [("id", ASCENDING)], {"unique": True, "name": "uniq_id"}),
    ("distributors", [("id", ASCENDING)], {"unique": True, "name": "uniq_id"}),
    ("distributors", [("manufacturer_id", ASCENDING)], {"name": "by_manufacturer"}),
    ("retailers", [("id", ASCENDING)], {"unique": True, "name": "uniq_id"}),
    ("retailers", [("distributor_id", ASCENDING)], {"name": "by_distributor"}),
    ("retailers", [("region", ASCENDING), ("city", ASCENDING)], {"name": "by_region_city"}),
    ("products", [("id", ASCENDING)], {"unique": True, "name": "uniq_id"}),
    ("products", [("sku", ASCENDING)], {"name": "by_sku"}),
    ("products", [("manufacturer_id", ASCENDING)], {"name": "by_manufacturer"}),

    # Hot path — inventory rollups
    ("inventory", [("owner_type", ASCENDING), ("owner_id", ASCENDING)], {"name": "by_owner"}),
    ("inventory", [("owner_type", ASCENDING), ("owner_id", ASCENDING), ("product_id", ASCENDING)],
     {"unique": True, "name": "uniq_owner_product"}),

    # Shipments
    ("shipments", [("id", ASCENDING)], {"unique": True, "name": "uniq_id"}),
    ("shipments", [("distributor_id", ASCENDING)], {"name": "by_distributor"}),
    ("shipments", [("retailer_id", ASCENDING)], {"name": "by_retailer"}),
    ("shipments", [("manufacturer_id", ASCENDING)], {"name": "by_manufacturer"}),
    ("shipments", [("to_role", ASCENDING), ("to_id", ASCENDING)], {"name": "by_destination"}),
    ("shipments", [("from_role", ASCENDING), ("from_id", ASCENDING)], {"name": "by_source"}),
    ("shipments", [("status", ASCENDING), ("created_at", DESCENDING)], {"name": "by_status_recent"}),

    # Requests
    ("requests", [("id", ASCENDING)], {"unique": True, "name": "uniq_id"}),
    ("requests", [("distributor_id", ASCENDING), ("status", ASCENDING)], {"name": "by_distributor_status"}),
    ("requests", [("retailer_id", ASCENDING), ("status", ASCENDING)], {"name": "by_retailer_status"}),

    # Notifications
    ("notifications", [("target_type", ASCENDING), ("target_id", ASCENDING), ("created_at", DESCENDING)],
     {"name": "by_target_recent"}),

    # Daily sales (analytics-heavy)
    ("daily_sales", [("retailer_id", ASCENDING), ("date", ASCENDING)], {"name": "by_retailer_date"}),
    ("daily_sales", [("product_id", ASCENDING), ("date", ASCENDING)], {"name": "by_product_date"}),

    # Sales Book (retailer POS)
    ("sales", [("id", ASCENDING)], {"unique": True, "name": "uniq_id"}),
    ("sales", [("retailer_id", ASCENDING), ("created_at", DESCENDING)], {"name": "by_retailer_recent"}),
    ("sales", [("retailer_id", ASCENDING), ("payment_method", ASCENDING)], {"name": "by_retailer_payment"}),
    ("sales", [("retailer_id", ASCENDING), ("payment_status", ASCENDING)], {"name": "by_retailer_status"}),
    ("sales", [("transaction_code", ASCENDING)], {"name": "by_tx_code"}),

    # Proactive Intelligence Layer
    ("intel_insights", [("tenant_id", ASCENDING), ("scope_role", ASCENDING), ("scope_id", ASCENDING), ("created_at", DESCENDING)], {"name": "by_tenant_scope_recent"}),
    ("intel_forecasts", [("tenant_id", ASCENDING), ("urgency", ASCENDING), ("days_remaining", ASCENDING)], {"name": "by_tenant_urgency_days"}),
    ("intel_forecasts", [("tenant_id", ASCENDING), ("distributor_id", ASCENDING)], {"name": "by_tenant_distributor"}),
    ("intel_forecasts", [("tenant_id", ASCENDING), ("retailer_id", ASCENDING)], {"name": "by_tenant_retailer"}),
    ("intel_alerts", [("tenant_id", ASCENDING), ("category", ASCENDING), ("created_at", DESCENDING)], {"name": "by_tenant_category"}),
    ("intel_alerts", [("tenant_id", ASCENDING), ("severity", ASCENDING)], {"name": "by_tenant_severity"}),
    ("intel_recommendations", [("tenant_id", ASCENDING), ("scope_role", ASCENDING), ("scope_id", ASCENDING)], {"name": "by_tenant_scope"}),
    ("intel_recommendations", [("tenant_id", ASCENDING), ("urgency", ASCENDING)], {"name": "by_tenant_urgency"}),
    ("intel_retailer_health", [("tenant_id", ASCENDING), ("churn_risk", ASCENDING)], {"name": "by_tenant_churn"}),
    ("intel_retailer_health", [("tenant_id", ASCENDING), ("distributor_id", ASCENDING)], {"name": "by_tenant_distributor"}),
    ("intel_delivery_eta", [("tenant_id", ASCENDING), ("risk", ASCENDING)], {"name": "by_tenant_risk"}),
    ("intel_executive_summaries", [("tenant_id", ASCENDING), ("scope_role", ASCENDING), ("scope_id", ASCENDING)], {"unique": True, "name": "uniq_tenant_scope"}),
    ("intel_external_signals", [("tenant_id", ASCENDING)], {"unique": True, "name": "uniq_tenant"}),

    # Auth
    ("users", [("id", ASCENDING)], {"unique": True, "name": "uniq_id"}),
    ("users", [("email", ASCENDING)], {"unique": True, "name": "uniq_email"}),
    ("users", [("role", ASCENDING), ("status", ASCENDING)], {"name": "by_role_status"}),
    ("users", [("manufacturer_id", ASCENDING)], {"name": "by_manufacturer"}),
    ("users", [("invitation_token", ASCENDING)],
     {"name": "by_invitation_token", "sparse": True}),
    ("users", [("reset_token", ASCENDING)], {"name": "by_reset_token", "sparse": True}),

    # Dashboard snapshots (Intelligence-style pre-aggregated payloads)
    ("dashboard_snapshots", [("key", ASCENDING)], {"unique": True, "name": "uniq_key"}),
    ("dashboard_snapshots", [("manufacturer_id", ASCENDING), ("kind", ASCENDING)],
     {"name": "by_manufacturer_kind"}),

    # Universal organizations + cross-tier relationships
    ("organizations", [("id", ASCENDING)], {"unique": True, "name": "uniq_id"}),
    ("organizations", [("organization_code", ASCENDING)], {"unique": True, "name": "uniq_code"}),
    ("organizations", [("organization_type", ASCENDING)], {"name": "by_type"}),
    ("organizations", [("parent_organization_id", ASCENDING)], {"name": "by_parent"}),
    ("organization_relationships", [("id", ASCENDING)], {"unique": True, "name": "uniq_id"}),
    ("organization_relationships", [("from_organization_id", ASCENDING), ("relationship_type", ASCENDING)], {"name": "by_from_type"}),
    ("organization_relationships", [("to_organization_id", ASCENDING), ("relationship_type", ASCENDING)], {"name": "by_to_type"}),

    # Phase 1+2 Ownership Model — additive `organization_id` indexes so the
    # unified field is queryable everywhere without touching legacy indexes.
    ("products",           [("organization_id", ASCENDING)], {"name": "by_organization"}),
    ("inventory",          [("organization_id", ASCENDING)], {"name": "by_organization"}),
    ("inventory",          [("warehouse_id",    ASCENDING)], {"name": "by_warehouse",
                                                              "sparse": True}),
    ("batches",            [("organization_id", ASCENDING)], {"name": "by_organization"}),
    ("promotions",         [("organization_id", ASCENDING)], {"name": "by_organization"}),
    ("purchase_orders",    [("organization_id", ASCENDING)], {"name": "by_organization"}),
    ("procurement_carts",  [("organization_id", ASCENDING)], {"name": "by_organization"}),
    ("supplier_quotes",    [("organization_id", ASCENDING)], {"name": "by_organization"}),
    ("distributor_orders", [("organization_id", ASCENDING)], {"name": "by_organization"}),
    ("requests",           [("organization_id", ASCENDING)], {"name": "by_organization"}),
    ("sales",              [("organization_id", ASCENDING)], {"name": "by_organization"}),
    ("daily_sales",        [("organization_id", ASCENDING)], {"name": "by_organization"}),
    ("shipments",          [("organization_id", ASCENDING)], {"name": "by_organization"}),
]


# Indexes that older deploys created but the current schema has replaced.
# They MUST be dropped before the new ones take effect — e.g. the legacy
# `uniq_tenant` unique index on intel_executive_summaries.tenant_id rejects
# the second (tenant, role, entity) summary with a DuplicateKeyError and
# 500s the exec-summary endpoint in production.
STALE_INDEXES: List[Tuple[str, str]] = [
    ("intel_executive_summaries", "uniq_tenant"),
]


async def _drop_stale_indexes() -> int:
    dropped = 0
    for coll, idx_name in STALE_INDEXES:
        try:
            info = await db[coll].index_information()
            if idx_name in info:
                await db[coll].drop_index(idx_name)
                dropped += 1
                logger.info("Dropped stale index %s.%s", coll, idx_name)
        except Exception as e:
            logger.warning("Stale index drop failed on %s.%s: %s", coll, idx_name, e)
    return dropped


async def ensure_indexes() -> dict:
    """Create all required indexes idempotently. Safe to run on every boot.

    Returns a summary with the count created vs already present.
    """
    stale_dropped = await _drop_stale_indexes()
    ensured, failed = 0, 0
    for coll, keys, opts in INDEX_SPECS:
        try:
            await db[coll].create_index(keys, **opts)
            ensured += 1
        except Exception as e:
            failed += 1
            logger.warning("Index ensure failed on %s %s: %s", coll, keys, e)
    return {
        "indexes_ensured": ensured,
        "indexes_failed": failed,
        "stale_dropped": stale_dropped,
        "total_specs": len(INDEX_SPECS),
    }
