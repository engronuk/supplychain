"""Manual runner for the Track A test-driver seed.

Idempotent. Safe to run against any environment. Pulls the same logic that
runs on backend startup but exposes it as a CLI for production operators:

    PYTHONPATH=/app/backend python /app/backend/scripts/seed_test_driver.py

The script honors the same DEMO_PASSWORD env var as the rest of the
demo-data seeders. Will skip cleanly with a printed reason if the env is
missing or the target DB has no manufacturer rows yet.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# allow `python scripts/seed_test_driver.py` from anywhere
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.seed_test_driver import seed_test_driver  # noqa: E402


if __name__ == "__main__":
    print("Seeding Track A test driver…", flush=True)
    result = asyncio.run(seed_test_driver())
    print(f"Result: {result}")
    print("Done.")
