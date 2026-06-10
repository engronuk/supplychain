"""BigQuery client + dataset/table bootstrap for the Real-Time Pulse system.

The dataset/table are created idempotently on first use:
    Dataset:  {GCP_PROJECT_ID}.{BIGQUERY_DATASET}
              (defaults: project-905e8cc5-7104-437c-825.pulse, europe-west2)

    Table:    sales_events
              schema   : region, product_id, distributor_id, units_sold,
                         value_naira, occurred_at, ingested_at, event_id
              partition: occurred_at (DAY)
              cluster  : region, product_id

Auth uses Application Default Credentials. In local/dev the
GOOGLE_APPLICATION_CREDENTIALS env var points to the SA JSON file. On Cloud
Run the attached service account is used automatically.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Any, Dict, List, Optional

from google.cloud import bigquery
from google.oauth2 import service_account

GCP_PROJECT_ID    = os.environ.get("GCP_PROJECT_ID", "")
BIGQUERY_DATASET  = os.environ.get("BIGQUERY_DATASET", "pulse")
BIGQUERY_LOCATION = os.environ.get("BIGQUERY_LOCATION", "europe-west2")
SA_PATH           = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")

TABLE_NAME        = "sales_events"
FULL_TABLE_ID     = f"{GCP_PROJECT_ID}.{BIGQUERY_DATASET}.{TABLE_NAME}"

_SCHEMA = [
    bigquery.SchemaField("event_id",       "STRING",    mode="REQUIRED"),
    bigquery.SchemaField("region",         "STRING",    mode="REQUIRED"),
    bigquery.SchemaField("product_id",     "STRING",    mode="REQUIRED"),
    bigquery.SchemaField("product_name",   "STRING",    mode="NULLABLE"),
    bigquery.SchemaField("distributor_id", "STRING",    mode="REQUIRED"),
    bigquery.SchemaField("retailer_id",    "STRING",    mode="NULLABLE"),
    bigquery.SchemaField("units_sold",     "INT64",     mode="REQUIRED"),
    bigquery.SchemaField("value_naira",    "NUMERIC",   mode="REQUIRED"),
    bigquery.SchemaField("latitude",       "FLOAT64",   mode="NULLABLE"),
    bigquery.SchemaField("longitude",      "FLOAT64",   mode="NULLABLE"),
    bigquery.SchemaField("occurred_at",    "TIMESTAMP", mode="REQUIRED"),
    bigquery.SchemaField("ingested_at",    "TIMESTAMP", mode="REQUIRED"),
    bigquery.SchemaField("manufacturer_id", "STRING",   mode="NULLABLE"),
]


@lru_cache(maxsize=1)
def get_client() -> Optional[bigquery.Client]:
    """Return a memoised BigQuery client, or None if GCP is not configured."""
    if not GCP_PROJECT_ID:
        return None
    if SA_PATH and os.path.exists(SA_PATH):
        creds = service_account.Credentials.from_service_account_file(SA_PATH)
        return bigquery.Client(project=GCP_PROJECT_ID, credentials=creds, location=BIGQUERY_LOCATION)
    # Fall back to ADC (Cloud Run attached service account).
    return bigquery.Client(project=GCP_PROJECT_ID, location=BIGQUERY_LOCATION)


def ensure_dataset_and_table() -> Dict[str, Any]:
    """Idempotently create the dataset + sales_events table. Safe to call on
    every backend boot."""
    client = get_client()
    if not client:
        return {"status": "skipped", "reason": "GCP not configured"}

    dataset_ref = f"{GCP_PROJECT_ID}.{BIGQUERY_DATASET}"
    ds = bigquery.Dataset(dataset_ref)
    ds.location = BIGQUERY_LOCATION
    ds.description = "TradeKonekt Real-Time Pulse — distributor/retailer sales events"
    client.create_dataset(ds, exists_ok=True)

    table = bigquery.Table(FULL_TABLE_ID, schema=_SCHEMA)
    table.time_partitioning = bigquery.TimePartitioning(
        type_=bigquery.TimePartitioningType.DAY, field="occurred_at",
    )
    table.clustering_fields = ["region", "product_id"]
    table.description = "Granular sales events — streaming inserts from /api/pulse/event"
    client.create_table(table, exists_ok=True)

    return {
        "status": "ready",
        "project": GCP_PROJECT_ID,
        "dataset": BIGQUERY_DATASET,
        "location": BIGQUERY_LOCATION,
        "table": FULL_TABLE_ID,
        "schema_fields": [f.name for f in _SCHEMA],
        "partition": "occurred_at (DAY)",
        "cluster":   ["region", "product_id"],
    }


def insert_events(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Streaming insert. Returns BQ error rows (empty list = success)."""
    client = get_client()
    if not client:
        raise RuntimeError("BigQuery client is not configured")
    return client.insert_rows_json(FULL_TABLE_ID, rows)


def run_query(query: str, params: Optional[List[bigquery.ScalarQueryParameter]] = None) -> List[Dict[str, Any]]:
    """Run a parameterised query and return rows as dicts."""
    client = get_client()
    if not client:
        raise RuntimeError("BigQuery client is not configured")
    job_config = bigquery.QueryJobConfig(query_parameters=params or [])
    job = client.query(query, job_config=job_config)
    return [dict(r) for r in job.result()]
