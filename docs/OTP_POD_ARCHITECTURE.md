# OTP-Based Proof of Delivery — Architecture

**Design date:** 2026-06-20  
**Status:** DRAFT for sign-off (no code written)  
**Parent doc:** `LOGISTICS_FOUNDATION_DESIGN.md`  
**Scope:** Track A5 — OTP delivery code lifecycle, generation, distribution, validation, security, audit.

---

## 0. Locked decisions

| # | Topic | Decision |
|---|---|---|
| 1 | POD method | **OTP only.** No photo, no signature, no GPS-stamp as primary proof. |
| 2 | OTP delivery channel | **In-app notification** to the receiver org's authenticated users (`/api/notifications`). SMS deferred to P2. |
| 3 | OTP format | **4-digit numeric** (10,000 combinations — sufficient with rate-limiting + expiry). |
| 4 | OTP storage | **Hashed** (bcrypt) at rest. Clear-text exists only in-memory during generation + in the in-app notification payload. |
| 5 | OTP scope | **Per shipment.** Code is unique within (`shipment_id`, validity window). |

---

## 1. End-to-end flow

```
  ┌──────────────────────┐
  │ Dispatcher / Driver  │
  │   triggers "Assign"  │
  └──────────┬───────────┘
             │
             │ Shipment moves to "assigned"
             ▼
  ┌─────────────────────────────────────────────┐
  │ System auto-runs `generate-delivery-code`   │
  │  ─ generates 4-digit code                    │
  │  ─ hashes + stores in shipment doc           │
  │  ─ sends in-app notification to receiver     │
  │    org's users with the clear-text code      │
  └──────────────────────┬──────────────────────┘
                         │
                         │ Driver loads / starts-trip / arrives
                         ▼
  ┌─────────────────────────────────────────────┐
  │ Driver on mobile: shipment → "Mark Delivered"│
  │  ─ asks driver to enter 4-digit code         │
  │  ─ receiver gives them the code in person    │
  │  ─ driver enters code → POST .../deliver     │
  └──────────────────────┬──────────────────────┘
                         │
                         │ Backend verifies (bcrypt compare)
                         ▼
  ┌──────────────────────┴──────────────────────┐
  │ ✅ Match → shipment.status="delivered"        │
  │           delivery_code_verified_at = now     │
  │           credit `to_id` inventory            │
  │           notify dispatcher + receiver        │
  │ ❌ Mismatch → attempts++; HTTP 401            │
  │              if attempts ≥ 5 → lock 10 min    │
  └─────────────────────────────────────────────┘
```

---

## 2. Code lifecycle

| Stage | What happens | Field set |
|---|---|---|
| **Generated** | When shipment transitions `ready_for_dispatch → assigned`, the backend auto-invokes `/generate-delivery-code`. Random `secrets.randbelow(10000)` → zero-padded `0000`..`9999`. | `delivery_code` (bcrypt hash) · `delivery_code_generated_at` (ISO) · `delivery_code_attempts=0` |
| **Delivered to receiver** | An in-app notification is created for **every active user** of the receiver org (`to_id`). Notification `type="delivery_code"`, `payload={shipment_id, tracking_code, delivery_code: "XXXX"}`. Notifications are scoped — only users with `read:notifications` for the receiver org see them. | (none on shipment) |
| **Driver attempts verification** | Driver submits the 4-digit code via `POST /api/shipments/{id}/deliver`. Backend bcrypt-compares; if match → `delivered`; if mismatch → `delivery_code_attempts += 1`. | `delivery_code_attempts` increments |
| **Locked** | After 5 failed attempts, code is locked for 10 minutes. Dispatcher can regenerate manually. | `delivery_code_locked_until` (ISO) |
| **Expired** | Code expires 7 days after generation (configurable env: `OTP_TTL_DAYS=7`). After expiry, deliver call returns 410 Gone and dispatcher must regenerate. | `delivery_code_expires_at` (ISO) |
| **Verified** | On match. | `delivery_code_verified_at` (ISO) · `delivered_by=<driver_id>` · status → `delivered` |
| **Regenerated** | Dispatcher invokes `/generate-delivery-code` again — replaces hash, resets `attempts=0`, sends fresh notification, archives the old code in `delivery_code_history[]`. | hash replaced + history appended |
| **Cancelled** | Shipment cancelled → code voided. New deliver attempts return 409. | (no change) |

