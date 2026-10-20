# FastAPI Architecture and API Plan

**FastAPI is required.** The proposed deployment shape is a modular monolith organized by business capability, not microservices or mandatory heavy hexagonal scaffolding. Keep business rules independent of FastAPI/ORM mechanics enough that transport and persistence remain replaceable. PostgreSQL with SQLAlchemy/Alembic/psycopg is the selected persistence stack; current exercised versions and compatibility bounds are recorded in the API README. Future provider SDK choices remain task-specific.

## Proposed dependency direction

```text
FastAPI routers / request-response DTOs
             ↓
Application use cases (authorization context, transaction boundary, idempotency)
             ↓
Domain rules and value concepts (money, intervals, lifecycle invariants)
             ↓
Repository/unit-of-work contracts → persistence adapters / PostgreSQL
             ↓
Outbox adapters (notifications, Gimi integration, external payment provider)
```

Keep domain folders such as `members`, `catalog`, `membership`, `attendance`, `sales`, `payments`, `cash`, `inventory`, `rentals`, `finance`, `staff`, and `notifications`. Shared infrastructure should stay small: configuration, database session, error mapping, audit, request context, pagination, and observability. A feature may use straightforward functions and transactions; do not add abstractions without a second concrete use or testing seam.

**Current P1 boundary:** `api/` now provides server-generated request IDs, generic correlated error envelopes (including uncaught pre-response failures), allowlisted request logs, capped in-process metrics, `/health/live`, bounded off-loop dependency readiness, and a caller-transaction audit append service for supported read actions only. Local Uvicorn runs disable access logs because request targets can contain query data. There are still no business or authentication routes, and internal staff/session primitives are not public API contracts. Audit wiring, retention/access, production deployment policy, and hosted CI execution remain separate gates.

## Local-first topology and synchronization boundaries

Standalone operation is required (D-026): previously provisioned phone and reception PC independently keep a scoped local projection and durable operation history during WAN outage; neither needs a gym LAN server. FastAPI stays canonical when reached. Browser PWA is a client, not a FastAPI runtime or peer server. Initial online enrollment/bootstrap is a technical prerequisite; clean first-time offline provisioning is not promised. See the detailed [local-first and sync plan](08-local-first-and-sync.md).

Use service worker only for versioned app-shell assets; use IndexedDB for minimal scoped projections, schema version, local journal/outbox, receipts and cursor. Do not use whole-state `localStorage` as sync, do not cache authenticated API responses indiscriminately, and do not store server/provider secrets client-side. Browser/server rules are separate implementations: front-end validation provides early feedback; only Python application use cases authorize and accept canonical business effects.

One UI submission boundary records a versioned immutable command and any safe provisional projection atomically in IndexedDB, then attempts network sync immediately when available. Push is bounded/per-command, at-least-once, operation-ID/hash deduped; server commits accepted domain effect, durable receipt, audit and canonical change record together. Pull uses opaque monotonic commit-order cursor, snapshot consistency and explicit `snapshot_required` after retention gaps. App restart, lost acknowledgement and schema upgrade resume from durable journal; incompatible work is held for recovery rather than discarded. See R-021..R-029.

Keep client operation journal/outbox, server sync receipt/change log, security/business audit, and payment-provider inbox/outbox separate. No server network I/O is performed inside the domain database transaction. Current scope/role is rechecked on every sync; untrusted local time/actor/price/branch does not grant authority.

### Proposed sync endpoint contract (illustrative)

