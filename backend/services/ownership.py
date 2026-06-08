"""Shared helpers for the Phase 1+2 Ownership Model migration.

Today every read path filters by the legacy FKs (`manufacturer_id`,
`distributor_id`, `retailer_id`, `owner_id`, `from_id`). After Phase 1
backfilled `organization_id` on every existing row, new consumers can also
filter on the unified field.

This helper lets callers express the query as:

    await db.products.find(org_or_legacy("manufacturer_id", mfr_id))

which expands to a `$or` covering both the new and the legacy field. That
way it works for older rows (legacy FK only — though all rows should now
have org_id post-backfill) and for any hypothetical future row that only
has `organization_id`. It is a forward-compatibility cushion only — the
existing code paths still work untouched.
"""
from __future__ import annotations

from typing import Any, Dict


def org_or_legacy(legacy_field: str, org_id: str,
                  extra: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Return a Mongo filter that matches rows where EITHER the legacy FK
    OR `organization_id` equals `org_id`. Optional `extra` filter is AND'ed
    in (useful for status/date filters etc.).

    Example:
        org_or_legacy("retailer_id", retailer_id, {"status": "approved"})

    Result:
        {"$and": [
            {"$or": [
                {"retailer_id": retailer_id},
                {"organization_id": retailer_id},
            ]},
            {"status": "approved"},
        ]}
    """
    base: Dict[str, Any] = {
        "$or": [
            {legacy_field: org_id},
            {"organization_id": org_id},
        ],
    }
    if extra:
        return {"$and": [base, extra]}
    return base