---

## 3. Data fields on Shipment doc

Already itemised in `LOGISTICS_FOUNDATION_DESIGN.md` §2; expanded here:

```python
# OTP-related fields on Shipment
delivery_code:                Optional[str] = None     # bcrypt hash, NEVER returned in any API
delivery_code_generated_at:   Optional[str] = None
delivery_code_expires_at:     Optional[str] = None
delivery_code_attempts:       int = 0
delivery_code_locked_until:   Optional[str] = None     # if attempts ≥ 5
delivery_code_verified_at:    Optional[str] = None
delivered_by:                 Optional[str] = None     # driver_id who verified
delivery_code_history:        List[Dict[str,Any]] = []
# each history entry: {generated_at, generated_by_user_id, replaced_at, replaced_reason}
```

> **`delivery_code` is NEVER returned by `GET /api/shipments/{id}`** or any other read endpoint. The clear-text code only exists in the in-app notification that was sent to the receiver org at generation time. After that, the receiver must look in their notifications inbox.

---

## 4. APIs

### 4.1 `POST /api/shipments/{id}/generate-delivery-code`

**Caller:** dispatcher of `owner_org_id`, super_admin, OR system (when shipment transitions to `assigned`)  
**Auth:** Bearer token (or internal system call)  
**Pre-condition:** `shipment.status ∈ {assigned, loaded, in_transit, arrived}`  
**Body:** `{}` (no params)

**Response 200:**
```json
{ "shipment_id": "...",
  "tracking_code": "SHP-AB12CD34",
  "delivery_code_generated_at": "2026-06-20T10:12:00Z",
  "delivery_code_expires_at": "2026-06-27T10:12:00Z",
  "notified_user_count": 3,
  "notification_id": "..." }
```

> The clear-text code is **NOT returned** in this response. It is delivered only via the in-app notification to the receiver org.

**Error responses:**
| Code | Reason |
|---|---|
| 403 | not dispatcher of `owner_org_id` |
| 409 | shipment not in eligible status |
| 410 | shipment already delivered |

### 4.2 `POST /api/shipments/{id}/deliver` (alias `verify-delivery-code`)

**Caller:** assigned driver only (`shipment.driver_id == jwt.driver_id`)  
**Body:** `{ "delivery_code": "1234" }`

**Response 200:**
```json
{ "shipment_id": "...",
  "status": "delivered",
  "delivered_at": "2026-06-20T14:55:00Z",
  "delivered_by": "<driver_id>" }
```

**Error responses:**
| Code | Reason |
|---|---|
| 400 | code malformed (not 4 digits) |
| 401 | code mismatch; response includes `attempts_remaining` |
| 403 | not the assigned driver |
| 409 | shipment not in `arrived` (or `in_transit` if early-deliver allowed) |
| 410 | code expired or shipment cancelled |
| 423 | locked due to too many attempts (response includes `unlock_at`) |

### 4.3 `POST /api/shipments/{id}/regenerate-delivery-code`

Identical to `/generate-delivery-code` but only valid if `delivery_code_locked_until > now` OR caller passes `force=true` (dispatcher-only override).

---

## 5. Notification payload (in-app)

When a code is generated, the backend writes one notification **per active user** of the receiver org (`to_id`).

```json
{
  "id": "...",
  "target_type": "<receiver_org_type>",   // distributor | wholesaler | retailer
  "target_id":   "<to_id>",
  "target_user_id": "<user_id>",          // NEW field — narrows to one user
  "title": "Delivery code for SHP-AB12CD34",
  "message": "Your delivery code is 4729. Give this to the driver on arrival.",
  "type": "delivery_code",
  "severity": "info",
  "payload": {
    "shipment_id": "...",
    "tracking_code": "SHP-AB12CD34",
    "delivery_code": "4729",
    "expires_at": "2026-06-27T10:12:00Z",
    "from_org_name": "Unilever Lagos Warehouse",
    "items_summary": "240 units · 3 SKUs"
  },
  "read": false,
  "created_at": "..."
}
```