| Route | Role/effect | Contract and blockers |
|---|---|---|
| `POST /api/v1/sync/bootstrap` | Authenticated enrolled device; issue bounded offline grant and minimal scoped snapshot/cursor. | Server-derived scope; snapshot + cursor from one consistent boundary; D-001,D-028,D-030. |
| `POST /api/v1/sync/operations` | Authenticated enrolled device; push bounded command batch. | Per-command result; same op ID/hash returns receipt, changed hash conflicts; domain effect + receipt atomic; D-027,D-028. |
| `GET /api/v1/sync/operations/{operation_id}` | Read own receipt after lost acknowledgement. | Verify installation/actor scope; no other device payload leakage. |
| `GET /api/v1/sync/changes?cursor=...` | Pull canonical changes/tombstones. | Opaque ordered cursor, deterministic pages; expired cursor returns snapshot-required; D-030. |
| `GET /api/v1/sync/conflicts[/id]` | Admin/domain owner reads conflicts. | Base/local/canonical comparison and current revision, minimal PII; D-027. |
| `POST /api/v1/sync/conflicts/{id}/resolutions` | Authorized online Admin/domain owner applies approved remedy. | New resolution ID + expected conflict revision; reauthorize and audit; no arbitrary financial merge. |

Offline grant TTL, queue/payload limits, cursor retention, local schema range and conflict classes remain decisions/measurements, not invented constants. `navigator.onLine` is a hint only; foreground/resume/manual sync must work even when Background Sync is unavailable.

## Technology selection gates

| Concern | Candidate | Tradeoff / decision needed |
|---|---|---|
| Runtime/API | FastAPI + supported Python version | Verify project/runtime compatibility and support window before pinning; no version selected here. |
| Validation/DTO | Pydantic request and response models | Keep separate from ORM/domain; avoid returning arbitrary model fields. |
| Relational store | PostgreSQL proposal in `docs/database-map.md` | Confirm scope, hosting, backup and concurrency model before selection. |
| ORM/migrations | SQLAlchemy + Alembic are candidates | ORM productivity vs explicit SQL/control; review async/sync session strategy and migration safety before choosing. |
| Client data access | OpenAPI-generated or handwritten typed adapter | Generated consistency vs client bundle/ergonomics; choose incrementally per slice. |
| Frontend requests | Fetch/Axios plus existing state/query mechanisms | Avoid introducing another cache/state owner without need; align with frontend stack and retry semantics. |
| Tests | Existing Python test runner to be selected after scaffold discovery | Unit, DB integration, API and migration coverage; do not claim a runner exists. |

