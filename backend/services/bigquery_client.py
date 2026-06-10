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

BIGQUERY_DATASET  = os.environ.get("BIGQUERY_DATASET", "pulse")
BIGQUERY_LOCATION = os.environ.get("BIGQUERY_LOCATION", "europe-west2")
TABLE_NAME        = "sales_events"


# ---------------------------------------------------------------------------
# Runtime helpers — read env at CALL time so values reflect Cloud Run config
# even if the module was imported before the env was injected.
# ---------------------------------------------------------------------------
def _project_id() -> str:
    """Resolve the GCP project id, supporting both env var names."""
    return (
        os.environ.get("GCP_PROJECT_ID")
        or os.environ.get("GOOGLE_CLOUD_PROJECT")
        or ""
    )


def _running_on_cloud_run() -> bool:
    """Cloud Run sets K_SERVICE automatically — best signal we're in prod."""
    return bool(os.environ.get("K_SERVICE") or os.environ.get("CLOUD_RUN_JOB"))


def _sa_key_path() -> str:
    """Return the SA JSON path ONLY for local dev. On Cloud Run we always
    use the attached service account via Application Default Credentials."""
    if _running_on_cloud_run():
        return ""
    path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
    return path if path and os.path.exists(path) else ""


def full_table_id() -> str:
    return f"{_project_id()}.{BIGQUERY_DATASET}.{TABLE_NAME}"


# Back-compat module attribute (used by callers that imported the constant).
# Note: this snapshot is fine for the table id label, but always prefer
# full_table_id() in new code.
FULL_TABLE_ID = full_table_id()


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
    """Return a memoised BigQuery client.

    Auth strategy:
        • On Cloud Run (`K_SERVICE` is set) → always use ADC = the attached
          service account. The SA JSON file is ignored even if it happens to
          exist on disk.
        • Locally → use the SA JSON file pointed to by
          GOOGLE_APPLICATION_CREDENTIALS if present, else ADC.
    """
    project = _project_id()
    if not project:
        return None
    sa_path = _sa_key_path()
    if sa_path:
        creds = service_account.Credentials.from_service_account_file(sa_path)
        return bigquery.Client(project=project, credentials=creds, location=BIGQUERY_LOCATION)
    # Cloud Run path → ADC picks up the attached SA automatically.
    return bigquery.Client(project=project, location=BIGQUERY_LOCATION)


def ensure_dataset_and_table() -> Dict[str, Any]:
    """Idempotently create the dataset + sales_events table. Safe to call on
    every backend boot."""
    client = get_client()
    if not client:
        return {"status": "skipped", "reason": "GCP not configured"}

    project     = _project_id()
    dataset_ref = f"{project}.{BIGQUERY_DATASET}"
    ds = bigquery.Dataset(dataset_ref)
    ds.location = BIGQUERY_LOCATION
    ds.description = "TradeKonekt Real-Time Pulse — distributor/retailer sales events"
    client.create_dataset(ds, exists_ok=True)

    table = bigquery.Table(full_table_id(), schema=_SCHEMA)
    table.time_partitioning = bigquery.TimePartitioning(
        type_=bigquery.TimePartitioningType.DAY, field="occurred_at",
    )
    table.clustering_fields = ["region", "product_id"]
    table.description = "Granular sales events — streaming inserts from /api/pulse/event"
    client.create_table(table, exists_ok=True)

    return {
        "status": "ready",
        "project": project,
        "dataset": BIGQUERY_DATASET,
        "location": BIGQUERY_LOCATION,
        "table": full_table_id(),
        "schema_fields": [f.name for f in _SCHEMA],
        "partition": "occurred_at (DAY)",
        "cluster":   ["region", "product_id"],
        "auth_mode": "adc-cloud-run" if _running_on_cloud_run() else ("sa-file" if _sa_key_path() else "adc-local"),
    }


def insert_events(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Streaming insert. Returns BQ error rows (empty list = success)."""
    client = get_client()
    if not client:
        raise RuntimeError("BigQuery client is not configured")
    return client.insert_rows_json(full_table_id(), rows)


def run_query(query: str, params: Optional[List[bigquery.ScalarQueryParameter]] = None) -> List[Dict[str, Any]]:
    """Run a parameterised query and return rows as dicts."""
    client = get_client()
    if not client:
        raise RuntimeError("BigQuery client is not configured")
    job_config = bigquery.QueryJobConfig(query_parameters=params or [])
    job = client.query(query, job_config=job_config)
    return [dict(r) for r in job.result()]