> The mobile / web client renders this as a special card with a copy-to-clipboard button on the code, plus context (truck, ETA, items).

---

## 6. Security & threat model

| Threat | Mitigation |
|---|---|
| **Brute force** (driver tries all 10,000 codes) | 5-attempt lock-out per shipment, 10-min cooldown, attempts persisted across requests |
| **Replay** (driver re-uses a delivered code on a different shipment) | Codes are scoped to one shipment_id; verifying any other shipment's code fails |
| **Code leakage in logs** | OTP is hashed at rest with bcrypt cost factor 10; clear-text is never logged. The notification payload IS the only authoritative clear-text store. |
| **Code leakage in API response** | Read APIs never return `delivery_code`. Generation API doesn't return clear-text either. |
| **Insider — dispatcher reads receiver's code** | Notifications are scoped to the receiver org's users via `target_user_id`; even super_admin doesn't see the code unless they explicitly query `db.notifications` (audited via Mongo change streams). |
| **Expired code abuse** | `delivery_code_expires_at` enforced server-side; expired codes return 410 even on hash match. |
| **Cancelled shipment** | Once `status="cancelled"`, deliver endpoint returns 409 regardless of code value. |
| **Driver / receiver collusion (no real delivery)** | Beyond Track A scope — requires GPS-stamped arrive event + photo evidence, both deferred to P2. |

---

## 7. Edge cases

| Case | Behaviour |
|---|---|
| Receiver loses their notification | Dispatcher calls `/regenerate-delivery-code` → new code issued, old hash voided, history entry added. |
| Driver reassigned mid-trip | `/reassign-driver` does NOT regenerate the code; the new driver inherits it. Notification is sent to the new driver: "You are now assigned to SHP-... please ask receiver for code on arrival." |
| Receiver has 0 active users | Dispatcher gets a warning ("no receiver users found — code stored only") and the code is also returned **in the dispatcher's notification** as a fallback. |
| Receiver is a Retailer (not in scope for Track A but the field allows it) | Notification goes to the retailer user instead. Same rules apply. |
| Driver tries to deliver while still `in_transit` (no `arrived` transition) | Two configs allowed by env: `OTP_REQUIRE_ARRIVE=true` (default) returns 409; `OTP_REQUIRE_ARRIVE=false` allows skipping `arrived` and accepts code directly. |
| Out-of-band (no internet) | Driver mobile app caches the planned transitions and replays on reconnect. The `/deliver` request happens online only; offline-queued deliveries are flagged as "Pending sync" in the UI. |

---

## 8. Audit trail

Every code event is mirrored to `db.shipment_otp_audit` for forensic queries:

```json
{
  "id": "...",
  "shipment_id": "...",
  "owner_org_id": "...",
  "event": "generated|regenerated|verified|failed_attempt|locked|expired|voided_on_cancel",
  "by_user_id": "...",        // dispatcher or driver
  "by_role": "manufacturer|distributor|wholesaler|driver|system",
  "ip": "...",
  "user_agent": "...",
  "attempt_value_hint": null, // we store NULL — never the attempted value
  "created_at": "..."
}
```

Queryable via `GET /api/shipments/{id}/timeline?include=otp_audit` (dispatcher + super_admin only).

---

## 9. Acceptance checklist (this design doc)

- [ ] §1 — End-to-end flow accepted
- [ ] §2 — Code lifecycle states (Generated → Locked → Expired → Verified → Regenerated → Cancelled)
- [ ] §3 — Shipment doc fields for OTP
- [ ] §4 — 3 API endpoints (`/generate-delivery-code`, `/deliver`, `/regenerate-delivery-code`)
- [ ] §5 — Notification payload shape
- [ ] §6 — Threat model & mitigations
- [ ] §8 — Audit trail collection name + schema

---

*End of OTP architecture.*
