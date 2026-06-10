"""One-shot migration: local MongoDB → MongoDB Atlas on GCP Belgium.

Strategy: stream every collection in batches of 1000 docs using PyMongo
bulk inserts. No transformation — we keep the document shape identical so
zero application code changes are required afterwards.

Safety:
  • Only writes to a fresh `test_database` namespace on the destination.
  • Refuses to run if the destination already has any of our app collections
    populated, unless ALLOW_OVERWRITE=1 is set.
  • Prints per-collection counts source vs destination for verification.
"""

from __future__ import annotations

import os
import sys
import time
from pymongo import MongoClient

SRC_URL = os.environ.get("SRC_MONGO_URL", "mongodb://localhost:27017")
DST_URL = os.environ.get("DST_MONGO_URL")
DB_NAME = os.environ.get("DB_NAME", "test_database")
BATCH   = 1000
ALLOW_OVERWRITE = os.environ.get("ALLOW_OVERWRITE") == "1"

if not DST_URL:
    print("DST_MONGO_URL is required"); sys.exit(2)

src = MongoClient(SRC_URL)[DB_NAME]
dst = MongoClient(DST_URL, serverSelectionTimeoutMS=15000)[DB_NAME]

collections = sorted(src.list_collection_names())
print(f"Source DB={DB_NAME!r} has {len(collections)} collections")

# Pre-flight: refuse to clobber populated destination
if not ALLOW_OVERWRITE:
    for c in collections:
        if dst[c].estimated_document_count() > 0:
            print(f"FAIL: destination already has data in '{c}'. Re-run with ALLOW_OVERWRITE=1 to drop+copy.")
            sys.exit(3)

t0 = time.time()
totals_src, totals_dst = 0, 0
for c in collections:
    n = src[c].estimated_document_count()
    totals_src += n
    if n == 0:
        print(f"  {c:35s} 0 docs (skip)")
        continue

    if ALLOW_OVERWRITE:
        dst[c].drop()

    # Stream in batches
    cursor = src[c].find({}, no_cursor_timeout=False).batch_size(BATCH)
    buf = []
    written = 0
    for doc in cursor:
        buf.append(doc)
        if len(buf) >= BATCH:
            dst[c].insert_many(buf, ordered=False)
            written += len(buf)
            buf.clear()
    if buf:
        dst[c].insert_many(buf, ordered=False)
        written += len(buf)
    cursor.close()

    # Copy indexes (best-effort)
    try:
        for idx in src[c].list_indexes():
            if idx["name"] == "_id_":
                continue
            spec = list(idx["key"].items())
            kwargs = {k: v for k, v in idx.items() if k in ("unique", "sparse", "name")}
            dst[c].create_index(spec, **kwargs)
    except Exception as e:
        print(f"    (index warning on {c}: {e})")

    dst_n = dst[c].estimated_document_count()
    totals_dst += dst_n
    status = "OK" if dst_n == n else f"MISMATCH ({n} src vs {dst_n} dst)"
    print(f"  {c:35s} {n:>8} → {dst_n:<8} {status}")

elapsed = time.time() - t0
print(f"\nDone in {elapsed:.1f}s — total docs: src={totals_src}  dst={totals_dst}")
print("Match:", totals_src == totals_dst)
