"""Seed 14 days of synthetic sales events into BigQuery pulse.sales_events.

Realistic patterns:
  - 4 Nigerian regions with distinct baselines (Lagos ≫ Abuja > Kano > PH)
  - A planted demand SPIKE in the last 24h on (Lagos, AXE) and (Abuja, KNORR)
    so the velocity-ratio alert query has signal to find.
  - Per-region lat/lng for the map.
  - Tagged with manufacturer_id so multi-tenant scoping holds.

Idempotent: deletes prior rows tagged `pulse_seed_v1` before re-inserting.
"""

from __future__ import annotations

import os
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from services.bigquery_client import (
    ensure_dataset_and_table, full_table_id, get_client, insert_events,
)

REGIONS = [
    ("Lagos",         6.5244, 3.3792,  6.0),
    ("Abuja",         9.0765, 7.3986,  3.0),
    ("Kano",         12.0022, 8.5920,  2.0),
    ("Port Harcourt", 4.8156, 7.0498,  1.5),
]
PRODUCTS = [
    ("UL-AXE-BODY-SPRAY",       "Axe Body Spray",       21080),
    ("UL-LUX-BEAUTY-SOAP",      "LUX Beauty Soap",        950),
    ("UL-BLUE-BAND-MARGARIN",   "Blue Band Margarine",   2200),
    ("UL-KNORR-CUBES",          "Knorr Bouillon Cubes",   850),
    ("UL-CLOSE-UP-TOOTHPASTE",  "Close-Up Toothpaste",   1300),
    ("UL-OMO-DETERGENT",        "OMO Detergent",         4200),
    ("UL-PEPSODENT",            "Pepsodent",             1700),
]
MFR_ID = os.environ.get("PULSE_SEED_MFR_ID", "b21c1dbe-1a6f-4c33-b036-f416579455d0")

SEED_TAG = "pulse_seed_v1"


def main() -> Dict[str, Any]:
    random.seed(2026)
    client = get_client()
    if client is None:
        return {"status": "skipped", "reason": "GCP not configured"}
    ensure_dataset_and_table()

    table = full_table_id()
    # Purge previous run
    q = f"DELETE FROM `{table}` WHERE manufacturer_id = '{MFR_ID}' AND retailer_id = '{SEED_TAG}'"
    try:
        client.query(q).result()
    except Exception:
        pass  # streaming buffer rows can't be DML-deleted; tolerate it

    now = datetime.now(timezone.utc)
    batch: List[Dict[str, Any]] = []

    for region, lat, lng, scale in REGIONS:
        for day_offset in range(14, 0, -1):
            day = now - timedelta(days=day_offset)
            for product_id, product_name, price in PRODUCTS:
                # Daily event count for this (region, product) — Poisson-ish
                base = max(1, int(random.gauss(8 * scale, 2 * scale)))
                for _ in range(base):
                    event_time = day.replace(
                        hour=random.randint(7, 20),
                        minute=random.randint(0, 59),
                        second=random.randint(0, 59),
                    )
                    units = random.randint(50, 600)
                    batch.append({
                        "event_id": str(uuid.uuid4()),
                        "region": region,
                        "product_id": product_id,
                        "product_name": product_name,
                        "distributor_id": f"{region.lower().replace(' ','-')}-dist",
                        "retailer_id": SEED_TAG,  # used as marker for cleanup
                        "units_sold": units,
                        "value_naira": str(units * price),
                        "latitude":  lat + random.uniform(-0.04, 0.04),
                        "longitude": lng + random.uniform(-0.04, 0.04),
                        "occurred_at": event_time.isoformat(),
                        "ingested_at": now.isoformat(),
                        "manufacturer_id": MFR_ID,
                    })

    # Planted spike in last 24h to guarantee an alert fires
    for spike_region, spike_pid, spike_name, spike_price, lat, lng in [
        ("Lagos", "UL-AXE-BODY-SPRAY", "Axe Body Spray", 21080, 6.5244, 3.3792),
        ("Abuja", "UL-KNORR-CUBES",    "Knorr Bouillon Cubes", 850, 9.0765, 7.3986),
    ]:
        for _ in range(60):  # 3x normal volume
            event_time = now - timedelta(hours=random.randint(0, 23))
            units = random.randint(400, 900)
            batch.append({
                "event_id": str(uuid.uuid4()),
                "region": spike_region,
                "product_id": spike_pid,
                "product_name": spike_name,
                "distributor_id": f"{spike_region.lower()}-dist",
                "retailer_id": SEED_TAG,
                "units_sold": units,
                "value_naira": str(units * spike_price),
                "latitude": lat + random.uniform(-0.04, 0.04),
                "longitude": lng + random.uniform(-0.04, 0.04),
                "occurred_at": event_time.isoformat(),
                "ingested_at": now.isoformat(),
                "manufacturer_id": MFR_ID,
            })

    # BigQuery streaming insert is capped at 10 MB / 500 rows per call
    inserted = 0
    for i in range(0, len(batch), 400):
        chunk = batch[i:i+400]
        err = insert_events(chunk)
        if err:
            return {"status": "failed", "errors": err[:3]}
        inserted += len(chunk)

    return {"status": "seeded", "rows_inserted": inserted, "regions": [r[0] for r in REGIONS]}


if __name__ == "__main__":
    print(main())
