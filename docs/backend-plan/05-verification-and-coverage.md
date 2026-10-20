# Verification, Traceability, and Missing-Work Detection

The proof system must establish domain behavior, not merely line coverage. All checks below are future verification requirements; no application test command has been run for this plan.

BK-012 local checks now exercise generic 500 correlation/log redaction, safe `Allow` preservation, response-started stream termination, bounded readiness saturation/recovery without blocking liveness, capped metric series, and rejection of unsupported audit mutations. The opt-in PostgreSQL audit/readiness test requires an explicit disposable loopback URL; hosted CI is defined but not executed locally.

## Traceability matrix

Each BK row in the master ledger owns status. This matrix links rule/decision references to proof classes and names the primary task IDs; add affected IDs when scope changes.

| Module | D/R references | BK tasks | Required proof classes |
|---|---|---|---|
| Tenant/org/branch | D-001,D-004,R-012 | BK-001,002,008,011,013 | scope isolation, forbidden cross-tenant access, timezone query boundaries |
| Staff/Admin auth and enrollment | D-011,D-025,R-012,R-014 | BK-006,BK-010,BK-011,BK-040,BK-058,BK-059,BK-060 | negative auth, recovery enumeration resistance, session/device/code revoke, expiry/replay, Admin-only access |
| Members/notes | D-001,D-012,D-020 | BK-013..019 | request validation, DTO privacy, unique member number, notes access |
| Catalog/membership | D-003..005,R-001..003 | BK-002,003,017,023,027,028 | price snapshot, activation boundaries, overlap, idempotent retry |
| Attendance/trials | D-004,D-005,D-013,R-007,R-014 | BK-029..031 | debt/eligibility denial, duplicate visit, trial distinctness, timezone |
| Order/payment/credit and Mercado Pago | D-003,D-006,D-013,D-017,D-021,D-023,D-024,R-005..R-007,R-013,R-016..R-020 | BK-004,BK-024,BK-025,BK-026,BK-027,BK-028,BK-053,BK-054,BK-055,BK-056 | per-channel idempotency, payload mismatch, amount/currency/account/reference verification, callback replay/order, unknown outcomes, Point busy/cancel/reconcile, cross-channel collision, allocation races, exactly-once settlement/activation, audit |
| Shift/cash | D-014,R-004 | BK-020..022,035 | opening count, close/post race, cash-only reconciliation, immutable close |
| Inventory/POS | D-009,D-015,R-008,R-009 | BK-021,032..036 | count vs adjustment, insufficient stock, duplicate sale, rollback atomicity |
| Rentals/returns | D-007,D-008,R-010,R-011 | BK-005,037..039 | partial boundaries, expiry vs release, refund/stock disposition separation |
| Finance/reports | D-003,D-004,D-020,R-006 | BK-035,041..043 | source reconciliation, role filtering, period/timezone/rounding |
| Gimi/notifications/member renewal | D-016,D-020,D-021,D-022..D-024,R-015,R-018..R-020 | BK-044,BK-045,BK-046,BK-047,BK-054,BK-055,BK-056,BK-057 | verified customer-to-member identity, no disclosure on mismatch, server quote and opaque URL, one-time hosted checkout, callback-only settlement, duplicate/out-of-order events, expiry/supersession, retries/redaction |
| Import/operations | D-001,D-018,D-020 | BK-048..052 | synthetic dry-run, provenance/dedupe, fresh/upgrade schema, restore/rollback |
| Local-first/sync | D-001,D-026..D-030,R-021..R-030 | BK-061,BK-062,BK-063,BK-064,BK-065,BK-066,BK-067,BK-068,BK-069,BK-070,BK-071,BK-072,BK-073,BK-074,BK-075,BK-076 plus feature handlers | partition/reconnect, duplicate receipts, ordered cursor/snapshot, stale/revoked actor, storage failure/upgrade, conflict classification/Admin resolution, device-loss limitation, restore consistency |

For each API write route, require unit/domain tests, API authorization/contract tests, persistence integration tests and concurrency/idempotency tests where applicable. Each frontend integration requires adapter mapping and loading/error/empty/retry proof. Every schema change requires migration checks. Security-sensitive flows require negative authorization and leakage tests.

## Mercado Pago channel-specific proof

