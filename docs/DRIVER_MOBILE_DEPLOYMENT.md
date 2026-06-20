# Driver Mobile App — Deployment URLs & Endpoint Reference

_Last updated: 2026-06-20_

This is the canonical handoff for the **Driver Mobile Agent** working in a
separate pod. Curl this doc on first sync, re-curl whenever the Track A
backend changes.

---

## 1. Base URLs

| Environment | Base URL | Purpose |
|---|---|---|
| **Production** | `https://supply-chain-hub-189.emergent.host` | Real users. ⚠️ May lag behind Preview if Deploy hasn't been clicked. |
| **Preview / Staging** | `https://supply-chain-hub-189.preview.emergentagent.com` | Latest Track A backend (8-state lifecycle + OTP PoD). Use for integration tests. |

All API routes are prefixed with **`/api`**. There is no `/api/health` route —
health-probe with `POST /api/auth/login` and an empty body; expect HTTP `422`
(not `404`).

---

## 2. Spec docs (no auth, plain-text Markdown)

```bash
BASE=https://supply-chain-hub-189.emergent.host   # or the preview URL

curl $BASE/api/public-docs                          # index of all docs
curl $BASE/api/public-docs/driver-mobile-brief      # P0 build brief
curl $BASE/api/public-docs/driver-mobile-ux         # IA + screens + flows
curl $BASE/api/public-docs/driver-functional        # functional spec
curl $BASE/api/public-docs/driver-api-validation    # endpoint validation matrix
curl $BASE/api/public-docs/driver-api-spec          # canonical API contract
curl $BASE/api/public-docs/otp-pod-architecture     # OTP PoD design
curl $BASE/api/public-docs/track-a-readiness        # green-light gate report
curl $BASE/api/public-docs/driver-mobile-deployment # this file
```

---

## 3. Auth

```http
POST /api/auth/login
Content-Type: application/json
{ "email": "<driver_email>", "password": "<password>" }
→ 200 { "access_token": "<JWT>", "token_type": "bearer", "user": {...} }
```

- Send `Authorization: Bearer <access_token>` on every subsequent request.
- JWT carries `role`, `entity_id` (driver id), and `manufacturer_id`
  (employer org).
- JWT TTL: **24 h**. No refresh endpoint yet — re-login when it expires.

### Preview test credentials
- Driver email: `adaeze.w0+26275@tradekonekt.io`
- driver_code: `DRV-W0-11542`
- Password (universal): `TradeKonekt2026!`

### Starter vehicle (auto-seeded in the driver's fleet)
- vehicle_code: `TK-W0-V001`
- registration_number: `LAG-W0-001`
- make/model: Mercedes-Benz Actros 2645
- capacity: 1,000 units / 15,000 kg
- status: `available`

Both rows are created/repaired on every backend boot by
`services/seed_test_driver.py`. To assign this vehicle on a shipment, the
dispatcher hits `POST /api/shipments/{id}/assign` with the driver_id +
vehicle_id pair returned by `GET /api/drivers` and `GET /api/vehicles`.

### One-call test-shipment factory

Spin up a fresh `ready_for_dispatch` shipment wired to the test driver +
vehicle in a single call (auth: super_admin or manufacturer admin):

```bash
TOKEN=$(curl -s $BASE/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"unilever@tradekonekt.io","password":"TradeKonekt2026!"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

curl -s -X POST $BASE/api/_admin/seed-track-a-shipment \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Response:

```json
{
  "shipment": { "id": "<new shipment id>", "status": "ready_for_dispatch", ... },
  "next_steps": {
    "assign": "POST /api/shipments/<id>/assign with body {driver_id, vehicle_id}",
    "driver_id": "<uuid>",
    "driver_code": "DRV-W0-11542",
    "vehicle_id": "<uuid>",
    "vehicle_code": "TK-W0-V001",
    "destination": { "distributor_id": "<uuid>", "name": "...", "region": "Lagos" }
  }
}
```

Optional body fields:
- `to_distributor_id` — explicit destination (must belong to the same
  manufacturer)
- `items` — list of `{"sku" | "product_id", "quantity"}` overrides
- `notes` — free-text shown in dispatch UI

Every call mints a **new** shipment — not idempotent on purpose so QA can
run repeated dry-runs.

---

## 4. Driver-scoped endpoints (token role must be `driver`)

### 4.1 Profile & presence
| Method | Path | Purpose |
|---|---|---|
| `GET`    | `/api/driver/me` | Full driver profile + current assignment refs |
| `PATCH`  | `/api/driver/me` | Update phone / licence fields |
| `POST`   | `/api/driver/me/online` | Go on shift |
| `POST`   | `/api/driver/me/offline` | End shift |
| `POST`   | `/api/driver/me/location` | Location heartbeat (call every 10–30 s while on-trip) |

`/api/driver/me/location` body:
```json
{ "lat": 6.5244, "lng": 3.3792, "speed_kmh": 38.4, "heading": 142.0 }
```

### 4.2 Shipment queue
| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/driver/shipments` | All shipments assigned to me. Optional `?status=…` filter. |
| `GET`  | `/api/driver/shipments/{shipment_id}` | Detail: items, stops, history |
| `POST` | `/api/driver/shipments/{shipment_id}/accept` | Driver accepts assignment |
| `POST` | `/api/driver/shipments/{shipment_id}/reject` | Driver declines; shipment returns to `ready_for_dispatch`, driver/vehicle freed |