Before locking any library versions or using framework-specific behavior, verify current official documentation and supported runtime version. References: [FastAPI docs](https://fastapi.tiangolo.com/), [Pydantic docs](https://docs.pydantic.dev/), [SQLAlchemy docs](https://docs.sqlalchemy.org/), [Alembic docs](https://alembic.sqlalchemy.org/). No SDK or version is committed here.

## Required payment channels and integration boundaries

Both Mercado Pago channels are confirmed scope (D-021), but they are separate adapters over shared payment application use cases:

| Channel | Server-owned flow | Provider/operational boundary |
|---|---|---|
| Reception Point | Card selection → local idempotent payment intent → async Point adapter creates provider `type=point` order → linked physical terminal → callback/status reconciliation → one local settlement. | Authenticated staff, authorized branch/register and open shift are required. Server resolves order snapshot, amount, currency and mapped POS/terminal; caller never supplies trusted price. Point card is non-cash and must not change drawer cash. Validate live account/store/POS/terminal association, supported device model/mode and API compatibility before deployment. A terminal-busy order or ambiguous timeout is reconciled; no blind duplicate create. |
| Gimi one-time renewal | Verified online customer/member → server renewal quote and immutable local order → Checkout Pro Orders API `type=online`, `processing_mode=manual` → deliver provider `checkout_url` → callback/status reconciliation → exactly-once local settlement → membership activation only under D-005 → notification. | The online customer identity mechanism is unresolved (D-022); staff admin login or a chat-supplied member identifier is not proof. No recurring subscription/debit. Keep PII out of URL/external reference. Link/order expiration, supersession, amount changes and cross-channel contention remain D-023/D-024 decisions. |

**Recommended online path for a new integration:** Mercado Pago documents Checkout Pro via Orders API as the recommended path and says it returns a hosted `checkout_url`; Preferences API with `init_point` is identified as the legacy flow. Create a distinct one-time order per renewal attempt, not a subscription. Do not use a dashboard-created static Payment Link for this workflow: Mercado Pago's notification guidance says payment links generated from its panel cannot configure webhooks; use an integrated API order with the documented order event instead. [`Checkout Pro Orders overview`](https://www.mercadopago.com.mx/developers/en/reference/online-payments/checkout-pro-orders/overview), [`Create Checkout Pro order`](https://www.mercadopago.com.mx/developers/en/docs/checkout-pro-orders/create-order?scope=prod), [`Panel Payment Link notification limitation`](https://www.mercadopago.com.mx/developers/es/docs/checkout-pro-preferences/additional-content/notifications/additional-info).

### Provider states, idempotency, events, and local truth

- Keep `internal_status`, `provider_channel`, raw `provider_status`, and `provider_status_detail` distinct. Internal conceptual states (e.g. requested, pending, approved, rejected, canceled, expired, unknown/reconciliation-required, refunded) are proposals only; map actual status/detail separately for each product. The Point docs list states such as `created`, `at_terminal`, `action_required`, `processed`, `failed`, `expired`, `canceled`, and `refunded`; Checkout Pro Orders has its own documented status/detail model such as `created`, `processing`, `processed`, `action_required`, `failed`, `canceled`, and refund variants. Never assert these channels share an enum. [`Point order lifecycle`](https://www.mercadopago.com.mx/developers/en/docs/mp-point/resources/status-order-transaction), [`Checkout Pro order status`](https://www.mercadopago.com.mx/developers/en/docs/checkout-pro-orders/payment-management/status/order-status).
- The currently reviewed Point Orders API and Checkout Pro Orders API references both require `X-Idempotency-Key` on order creation; Point documentation also requires it for cancel/refund operations, and the online Orders API documents operation-specific key requirements. Generate unique keys per provider operation and separately maintain EvoGym's persisted idempotency/renewal-attempt key. Do not assume key reuse, replay windows or state effects are globally interchangeable between operations/channels. [`Point Orders API`](https://www.mercadopago.com.mx/developers/en/reference/in-person-payments/point/orders/create-order/post), [`Checkout Pro Orders API`](https://www.mercadopago.com.mx/developers/en/reference/online-payments/checkout-pro/create-order/post).
- Provider callbacks are unauthenticated by staff session by design, but are not trusted until the exact product's signature, secret, event type/schema, account identity, order ID, `external_reference`, amount, currency and remote order status are validated. Current Point notification docs and Checkout Pro Orders notification docs each document an `x-signature` HMAC verification path; nevertheless configure and test product-specific event topics, credentials, parsed identifiers and signature inputs independently. The Checkout Pro Orders status page refers to `orders_v2` while its notifications setup page documents an “Order (Mercado Pago)” event: resolve the exact supported topic/schema for the chosen account before wiring it. Do not apply an assumed shared validator based only on the presence of HMAC. [`Point webhook setup`](https://www.mercadopago.com.mx/developers/en/docs/mp-point/notifications), [`Checkout Pro Orders notifications`](https://www.mercadopago.com.mx/developers/en/docs/checkout-pro-orders/notifications), [`Checkout Pro order status/webhook note`](https://www.mercadopago.com.mx/developers/en/docs/checkout-pro-orders/payment-management/status/order-status).
- Persist intent and local idempotency transactionally, commit, then call Mercado Pago through a durable worker/outbox. Never hold a DB transaction across network I/O. Callback handler verifies the signature and durably records/deduplicates the event, acknowledges it, then asynchronous reconciliation retrieves current remote state and applies a valid state transition exactly once. Callback body or browser success redirect alone is never proof. A timeout remains unknown until safely queried/reconciled.
- Checkout Pro Orders supports configuring an order's `expiration_time` at creation; existing order cancellation/reissue and Point cancellation vary by state/product and can be asynchronous. Define expiration and supersession policy only after verifying supported API behavior. A changed quote requires a new server-calculated order; never mutate client-supplied amount, assume an old URL was invalidated, or disclose PII through the link. [`Checkout Pro order validity`](https://www.mercadopago.com.mx/developers/en/docs/checkout-pro-orders/additional-settings/define-order-validity?scope=prod), [`Point cancellation behavior`](https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing).

### Transaction and worker boundaries

Use shared application use cases for local order/payment/renewal invariants, but separate `PointOrderAdapter` and `CheckoutProOrderAdapter` ports/adapters, parsers, state mappers, callback config and reconciliation logic. FastAPI endpoints authenticate/authorize and persist an intent/inbox item; a worker performs outbound calls and processes signed inbound events. Notifications and Gimi are independent adapters over domain use cases/outbox. There are no microservices at the start; split only if measured scale/availability targets justify it (targets TBD). Never make an external network request in a database transaction and never permit Gimi or a browser to write directly to a repository/provider.

### Identities and trusted values

The Point requester must be an authenticated staff actor with an authorized branch/register and open shift. The server loads the order/items/plan snapshot and terminal mapping; a browser cannot choose merchant, account, branch, member, item price or payment amount. For online renewal, a verified customer identity maps to a member before the server reveals renewal details and creates a quote. Gimi carries a constrained verified identity context into the same use case; it cannot create an arbitrary URL, set price, or use a staff admin token as customer proof. No PAN/CVV is stored.

## Transport and contract conventions

- Version the public contract deliberately (e.g. `/api/v1`); keep OpenAPI schema stable within the version.
- Separate `Create/Update` request DTOs, domain command inputs, persistence rows, and response DTOs. Do not accept actor, scope, calculated totals, ownership, or status fields from a client unless a rule explicitly permits it.
- Use explicit pagination (`limit`, opaque/consistent cursor or offset decision), stable sort, bounded filters, and scope predicates. Avoid unbounded collection responses.
- Use consistent error envelope: machine-readable code, safe human message, request ID, optional field errors; never leak stack, SQL, secret, or PII.
- Use integer minor units plus currency in API payloads; represent dates and timestamps distinctly. Specify timezone/interval semantics from D-003/D-004/D-005.
- Require `Idempotency-Key` for non-repeatable external/financial commands where appropriate. Scope keys to authorized actor/operation and bind to canonical payload hash (R-013).
- Generate request/trace correlation identifiers; audit actor, decision and event without sensitive payload dumps.
- Use conditional state transitions and optimistic version or row-locking for mutable contested resources. Domain-specific transaction boundary must be explicit.
- Expose no card PAN/CVV; only safe provider references and permitted last digits/brand if necessary.

## Endpoint inventory — proposed names only

Role names are placeholders pending D-011; each route requires server-side scope checks. Transaction and decision columns describe the future use case, not implemented behavior.

| Method / path | Roles | Effect | Read/write, transaction boundary | Decision blockers |
|---|---|---|---|---|
| `GET /api/v1/members` | reception, admin | Search/filter member list | Read snapshot; scoped pagination | D-001,D-012 |
| `GET /api/v1/members/{id}` | reception, admin | Member profile projection | Read; redact notes/eligibility by permission | D-001,D-012 |
| `POST /api/v1/members` | authorized reception/admin | Create member | Write one member + audit atomically | D-001,D-012 |
| `PATCH /api/v1/members/{id}` | authorized role | Change allowed profile fields | Write optimistic version + audit | D-012 |
| `GET /api/v1/catalog/plans` | reception, admin | Active/published plan versions | Read catalog snapshot | D-003,D-005 |
| `POST /api/v1/catalog/plans/{id}/versions` | admin | Draft/publish terms | Write version transition; published immutable | D-003,D-005 |
| `POST /api/v1/registers/{id}/shifts` | shift-authorized staff | Open shift with starting cash/count record | Lock register; shift/opening/audit atomic | D-001,D-014,D-015 |
| `POST /api/v1/shifts/{id}/close` | authorized closer | Freeze totals/counts | Lock shift; reconcile snapshot atomically | D-014 |
| `POST /api/v1/orders` | cashier/reception | Create order draft/confirmed command | Idempotent; order+items+chosen effects as approved | D-003,D-006,D-014,D-015 |
| `POST /api/v1/orders/{id}/payments` | cashier | Record payment intent/receipt | Idempotent payment transaction; provider outcome may be unknown | D-006,D-017 |
| `POST /api/v1/payments/{id}/verifications` | verifier role | Verify/reject transfer | Conditional transition + evidence/audit | D-006,D-011,D-012 |
| `POST /api/v1/memberships/{id}/activate` | authorized staff | Activate purchased membership | Lock membership; entitlement + audit atomically | D-005 |
| `POST /api/v1/attendance/check-ins` | reception | Verify and record access | Lock entitlement/debt scope; unique use/visit transaction | D-004,D-005,D-013 |
| `POST /api/v1/trials` / `POST /api/v1/trials/{id}/check-in` | reception | Schedule/consume trial | Trial lifecycle only; never membership side effect | D-004 |
| `POST /api/v1/inventory/counts` | inventory/admin role | Record physical count | Count observation only | D-015 |
| `POST /api/v1/inventory/adjustments` | inventory authorizer | Post explicit stock change | Stock ledger + audit atomically | D-015 |
| `POST /api/v1/orders/{id}/returns` | authorized staff | Record returned items | Lock original lines; quantity bounds; separate refund command | D-007 |
| `POST /api/v1/returns/{id}/refunds` | authorized finance/cashier | Issue refund outcome | Idempotent; original tender/shift/provider constraints | D-007,D-014,D-017 |
| `POST /api/v1/rentals` / `POST /api/v1/rentals/{id}/returns` | reception | Rent/return asset | Lock asset; event lifecycle; explicit release | D-008 |
| `GET /api/v1/reports/...` | admin/owner | Period-based projections | Read from reconciled source events | D-001,D-004,D-012 |
| `POST /api/v1/notifications` | domain service/admin | Enqueue notification | Outbox insert; delivery asynchronous | D-012,D-016 |
| `POST /api/v1/auth/sessions` / `POST /api/v1/auth/recovery/start` / `POST /api/v1/auth/recovery/complete` | staff/admin | Staff/Admin sign-in and recover own access | Credential proof + rate limits; recovery policy required; generic response avoids account enumeration | D-011,D-025 |
| `GET /api/v1/admin/sessions` / `POST /api/v1/admin/sessions/{id}/revoke` | admin | Review/revoke authorized sessions | Scoped admin write with audit; do not expose tokens | D-025 |
| `POST /api/v1/admin/staff-enrollment-codes` / `GET ...` / `POST .../{id}/revoke` | admin | Create/list/revoke one-time employee enrollment codes | Store only hashed code, show secret only once, expire and audit | D-025 |
| `POST /api/v1/admin/devices/pairing-codes` / `GET /api/v1/admin/devices` / `POST .../{id}/revoke` | admin | Enroll/list/revoke paired staff devices | Hashed 6-digit code, TTL/attempt limits and immediate revoke; audit | D-011,D-025 |
| `POST /api/v1/payments/point-orders` / `GET /api/v1/payments/{id}` / `POST .../{id}/cancel` | authenticated cashier/reception | Dispatch/status/cancel a Point payment order | Local transaction creates intent; worker calls provider; terminal status is reconciled; only currently supported provider cancellation path is used | D-014,D-017,D-021,D-023 |
| `POST /api/v1/memberships/{id}/renewal-checkout-link` | verified member or constrained Gimi principal | Create one-time hosted Checkout Pro renewal URL | Server resolves quote and identity; local idempotent intent commits before provider call; no subscription | D-005,D-022..D-024 |
| `POST /api/v1/webhooks/mercado-pago/point` / `POST /api/v1/webhooks/mercado-pago/checkout-pro` | Public provider callback; no staff session | Receive provider order events | Per-channel signature verification, durable dedupe/inbox then async fetch/reconcile; reject invalid signatures safely | D-017,D-021,D-024 |

Endpoint additions should follow a domain command/read model and documented actor. Do not expose generic CRUD routes for financial or lifecycle entities.

## Error, money, time, and state contract

Proposed error classes: validation, unauthenticated, forbidden, not found (avoid cross-scope existence leakage), conflict/state mismatch, idempotency mismatch, rate limited, dependency unavailable, and internal failure. Return safe status codes and request ID. Never call unknown payment outcome “failed” until reconciled; use an explicit pending/unknown outcome and safe retry/reconciliation action.

Money commands must validate currency, integer minor units, nonnegative constraints, and total reconciliation using approved rounding. Time-bearing operations use aware instants; business-date filtering uses the resolved branch timezone. Membership periods use approved calendar semantics, not fixed 30-day arithmetic.

## Persistence and authorization boundaries

The authenticated actor and scope come from verified session/token plus server policy, never client-supplied `branch_id` alone. Every repository call receives scope context or has an enforced scoped session boundary. Financial commands run in explicit transactions with idempotency record, domain events, audit, and outbox rows coordinated as appropriate. External provider calls must not be held inside a DB transaction; use durable intent/inbox/outbox and reconciliation workers (R-020). Browser/Gimi cannot provide trusted quote, price, member, branch, merchant or terminal identity.

## OpenAPI and contract acceptance

- [ ] Every endpoint documents role, scope, request/response DTO, status codes, idempotency, and side effects.
- [ ] DTOs do not reveal password/PIN/token hashes, internal notes, raw evidence files, or unauthorized compensation.
- [ ] Contract tests assert required and forbidden fields, errors, pagination, date and money serialization.
- [ ] API-client adapter maps wire DTOs to frontend view models and handles loading/error/empty/retry states.
- [ ] Schema changes and API changes are backward-compatible within the chosen version or have a migration plan.

## Official Mercado Pago evidence checked for this plan

Documentation was reviewed on 2026-10-19; this was documentation browsing only, not a provider operation. API details and product behavior may evolve and must be rechecked against the exact Mexico account, current docs, and selected mode before implementation.

- Point terminal/POS/order model: [Point API overview](https://www.mercadopago.com.mx/developers/en/reference/in-person-payments/point/overview) explains stores, POS-to-terminal linking, terminal listing/configuration and order dispatch; [Point create order reference](https://www.mercadopago.com.mx/developers/en/reference/in-person-payments/point/orders/create-order/post) documents `POST /v1/orders` and required idempotency.
- Point order states/cancel: [Point order status](https://www.mercadopago.com.mx/developers/en/docs/mp-point/resources/status-order-transaction), [Point payment/cancellation processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing). A terminal already holding an order can be busy; `at_terminal` cancellation has conditional, asynchronous behavior and device/version constraints.
- Point callback/security and sandbox: [Point notifications](https://www.mercadopago.com.mx/developers/en/docs/mp-point/notifications) documents order events and signature validation; [Point integration test](https://www.mercadopago.com.mx/developers/en/docs/mp-point/integration-test) says test credentials simulate order states but cannot process a real payment on a physical terminal; production-card tests would be real operations and are out of scope here.
- Online hosted order: [Checkout Pro Orders overview](https://www.mercadopago.com.mx/developers/en/reference/online-payments/checkout-pro-orders/overview) identifies Orders API as recommended for a new integration and Preferences API as legacy; [create order](https://www.mercadopago.com.mx/developers/en/docs/checkout-pro-orders/create-order?scope=prod) creates `type=online`, `processing_mode=manual` and returns `checkout_url` with required idempotency.
- Online status, notification and validity: [Checkout Pro status](https://www.mercadopago.com.mx/developers/en/docs/checkout-pro-orders/payment-management/status/order-status), [notification setup](https://www.mercadopago.com.mx/developers/en/docs/checkout-pro-orders/notifications), [validity/expiration](https://www.mercadopago.com.mx/developers/en/docs/checkout-pro-orders/additional-settings/define-order-validity?scope=prod). Status documentation says await its order notification before irreversible grants; create-time validity uses `expiration_time` (and `available_from` where supported). Exact notification topic discrepancy is called out above for validation.
- Unsupported shortcut: [Mercado Pago notification information](https://www.mercadopago.com.mx/developers/es/docs/checkout-pro-preferences/additional-content/notifications/additional-info) says Payment Links created from the Mercado Pago panel cannot configure notifications. Use an integrated online order with server-side reconciliation instead of treating a panel link as an automatically verifiable EvoGym renewal.