- Point: registered terminal/POS/store/branch compatibility, authorized staff and open shift; one click/retry maps to one local intent; busy/already-queued terminal, terminal disconnect, request timeout, cancellation race, `action_required`, late/repeated/out-of-order callbacks and unknown provider status reconcile without blind re-create. Assert Point card never increments cash drawer.
- Online: renewal quote derived from current server catalog and verified member; browser redirect/success query alone cannot activate; test approved, rejected, pending and unknown statuses; verify signed callback with the selected product/event contract, fetch authoritative order status if needed, verify account/scope/order/ref/amount/currency before settlement.
- Cross-channel: race Point and online for one renewal, duplicate both requests, delayed approval after method switch, callback retry, and process crash between provider confirmation and local effect. Assert policy-driven single settlement and activation, with the loser/pending attempt reconciled. Include under/overpay, changed quote, expiry, superseded URL and refund/chargeback cases after D-023/D-024 decisions.
- Provider sandbox proof is not production-terminal proof. Mercado Pago documents Point test credential/state simulation but says a physical Point terminal cannot process a real purchase in sandbox: [Point integration testing](https://www.mercadopago.com.mx/developers/en/docs/mp-point/integration-test). For online Checkout Pro Orders, use test buyer accounts/cards to simulate approved/rejected/pending outcomes and query test order status; no real card is required: [test purchase](https://www.mercadopago.com.mx/developers/es/docs/checkout-pro-orders/integration-test/test-purchase-with-card?scope=prod), [test accounts](https://www.mercadopago.com.mx/developers/es/docs/checkout-api-orders/resources/test-accounts). These tests still do not establish production credentials, live merchant setup, webhook delivery, or real terminal/device compatibility.

## Local-first and synchronization proof matrix

- After successful online provisioning, put a phone and reception PC in independent WAN partitions with no gym LAN; each opens the cached app shell and shows only its own scoped snapshot/as-of cursor. A clean first-ever install while offline is expected to be unavailable.
- Commit local operations, terminate app/process before network, restart and reconnect; verify same operation IDs and local history survive. Simulate server transaction commit with lost HTTP acknowledgement; retry same ID/hash and return one durable receipt/effect. Same ID/changed payload must conflict.
- Push bounded mixed batches with accepted, denied, conflicted, missing dependency and schema-unsupported commands; assert separate outcomes and no all-or-nothing fiction. Parent rejection blocks children; server commit order, not client timestamp/UUID, defines pull.
- Pull pages with replay, reordering, missing page, tombstone, scope removal, expired cursor and inconsistent snapshot attempts; cursor advances only atomically with all page records and returns snapshot-required when needed.
- Reconnect after actor/session/device grant expired or revoked during outage; verify current server authorization, no privilege from altered clock/actor/branch/price, and safe quarantine of real observations rather than false authority. Test other branch/account stale IndexedDB isolation.
- Test same-field profile race, independent additive observations, notes/privacy permissions, cross-device cash receipt vs stock oversell, two rentals for last asset, shift close race, attendance stale entitlement, late online payment callback. Assert noncommutative money/stock/membership/rental/shift state is never silently last-write-wins; actual cash evidence is not erased by selecting canonical record.
- Admin resolution compares base/local/canonical, requires current permission/reason/fresh revision and domain remedy; double-submit/two Admin resolution cannot duplicate compensation. Malicious/rejected operation cannot be authorized through merge.
- Simulate IndexedDB quota/persistence denial, storage eviction/clear, corruption, schema upgrade failure, concurrent tabs, device logout/account switch and app update with pending operations. If journal cannot commit, UI must not say saved or perform irreversible action; incompatible work is retained for recovery, not auto-cleared. Explicitly document that unsynced device loss before upload can lose those records.
- Check offline online-only refusal before side effects for Point/link generation, Gimi, new exclusive rental/stock grants, shared shift close, refund, membership activation and Admin revocation unless a specific policy permits otherwise. For delayed online renewal callbacks, reconcile once; do not replay an old checkout request blindly.
- Restore canonical state, operation receipts/dedupe, high-water change cursor and outboxes together in an authorized non-production exercise; prove restore neither replays a financial operation nor skips a sync change.

## Boundary and money cases

- Zero, smallest valid minor unit, exact limit, one unit over limit, and currency mismatch.
- Line/header totals with discounts, taxes and fees after rounding policy is accepted; never use float arithmetic as authority.
- Date interval exactly at start, exactly at exclusive end, leap day, month end, DST/timezone transition, branch-local midnight.
- Quantity zero, negative, fraction at supported precision, one beyond available stock, repeat consumption and reversal.
- Partial payment, mixed tender, pending/confirmed transfer, over-allocation, partial refund and cumulative return cap.
- Invalid transitions and stale version: transition should conflict without partial writes.

## Concurrency, idempotency, and rollback

- Concurrent register open and concurrent shift close/post: one valid serialization, no post-close write.
- Concurrent payment allocation or credit application: aggregate does not exceed available settled funds/credit.
- Concurrent stock sale against final available unit: at most one successful sale; losing request leaves no partial order or debit.
- Same idempotency key/same payload returns one logical outcome; changed payload conflicts; retry after timeout reconciles unknown external outcome before new side effect.
- Failure injected between order, payment, stock, entitlement, audit and outbox writes leaves either documented atomic result or an explicitly recoverable pending state.
- Duplicate webhook/provider callback and out-of-order callback do not reverse newer state or create duplicate effects.

## Authorization and privacy checks

- Unauthenticated vs forbidden; cross-org/branch identifiers do not leak existence.
- Role-specific access to member notes, eligibility evidence, compensation, payment metadata, audit and exports.
- Expired/revoked sessions and paired-device revocation fail immediately under the chosen token model.
- Logs, error bodies, audit payloads and notifications omit secrets, full payment data and unnecessary PII.
- Gimi denied action is tested as a real denied application use case, not only hidden from prompt/UI.
- Verify that staff/Admin identity cannot substitute for the customer-to-member proof required by D-022; mismatched identity reveals no member existence or renewal information.
- Admin recovery, employee enrollment, device pairing/list/revoke each have negative role, replay, expiry, rate-limit, and audit-redaction cases.

## Migrations and data integrity

- Build database from empty state and upgrade from the last supported baseline; schema version and indexes match expected state.
- For Alembic, verify every current revision ID fits the explicit tracking-column width, fresh and offline table creation use that width, and PostgreSQL widens existing short version tables before updating revisions; exercise the actual PostgreSQL chain, not only SQLite or generated SQL.
- Validate constraints against malformed/null/duplicate records and foreign-key cleanup behavior.
- For data-sensitive migrations, test backup, dry-run, row-count reconciliation, restore, idempotent rerun and explicit abort threshold.
- Destructive/down migrations are conditional on verified backup and compatibility; prefer forward repair where rollback would lose accepted data.
- Run migration while service/version compatibility assumptions hold; document expansion/contraction stages for renames or changed nullability.

## Future verification workflow

1. Identify runnable deterministic tests relevant to the exact change; observe RED before implementation when applicable.
2. Implement one slice and observe GREEN; run focused tests during iteration and all applicable checks at task close.
3. Capture exact commands, exit/result, environment dependency and failures in the ledger template. A command proposed in a plan is not evidence that it ran.
4. Structural/API/database/security proof may be separate; do not substitute mocked unit tests for transaction behavior where a real DB test is required.
5. Normalize source before native review START; candidate identity changes if bytes/path/mode change. Keep RDD user-owned and follow the native returned plan only if enabled.

The P1 API scaffold now uses its isolated `api/.venv`, pytest, Alembic, and opt-in synthetic PostgreSQL checks; these do not authorize frontend commands or access to private notebook data. BK-012 local checks cover request/error redaction, liveness/readiness bounds, finite metrics, transaction-owned audit, migration `0004`, and a defined early CI workflow. Hosted CI remains unexecuted; deployment, audit retention/access, and production readiness remain separate evidence gates.

## Missing-work audit

At phase exit and after every scope change, generate a coverage join across modules/entities/endpoints, `D-` decisions, `R-` invariants, `BK-` tasks, actor roles, migrations, frontend slices and proof classes. For sync include each client command type, offline capability/freshness, server use case, event/snapshot schema, denial/conflict class, PII retention, supported client range, device-local loss mode, and recovery/backup proof. Flag any domain with no owner task; any write endpoint without authorization/idempotency/transaction definition; any table without a data-retention owner; any rule without tests; any UI workflow without an API mapping; any report without a source and metric definition; any unreferenced BK ID; and any dependency cycle or unresolved predecessor. Resolve each gap by adding or reopening a task—never silently checking a sibling task as a substitute.

### Release evidence ledger (empty)

| Gate | Evidence link / command | Observed result | Gap / owner |
|---|---|---|---|
| Domain decisions | — | Not run | D-001 onward unresolved |
| Fresh schema / upgrade | — | Not run | Stack and DB not selected |
| Auth/security | — | Not run | Backend not implemented |
| API/frontend contracts | — | Not run | API not implemented |
| Point + hosted online checkout | — | Not run | Both provider channels are planned; no sandbox or live operation performed |
| Gimi renewal identity + Admin/device lifecycle | — | Not run | D-022,D-025 unresolved; backend not implemented |
| Local-first partition/sync/conflict/restore | — | Not run | D-027..D-030 remain unresolved; no offline implementation or test has run |
| Money/concurrency | — | Not run | Domain slices not implemented |
| Backup/restore | — | Not run | Environment not authorized |
| Migration reconciliation | — | Not run | Import not authorized |

## Performance targets

No latency, throughput, or availability target is approved. Collect realistic synthetic workload shapes and set service-level objectives before performance gating. Measure query plans, pagination and contention on representative data volume; do not invent thresholds from a laptop benchmark.
