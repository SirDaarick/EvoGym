# Contingency Mode and Synchronization Architecture Plan

**Decision summary:** EvoGym replaces the over-engineered concept of a custom multi-master distributed sync engine (which attempted custom 3-way conflict resolution, distributed transaction locks, and complex cursors) with a pragmatic, resilient **Contingency Mode (Store-and-Forward / Append-Only Event Queue)**. Previously provisioned reception devices (reception PC and mobile phones) operate independently during WAN outages without any gym LAN or local server dependency. Critical front-desk operations (check-in, counter cash sales, cash renewals, basic registrations, and shift handoffs via physical *Arqueo Físico*) record immutable append-only events locally in IndexedDB and flush them to the canonical FastAPI backend upon reconnection or mobile hotspot tethering.

BK-012 does not implement a client sync endpoint, offline grant, or frontend integration. The health, request-context, in-process metric, and audit primitives are service infrastructure only; the planned local-first contract below remains future work.

## Quick path and rollout order

1. Ratify Contingency Mode capability matrix and append-only event models in [D-026–D-027](02-business-rules-and-decisions.md#decision-register) (BK-061).
2. Implement PWA service worker shell caching and scoped read caches for active members and catalog (BK-062, BK-063).
3. Build the local store-and-forward event queue (`local_event_queue`) with device-prefixed IDs and one submission boundary (BK-064).
4. Implement the FastAPI bootstrap and store-and-forward batch ingestion endpoint (`POST /api/v1/sync/contingency-events`) with idempotency receipts (BK-065, BK-066, BK-067).
5. Implement staff offline session verification, append-only stream merging, shift Arqueo Físico reconciliation, and stock audit logging (BK-068, BK-069, BK-070).
6. Implement client flush orchestration with auto-reconnect/hotspot detection and strict capability guards blocking online-only features (BK-071, BK-072).
7. Validate multi-tab safety, browser restart survival, synthetic outage drills, and central backup procedures (BK-073–BK-076).

Detailed tasks live only in the [master ledger](../../odd/tasks/backend-implementation.md#authoritative-task-ledger); this architecture document owns no independent task status.

## Confirmed baseline, assumptions, and non-goals

| Topic | Contingency mode baseline | Status / limitation |
|---|---|---|
| Topology | Browser/PWA on reception PC and mobile phone stores scoped read models and an append-only event queue in IndexedDB; no gym LAN or local server required. | Confirmed requirement D-026. Initial online provisioning is a prerequisite; clean first-time setup requires internet connectivity. |
| Transport | Store-and-forward over HTTPS directly to the central FastAPI backend. | Devices are independent replicas, not nodes in a distributed database cluster. Reconnection occurs via WAN restoration or mobile hotspot tethering. |
| Event model | Append-only domain event stream with device-prefixed event IDs (e.g. `REC-PC1-0001`, `CHK-PH1-0002`). | Eliminates 3-way merge conflicts by treating local operations as immutable historical business facts. |
| Authority | FastAPI backend + PostgreSQL is the single canonical source of truth for business state, financial totals, and permissions. | Local device holds provisional business facts until server sync. Local UI indicates "Contingency / Queued" status clearly. |
| Delivery guarantee | At-least-once batch delivery with idempotent receipt deduplication on `(event_id, payload_hash)`. | Retries with the same event ID return the original stored receipt. Duplicated events are safely deduplicated. |
| Multi-device asymmetry | Reception PC and staff phones operate on asymmetric connections without distributed coordination. | If PC is offline while a phone is on 4G, phone posts live while PC queues; upon PC sync, the server merges append-only event streams without locking conflicts. |
| Remote services | Mercado Pago Point card terminal, Checkout Pro links, Gimi AI chat, and cloud notifications require live internet. | Online-only operations refuse execution upfront when offline; they are never queued for blind replay. |
| Storage | IndexedDB for local read models and contingency queue; Service Worker for static PWA shell. | Browser storage persistence is requested. Browser storage clear or device destruction cannot guarantee zero-loss of un-flushed queues. |
| Security | Staff offline PIN verification against locally cached hash; bounded offline session grant. | Offline device cannot detect immediate server credential revocation until reconnect; grant validity is time-bounded. |
| Conflict model | Discrepancy auditing over transaction rollback. | Real-world physical facts (cash received, physical drawer counted, member walked in) are recorded append-only; variances trigger audit flags for Admin review. |

## Proposed architecture and storage boundaries

```text
Reception UI / Feature Components
  └─ Unified Command Boundary
       ├─ Contingency Guard (checks capability matrix against online/offline state)
       ├─ Scoped IndexedDB Store
       │    ├─ cached_active_members (roster, photo, active entitlement, debt flag)
       │    ├─ cached_catalog (memberships, POS products, prices in centavos)
       │    ├─ cached_register_state (register ID, active shift state)
       │    └─ local_event_queue (append-only un-flushed events with device-prefixed IDs)
       └─ Contingency Flush Manager ── HTTPS ── FastAPI Backend (/api/v1/sync/contingency-events)
                                                   ├─ Idempotent Ingestion & Deduplication
                                                   ├─ Canonical Domain Database (PostgreSQL)
                                                   ├─ Append-Only Event Merge & Ingestion Receipts
                                                   ├─ Shift Arqueo & Stock Discrepancy Audits
                                                   └─ Provider Outbox (Mercado Pago, Gimi)
``

- **PWA static shell:** Service worker caches immutable application bundles (HTML, JS, CSS, icons, fonts). The app opens instantly even when the gym WAN is completely disconnected.
- **Local storage (IndexedDB):** Stores strictly scoped read projections needed for daily reception duties and the append-only `local_event_queue`. Unsynced operations survive browser tab closes, restarts, and device reboots.
- **Unified command path:** Reception UI calls a single command dispatcher. The dispatcher checks the capability matrix:
  - If the operation is **Online-Only** and the client is offline, it rejects immediately with user guidance ("Requires internet connection").
  - If the operation is **Offline-Allowed**, it records an immutable event in `local_event_queue`, applies an optimistic update to the local read projection, and signals the Flush Manager.
- **Contingency Flush Manager:** Runs in the browser. When online connectivity is detected (or staff triggers a manual flush), it packages pending events in bounded chronological batches and posts them to `POST /api/v1/sync/contingency-events`.
- **FastAPI backend:** Validates event schema, checks authenticated device and staff grant, deduplicates via `(event_id, payload_hash)`, persists the domain effects into PostgreSQL in an atomic transaction, records discrepancy audits if physical counts diverge, and returns durable receipts to the client.

## Contingency Mode Capability Matrix

The capability matrix formalizes the agreed operational boundaries between offline append-only operations and online-dependent services:

| Operation / Feature | Offline contingency mode | Rationale & reconciliation mechanism |
|---|---|---|
| **Member check-in / attendance** | **Allowed (Append-Only Event)** | Uses `cached_active_members`. Generates append-only check-in event (`CHK-xxx`). Exact replay of the same event/idempotency key returns its original result. A distinct same-member event within five minutes of the first valid access links to that visit, but remains an auditable duplicate event; duplicate attempts do not extend the fixed window. Does not control physical turnstiles/hardware. Offline queue/sync and reconnect-time access revalidation remain pending in BK-029. |
| **POS counter sales in cash** | **Allowed (Append-Only Event)** | Generates device-prefixed receipt event (e.g. `REC-PC1-000123`). Decrements local stock projection provisionally. Server appends sale to order ledger; stock ledger variances are flagged for physical count audit on sync. |
| **Cash membership renewal** | **Allowed (Append-Only Event)** | Generates cash payment event; extends member entitlement provisionally in local cache. Server creates canonical order, payment, and entitlement period upon sync. |
| **Fast member basic registration** | **Allowed (Append-Only Event)** | Assigns temporary client UUID; captures name, phone, basic profile. Full registration commits to canonical database upon sync. |
| **Shift Open & Arqueo Físico Close** | **Allowed (Append-Only Event)** | Cash drawer is physically tied to reception register. Shift closing is an immutable declaration of counted physical cash and tickets (*Arqueo Físico*). Allows outgoing staff to close and incoming staff to open shift offline. Server audits cash discrepancies asynchronously on reconnect. |
| **Mercado Pago Point card payment** | **Online-Only** | Requires real-time bi-directional communication between Point terminal, Mercado Pago cloud, and EvoGym backend. Refused upfront when offline. |
| **Mercado Pago Checkout Pro online links** | **Online-Only** | Hosted order creation requires remote provider API. Refused upfront when offline. |
| **Gimi conversational AI & WhatsApp** | **Online-Only** | WhatsApp Business webhook delivery and cloud LLM execution require live internet. Verified customer phone matching (D-022) is enforced server-side. |
| **Admin master catalog / pricing edits** | **Online-Only** | Plan prices, permissions, roles, and gym configurations require canonical server validation to prevent conflicting pricing authority. |
| **Complex refunds & balance reversals** | **Online-Only** | High-risk financial operations requiring verification of original payment method settlement and remote balance constraints. |

## Multi-device asymmetry and mobile hotspot handling

In the physical gym environment, reception connectivity failures are asymmetric:
1. **Gym WAN down, Reception PC offline, Mobile Phone on 4G/5G:**
   - The reception PC enters Contingency Mode and queues cash sales and check-ins into IndexedDB.
   - If staff needs to process an urgent online renewal or query Gimi, they can do so on their mobile phone using cellular data. The phone posts live to FastAPI.
   - Because contingency events are append-only domain streams rather than full-database state overwrites, the PC's queue and the phone's live operations do not create distributed locking conflicts.
2. **Mobile Hotspot Tethering:**
   - During extended broadband outages, staff can enable a mobile hotspot on their smartphone and connect the reception PC.
   - The Contingency Flush Manager detects the active connection and flushes the entire queued backlog of events in under 2–3 seconds (a typical batch of 100 check-ins and 20 sales is under 50 KB).
   - Once the queue is acknowledged empty, the PC returns to live synchronized status.

## Shift handoff and Cash Closing (Arqueo Físico) offline

Cash drawer management during an outage is a frequent source of over-engineering. In EvoGym:
- The cash drawer is a physical reality located at the reception desk.
- When an employee finishes a shift during an outage, they must be able to hand over the physical register to the incoming shift worker without waiting for internet restoration.
- **Arqueo Físico Protocol:**
  1. Outgoing staff triggers "Cierre de Turno (Arqueo Físico)".
  2. Staff counts and enters physical cash breakdown (denominations, counted coins, physical credit vouchers/tickets).
  3. The client records an immutable event `shift.arqueo_close` with the physical declaration, timestamps, and staff ID into `local_event_queue`.
  4. The local register state transitions to `closed`, freeing the register for the incoming employee.
  5. The incoming employee logs in with their offline PIN and submits `shift.open` with the starting drawer fund.
  6. Upon server reconnection, the server ingests `shift.arqueo_close`, computes the expected drawer total from recorded sales, and records any discrepancy (*faltante / sobrante*) in the shift audit ledger. The shift handoff itself is never rejected or rolled back.

## Append-only event envelope and lifecycle

Every event placed in the `local_event_queue` adheres to a lightweight, versioned envelope:

| Field | Description & validation rules |
|---|---|
| `event_id` | Immutable device-prefixed identifier: `{device_prefix}-{timestamp_ms}-{sequence}` (e.g. `REC-PC1-1718880000000-0042`) or client UUIDv4. Used for deduplication. |
| `installation_id` | Provisioned device identity issued during initial online bootstrap. |
| `actor_id` | Staff member identifier who authorized the action. |
| `event_type` | Allowlisted domain event type: `attendance.check_in`, `pos.cash_sale`, `membership.cash_renewal`, `member.fast_registration`, `shift.open`, `shift.arqueo_close`. |
| `payload` | Canonical JSON payload containing domain-specific event details (items, centavos, member reference, counted denominations). |
| `payload_hash` | SHA-256 hash of canonical JSON payload. Mismatch with duplicate `event_id` causes security rejection. |
| `client_recorded_at` | Device-captured ISO timestamp for when the real-world check-in occurred. Preserve it for chronology/audit and use it for the approved five-minute visit window. Compare it with the server-anchor estimate below; if absolute skew exceeds five minutes or the estimate is unverifiable, retain the event and mark it for review. Never correct the captured time. |
| `server_received_at` | Server-assigned timestamp upon successful ingestion. Persist alongside capture time to record when synchronization was received; it does not replace capture time for the five-minute check-in window. |
| `sync_status` | Local state: `queued` → `sending` → `acknowledged` (or `flagged_audit`). |

### Event Lifecycle:

```text
[Local UI Action]
       │
       ▼
[IndexedDB: Write to local_event_queue & Update local read cache] (Atomic)
       │
       ▼
[Contingency Flush Manager] ──(Detects connection / Hotspot)──┐
       │                                                       │
       ▼                                                       ▼
[POST /api/v1/sync/contingency-events] ────────────► [FastAPI Ingestion]
       │                                                       │
       │                                            ├─ Validate schema & actor
       │                                            ├─ Deduplicate via (event_id, payload_hash)
       │                                            ├─ Commit domain entities to PostgreSQL
       │                                            ├─ Log audit variances (cash/stock)
       │                                            └─ Return batch receipts
       │                                                       │
[Receive 200 OK Receipts] ◄────────────────────────────────────┘
       │
       ├─ Status "accepted" / "duplicate": Purge from local_event_queue
       └─ Status "flagged_audit": Purge from queue, display audit badge to staff
``

## Conflict elimination and discrepancy auditing

### Offline clock anomaly rule (approved; helper not integrated)

When online, persist a trusted server UTC timestamp together with the local monotonic-clock reading from the same anchor. At offline capture, estimate server time as `anchor server UTC + (capture monotonic reading - anchor monotonic reading)`. Capture/sync must pass the anchor as valid only when it knows the anchor and capture readings share the same monotonic time origin (for example, no page/process restart reset that origin). Compare the raw device wall-clock capture timestamp with that estimate. Absolute skew **greater than five minutes** requires review; exactly five minutes remains within tolerance. Preserve the original device timestamp in every case and never silently rewrite it.

If the anchor or its monotonic time origin is unavailable/unknown, either reading is invalid, or elapsed monotonic time is negative, classify the clock as unverified and require review without fabricating an estimate. Reusing an anchor for retries keeps the baseline fixed; a retry does not refresh the trusted baseline.

The frontend `offlineClock` helper is a pure classifier only. It is not wired to check-in capture, an offline queue, persistence, synchronization, server event acceptance, or reconnect-time entitlement revalidation. BK-031/BK-064 integration and end-to-end BK-029 remain pending; BK-029 remains Partial.

By replacing multi-master distributed state replication with an append-only event stream, classic distributed database merge conflicts are eliminated by design:

1. **Check-in replay and duplicates:** An exact replay using the same event/idempotency key returns the original result and creates no new event. A distinct same-member event within five minutes of the first valid access counts as the same visit and links to that visit, but the second event remains separately auditable. The fixed window is anchored to the first valid access; retries do not extend it. Offline events preserve both device-captured and server-received times; the five-minute window uses capture time. A clock anomaly is retained and flagged, not rejected. Offline ingestion and entitlement revalidation on reconnect remain unresolved.
2. **POS cash sales:** A counter cash sale represents physical currency received by staff. It cannot be invalidated by a server conflict. The server appends the sale and decrements the stock ledger. If local stock drops below zero centrally, the server records an inventory variance flag for staff count reconciliation, never an aborted sale.
3. **Cash membership renewal:** Cash was collected physically. The server creates the canonical payment and extends the entitlement period from the date of the sale.
4. **Shift Arqueo Físico:** Discrepancies between physical cash counted and expected sales are recorded as operational audit records for gym management review.

## Local storage, offline identity, and privacy

- **IndexedDB persistence:** IndexedDB is configured with storage persistence (`navigator.storage.persist()`). The store maintains schema versioning and migration guards.
- **Offline PIN & Grant:** During online operation, staff profiles and bcrypt hashes of 4–6 digit offline PINs are cached locally. Staff can authenticate and open shifts offline. Offline grants have an explicit TTL (e.g. 24–48 hours) to prevent indefinite disconnected access.
- **Data minimization:** The cached member roster contains only active members, basic profile data (name, phone, membership status, debt flag), and photo hash. Notes, health records, and historic logs are not stored locally.
- **Storage quota & eviction handling:** If storage quota is exhausted or writes fail, the UI explicitly warns staff and refuses to accept offline transactions until storage is resolved.

## Sync endpoint inventory

| Method / path | Purpose | Idempotency and response contract |
|---|---|---|
| `POST /api/v1/sync/bootstrap` | Initial device provisioning and seed of read models. | Returns device token, active member roster, active catalog/prices, open register status, and grant TTL. |
| `GET /api/v1/sync/roster-delta?since=...` | Incremental pull of updated members and catalog items. | Monotonic server timestamp cursor; returns added/updated/deactivated member records. |
| `POST /api/v1/sync/contingency-events` | Ingestion endpoint for batched store-and-forward events. | Bounded batch payload; returns array of per-event receipts (`accepted`, `duplicate`, `flagged_audit`, `rejected`). |
| `GET /api/v1/sync/status` | Lightweight heartbeat and connectivity readiness check. | Returns 200 OK with server time and active branch status. Used by frontend to trigger queue flush. |
| `GET /api/v1/sync/audit-discrepancies` | Admin query for shift cash variances and stock discrepancies. | Returns list of flagged shift closings and inventory anomalies requiring manager sign-off. |

## Backup, recovery, and device loss

- **Canonical database:** Central PostgreSQL uses point-in-time recovery (PITR) and daily snapshots. Restores recover canonical orders, payments, attendance, and discrepancy audit records.
- **Un-flushed queue loss:** If a reception PC suffers catastrophic physical destruction while holding un-flushed events, those local events are lost. To mitigate this:
  - Cash drawers are reconciled daily via physical paper receipts and cash counts (*Arqueo Físico* tickets).
  - Staff is trained to tether to mobile hotspot whenever an outage extends beyond the work shift.

## Key Learnings

1. Modeling offline operations as append-only business events (Store-and-Forward) completely eliminates the complexity and fragility of multi-master distributed databases and 3-way merge algorithms.
2. A cash sale or shift cash count (*Arqueo Físico*) is an immutable physical declaration; it must be accepted by the system and audited for variances rather than aborted by a software conflict.
3. Mobile hotspot tethering allows reception PCs to flush hundreds of queued transactions in seconds over cellular data without requiring complex peer-to-peer sync protocols.