### 4.3 Lifecycle transitions (8-state machine)

`created → ready_for_dispatch → assigned → loaded → in_transit → arrived → delivered`
(`cancelled` reachable from any state before `delivered`).

| Method | Path | Moves shipment from → to |
|---|---|---|
| `POST` | `/api/shipments/{id}/load` | `assigned → loaded` |
| `POST` | `/api/shipments/{id}/start-trip` | `loaded → in_transit` |
| `POST` | `/api/shipments/{id}/arrive` | `in_transit → arrived` |
| `POST` | `/api/shipments/{id}/generate-delivery-code` | `arrived` — fires a 4-digit OTP into the **receiver's** in-app inbox. Body (optional): `{"channel":"in_app"}`. Returns `{"expires_at":"…"}`. **The code is NEVER returned to the driver.** |
| `POST` | `/api/shipments/{id}/deliver` | `arrived → delivered`. Body: `{ "delivery_code": "1234", "signature_image_url"?: "…", "notes"?: "…" }` |

### 4.4 Notifications (receiver uses these to read the OTP)
| Method | Path | Purpose |
|---|---|---|
| `GET`   | `/api/notifications` | Auth user's inbox |
| `PATCH` | `/api/notifications/{notif_id}/read` | Mark one read |
| `PATCH` | `/api/notifications/read-all` | Bulk mark read |

---

## 5. End-to-end smoke test (Preview)

```bash
BASE=https://supply-chain-hub-189.preview.emergentagent.com
TOKEN=$(curl -s $BASE/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"adaeze.w0+26275@tradekonekt.io","password":"TradeKonekt2026!"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

curl -s $BASE/api/driver/me           -H "Authorization: Bearer $TOKEN"
curl -s $BASE/api/driver/shipments    -H "Authorization: Bearer $TOKEN"
```

Expected: HTTP 200 on both, driver document showing
`status: "available"`, `assigned_shipment_id: null`.

---

## 6. Critical contract notes (read before coding)

1. **OTP secrecy** — the driver app must NEVER display or store the plain
   OTP. The driver enters what the receiver tells them on `POST /deliver`.
   The receiver reads the OTP from `GET /api/notifications`.
2. **Rate limit on `/deliver`** — 5 failed attempts in 15 min → HTTP `429`.
   UI must surface a clear countdown.
3. **Idempotent transitions** — each lifecycle endpoint returns `409
   Conflict` if called from a wrong state. Mobile must reconcile by
   re-fetching `/api/driver/shipments/{id}` and rendering whatever state
   the server reports.
4. **Location heartbeat** — backend stamps the driver's last-known
   position used by the Logistics Control Tower live map. Stop sending
   when offline.
5. **Token expiry** — 24 h TTL. On `401`, force re-login.

---

## 7. Production deploy gate

If the production smoke test for OTP fails silently (driver sees PoD
screen but receiver inbox is empty):
- The latest `services/otp.py` + `routes/notifications.py` are only on
  Preview. Click **Deploy** in the Emergent UI to push them to production.
- After deploy, also re-run the v2 cascade migration on production:
  ```bash
  PYTHONPATH=/app/backend python /app/backend/scripts/migrate_logistics_v2.py
  ```
  It's idempotent — safe to run anywhere, anytime.
