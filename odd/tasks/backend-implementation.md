# EvoGym FastAPI Backend — Implementation Plan

**Status: P1 in progress — BK-008/BK-009 Done; BK-010/BK-011 Partial; BK-012 Partial (local foundation independently verified; hosted/operational proof pending).** Starting with BK-012, the master ledger and eight linked backend-plan documents are versioned with implementation; every future backend commit must include the updated master plan. Earlier source commits did not include the then-local planning documents. Private notebook workspaces remain separate. BK-012 adds only safe observability, health, audit, metrics and an early CI definition; hosted CI is not executed.

## Quick path and reading order

1. Read the [domain and schema map](../../docs/backend-plan/01-domain-and-schema.md).
2. Resolve the [business rules and decisions](../../docs/backend-plan/02-business-rules-and-decisions.md) that block affected work.
3. Follow the proposed [architecture and API contract](../../docs/backend-plan/03-architecture-and-api.md).
4. Execute the phase cards in [implementation phases](../../docs/backend-plan/04-implementation-phases.md); verify against [coverage criteria](../../docs/backend-plan/05-verification-and-coverage.md).
5. Apply [security and operations](../../docs/backend-plan/06-security-and-operations.md) and [frontend/data migration](../../docs/backend-plan/07-frontend-migration-and-data.md).
6. Read the required [local-first and sync architecture](../../docs/backend-plan/08-local-first-and-sync.md) before any frontend data slice, offline-capable command or release decision.

Only the master ledger owns BK task status. Subdocuments define acceptance, decisions, and proof expectations; do not maintain parallel checkboxes there.

## Objective, problem, and why

Create a production-capable, incremental **FastAPI** backend for the existing EvoGym operational frontend, with transactional records for people, access, sales, cash, inventory, rentals, staff, payments, and reporting. The frontend is currently a demonstration system whose aggregate types and local/demo state are not a verified persistence contract. Money, attendance, inventory, and shift closure need explicit business invariants before database writes are safe. Mercado Pago Point terminal payments and one-time hosted Checkout Pro links for Gimi membership renewal are both required channels (D-021).

The current backend is an incremental FastAPI/SQLAlchemy foundation in `api/`, with traced decisions and migrations. Future domain schema remains subject to its task-specific owner decisions; no frontend, private notebook, or production data has been integrated.

## Authorization and boundaries

| Authorized now | Not authorized by this plan |
|---|---|
| Write and structurally verify these planning documents. | Implement service code, migrations, schema files, or dependencies. |
| Record current evidence and unresolved decisions without guessing. | Read personal workbooks/datasets or import any real member/business data. |
| Propose tasks, interfaces, checks, and safe future gates. | Contact remote services, deploy, create real payments, or use ambient credentials. |
| Historical authorization completed BK-008..BK-010; current BK-011 authorization is internal roles, Admin-assigned receptionist branch checks, and opaque revocable sessions. | Read or alter notebook data, add public auth/admin/device endpoints, infer production session TTL, contact remote services or ambient DBs, use real credentials, deploy, or create payment orders. |

Future implementation must confirm target organization/branch scope, stack choices, and blocked business rules. Deployment, real-data import, and external payment execution each require explicit authorization for destination, operation, and credential/session.

## Baseline evidence and assumptions

- `docs/database-map.md` is explicitly a proposed logical design, not approved physical schema or executable SQL. It proposes PostgreSQL, UUID identities, MXN integer centavos, and versioned operational records; exact columns and constraints remain unsettled.
- No FastAPI backend is implemented. The `backend/` area is a local notebook/data workspace; never treat it as an application target or inspect private workbooks as part of this plan.
- `frontend/src/domain/models.ts` is a demo aggregate. `DemoProvider`/localStorage is broadly coupled (71 callers observed in prior exploration), while some independent stores exist; migration needs an adapter seam and one source of truth per slice.
- Existing requirements document credit limit default 0, debt blocking new credit and check-in, hardware RFID and membership freezes out of scope, hashed staff credentials with brute-force defenses, both Mercado Pago payment channels, Gimi and notifications in scope, shift-opening denomination counts/inventory audit, overtime flag, and separate labor attendance with 6-digit pairing. Standalone-device operation is formalized as a Store-and-Forward Contingency Mode (D-026, D-027): previously provisioned reception devices operate independently during WAN outage without a gym LAN, recording append-only events (check-ins, cash counter sales `REC-xxx`, cash renewals, basic registrations, and shift closing *Arqueo Físico*) into an IndexedDB queue, flushing to FastAPI in seconds via WAN or mobile hotspot tethering with asynchronous discrepancy auditing.
- Unresolved: trial policy; fees/taxes/settlement; cross-channel payment collision; link expiry/supersession; admin recovery/MFA and enrollment; grant freshness/revocation TTLs, local retention/quota, and backup RPO/RTO. (D-001 is resolved via single-organization multi-branch architecture and BK-001 is Done; D-002 is resolved via UUID PKs and decoupled human folios; D-004 is resolved via UTC TIMESTAMPTZ storage and branch IANA timezones with BK-002 Done; D-005 is resolved via immediate activation for new members, early renewal chaining, calendar month duration, and [starts_on, ends_on) interval semantics with BK-003 Done; D-003 is resolved via 64-bit integer centavos in MXN; D-006 is resolved via pending transfer reconciliation and decoupled togglable method with BK-004 Done; D-007 is resolved via non-refundable memberships and same-day product returns; D-008 is resolved via distinct glove/locker rental lifecycles; D-009 is resolved via bulk container opening to bar stock and scoop decrement with BK-005 Done; D-011 is resolved via baseline admin/receptionist roles, admin-unlocked reception kiosk with PIN switching, and admin-paired single-device mobile enrollment; D-012 is resolved via receptionist operational profile vs admin full financial/audit visibility with BK-006 Done; D-022 is resolved via WhatsApp verified phone match; D-026 and D-027 are resolved by the Contingency Mode capability matrix). See decision register and contingency mode plan.

## Global Definition of Ready and Done

**Ready:** task has an identified decision owner and accepted rule where required; request/response and persistence changes are scoped; security and data sensitivity are classified; dependencies and migration/recovery implications are known; relevant runnable tests and expected behavior are named. A blocked decision stops only the affected slice where safe isolation is possible.

**Done:** acceptance criteria are observed, database and API invariants agree, actor and scope authorization is tested, migration is reversible or explicitly has a safe forward-recovery plan, evidence is recorded below, and frontend/demo behavior has no ambiguous mixed source of truth. Offline-capable commands distinguish local provisional state, server acceptance, conflict and recovery; replay is not authoritative settlement or authorization. “Done” means the task's proof is complete, not that a checkbox was merely discussed.

## Planned implementation route by task

All BK tasks use **delegated direct** by default; this route declaration does not authorize implementation. Route categories cover every ledger ID: **decision/exploration** BK-001–BK-007; **verification** BK-015 and BK-052; **multi-file/preparation** BK-008–BK-014, BK-016–BK-051, and BK-053–BK-060; **decision/exploration** BK-061; **multi-file/preparation** BK-062–BK-076. These triggers reflect decision work, reading that prepares implementation, cross-file slices, or command-based verification. No inline implementation exception is justified at planning time. Reclassify only if later authorized scope proves atomic and already understood; tests/builds remain delegable verification actions.

## Phases and delivery forecast

| Phase | Scope | Prerequisite / gate | Provisional authored change forecast |
|---|---|---|---:|
| P0 | Domain, rules, scope decisions | Owner decisions for scope and time/money conventions | 100–220 lines |
| P1 | Foundation, database, Admin/staff enrollment, local shell, contingency queue and store-and-forward substrate | P0 scope/auth/contingency decisions | 900–1,600 |
| P2 | Read-only member slice with scoped offline cache | P1 secure persistence/API and sync bootstrap/pull baseline | 160–320 |
| P3 | Members, catalog, plans | P2 and member/privacy policy | 220–450 |
| P4 | Shift opening and operational prerequisites | Register, opening counts, audit and concurrency design | 160–330 |
| P5 | Orders, memberships, settlement, Point and online payment adapters | Activation and payment decisions | 500–900 |
| P6 | Attendance and trials | Entitlement/trial policy | 180–360 |
| P7 | POS, products, stock, supplements | Shift, stock, serving conversion decisions | 320–650 |
| P8 | Rentals, returns and refunds | Rental and disposition decisions | 240–500 |
| P9 | Expenses, staff, compensation, reports | Finance, roles and privacy retention | 300–600 |
| P10 | Gimi verified renewal/link delivery and notifications | Tool permissions, verified customer identity, payment reconciliation | 300–600 |
| P11 | Legacy migration, deployment, backup/restore and local-first release gate | Explicit authorization; sync proof complete | 350–750 |

Ranges are planning estimates, not acceptance thresholds; generated files excluded. Delivery strategy is **ask-on-risk**. If the forecast or running total exceeds about 400 authored lines, ask once for `stacked-to-main` or `feature-branch-chain` before the next commit. The chain choice is pending; no commit/stage/branch/remote action is authorized for this BK-008 handoff. RDD is off by clone-local preference and remains untouched. Later implementation continues only under explicit scoped authorization; RDD consent remains candidate-scoped.

## Progress protocol

Update the task's master row only after observing evidence. Use `Not started`, `In progress`, `Blocked`, `Partial`, `Deferred`, or `Done`; do not mark implementation tasks complete because this plan was written. A blocked task records the exact decision/evidence needed. A partial result records what passed and the remaining gap. A deferred item needs reason and a revisit trigger.

Evidence entry template:

```text
Date / task ID:
Outcome: (Done | Partial | Blocked | Deferred)
Relevant files / commit identity (if applicable):
Exact command(s): (write “not run” when not run)
Observed result per command: (pass/fail/skipped + concise output)
Decision/rule references:
Coverage and authorization evidence:
Remaining gap / next action:
Reviewer/receipt: (only if applicable; never fabricate)
```

After each accepted scope change, map impacted `D-`, `R-`, and `BK-` references, reopen affected tasks with reason, preserve unrelated completed work, and run the missing-work audit in [coverage criteria](../../docs/backend-plan/05-verification-and-coverage.md#missing-work-audit). Do not silently broaden scope.

## Authoritative task ledger

Ledger totals: **9 Done, 3 Partial, 64 Not started (76 total)**. Original P0 decision tasks BK-001–BK-007 are Done; additional P0 task BK-061 remains Not started pending its own acceptance evidence. BK-008/BK-009 are Done; BK-010/BK-011 remain Partial (internal foundations only) and BK-012 is Partial pending review/commit and operational proof. Dependencies use BK IDs. Detailed execution cards and acceptance criteria are in [phase cards](../../docs/backend-plan/04-implementation-phases.md#phase-cards). Local-first protocol and unresolved policy are specified in [08-local-first-and-sync](../../docs/backend-plan/08-local-first-and-sync.md).

| ID | Phase / task | Status | Depends on | Acceptance / proof |
|---|---|---|---|---|
| BK-001 | P0 Confirm organization, branch and tenant boundary | Done | — | D-001 confirmed by user: single-organization multi-branch architecture with isolated instance-per-client commercialization; org-shared members/catalog and branch-isolated cash/terminals/stock/visits documented; 04/P0 |
| BK-002 | P0 Approve identity, date and time conventions needed by first slice | Done | BK-001 | D-002 confirmed (UUID PKs, decoupled human-facing folios); D-004 confirmed (UTC TIMESTAMPTZ storage, branch IANA timezone); monetary conventions D-003 gate money-bearing phases only |
| BK-003 | P0 Approve membership validity and activation rules | Done | BK-001,BK-002 | D-005 confirmed by user: immediate activation for new/inactive members (`starts_on = payment_date`), early renewal chaining from `current_membership.ends_on`, calendar month duration with clamp logic, [starts_on, ends_on) interval in branch timezone; R-001..R-003 |
| BK-004 | P0 Approve money conventions, transfer settlement and pending-sale behavior | Done | BK-001,BK-002 | D-003 confirmed by user: 64-bit integer minor units (`bigint` centavos) in MXN; D-006 confirmed by user: bank transfers recorded as `pending` requiring staff reconciliation before settlement/activation/stock decrement, modeled as decoupled togglable method |
| BK-005 | P0 Approve returns, refunds, rentals and stock conversion policies | Done | BK-001 | D-007 confirmed by user (memberships non-refundable without admin override; same-day POS product returns with receipt to sellable or damage stock); D-008 confirmed by user (distinct daily glove session return invariant vs monthly locker 2-week grace/eviction lifecycle); D-009 confirmed by user (bulk container opening to bar stock and scoop decrement); R-006, R-010, R-011 |
| BK-006 | P0 Approve baseline auth scope and member-data access policy | Done | BK-001 | D-011 confirmed by user (admin/receptionist roles in extensible catalog, admin-provisioned kiosk with bcrypt PIN switch, admin-paired single-device mobile enrollment with revoke); D-012 confirmed by user (receptionist sees operational profile: name, number, photo, phone/WhatsApp, status, emergency contact; admin sees operational profile + financial transactions, compensation, and audit logs) |
| BK-007 | P0 Ratify domain glossary and source-of-truth map | Done | BK-001,BK-002,BK-006 | Ratified by user: canonical source of truth established as PostgreSQL (plus local IndexedDB contingency outbox); demo state classified as provisional legacy; unresolved later-phase policies deferred without blocking P1; 01 |
| BK-008 | P1 Create backend service boundary and configuration contract | Done | BK-001,BK-002,BK-006,BK-007 | Isolated service/configuration scaffold and local proof; committed as b080aee |
| BK-009 | P1 Establish persistence/session and migration workflow | Done | BK-008 | Explicit SQLAlchemy sessions and Alembic baseline; live PostgreSQL fresh/repeated/predecessor upgrades and rollback verified; fa84fcd |
| BK-010 | P1 Implement staff identity, secure credentials and rate limits | Partial | BK-006,BK-009 | PIN foundation db73310: bcrypt, 5 failures/300s, atomic pending Admin event, live PG concurrency verified; password/reset/login and alert delivery still gated |
| BK-011 | P1 Implement roles, scoped authorization and revocable sessions | Partial | BK-001,BK-010 | Internal branch/session foundation 497ef70, live PostgreSQL 44 passed; current PIN/grants refreshed under locks and org uniqueness enforced; production TTL/device proof/public route pending |
| BK-012 | P1 Add request IDs, structured errors, health, audit and baseline CI | Partial | BK-008,BK-009 | Correlated safe errors/logs, finite metrics, bounded health probe, caller-transaction audit and PostgreSQL CI definition; local proof only, hosted CI unrun, retention/access/production operations pending |
| BK-013 | P2 Add member read DTO/query and API contract | Not started | BK-011,BK-012 | Read-only member slice; OpenAPI and DTO mapping |
| BK-014 | P2 Integrate frontend member list behind local-first API adapter | Not started | BK-013,BK-062,BK-063,BK-065,BK-067,BK-071,BK-072 | Scoped cached reads work offline; one local command/read boundary; no mixed demo/live member source |
| BK-015 | P2 Establish API contract and migration smoke suite | Not started | BK-009,BK-013 | Contract and fresh DB checks run in CI |
| BK-016 | P3 Persist members, notes and eligibility records | Not started | BK-013,BK-015 | Privacy, uniqueness and actor rules; 01/06 |
| BK-017 | P3 Build services, plan versions and eligibility catalog | Not started | BK-016 | Published terms immutable; historical references stable |
| BK-018 | P3 Implement member create/update/search flows | Not started | BK-016 | Validation, scope, duplicate-friendly natural identifiers |
| BK-019 | P3 Integrate member profile and catalog UI incrementally | Not started | BK-017,BK-018 | Per-slice source of truth and DTO translation documented |
| BK-020 | P4 Persist registers, terminals and shift opening | Not started | BK-011,BK-015 | One-open-shift concurrency; opening cash/counts and audit |
| BK-021 | P4 Implement opening denomination and inventory audit capture | Not started | BK-020 | Count evidence is distinct from stock adjustment |
| BK-022 | P4 Define shift posting lock and overtime transition | Not started | BK-020 | Concurrent close/post tests; R-004 |
| BK-023 | P5 Persist orders and immutable item snapshots | Not started | BK-017,BK-022 | Totals and line/source constraints; no catalog rewrite |
| BK-024 | P5 Implement payments, allocations and idempotency | Not started | BK-004,BK-023 | Duplicate/retry/payload mismatch safe; 02/05 |
| BK-025 | P5 Implement transfer verification and settlement | Not started | BK-004,BK-024 | Pending is not settled; actor/evidence retained |
| BK-026 | P5 Implement credit entries and debt gates | Not started | BK-016,BK-024 | Limit default 0; debt blocks new credit/check-in |
| BK-027 | P5 Implement membership activation, entitlements and renewal | Not started | BK-003,BK-023,BK-024 | Activation explicit and date/overlap invariants tested |
| BK-028 | P5 Integrate checkout and membership frontend adapter | Not started | BK-025..BK-027 | Payment state distinct from entitlement state |
| BK-029 | P6 Implement member check-in against entitlements/debt | Not started | BK-026,BK-027 | Unauthorized, blocked and repeat-visit cases covered |
| BK-030 | P6 Implement trial visit lifecycle | Not started | BK-029 | D-019 trial policy resolved; trial cannot accidentally create a membership |
| BK-031 | P6 Integrate attendance/trial API flows | Not started | BK-029,BK-030 | Staff workflow resilient to retry and errors |
| BK-032 | P7 Implement product catalog and stock movement ledger | Not started | BK-021,BK-022 | Count != adjustment; valuation and provenance retained |
| BK-033 | P7 Implement POS product sale and atomic stock deduction | Not started | BK-023,BK-024,BK-032 | Double-sale/rollback/insufficient-stock tests |
| BK-034 | P7 Implement supplement serving sales/conversion | Not started | BK-005,BK-032,BK-033 | Approved conversion; separate line/history/report type |
| BK-035 | P7 Implement cash movements, expenses and shift reconciliation | Not started | BK-022,BK-024 | Only cash affects drawer; immutable close snapshot |
| BK-036 | P7 Integrate POS, stock and shift frontend slices | Not started | BK-033..BK-035 | No duplicate local/backend posting on retry |
| BK-037 | P8 Implement rental assets, rates and rental lifecycle | Not started | BK-005,BK-022 | Explicit return/release and exception rules |
| BK-038 | P8 Implement partial returns, refunds and dispositions | Not started | BK-005,BK-024,BK-032 | Cannot exceed sold/refundable amount; reversal trace |
| BK-039 | P8 Integrate rental/return/refund workflows | Not started | BK-037,BK-038 | Pending refund not represented as completed |
| BK-040 | P9 Implement staff labor attendance | Not started | BK-006,BK-010,BK-011 | Labor attendance remains separate from member visits |
| BK-041 | P9 Implement compensation, expenses, extras and budgets | Not started | BK-006,BK-022,BK-035 | Restricted compensation and distinct movement classes |
| BK-042 | P9 Implement operational/financial reports from event sources | Not started | BK-027,BK-033,BK-035,BK-038,BK-041 | Reconciled source definitions and access rules |
| BK-043 | P9 Integrate admin/staff reporting incrementally | Not started | BK-040..BK-042 | Metrics match source records and selected period |
| BK-044 | P10 Define Gimi read/write permissions and disclosure rules | Not started | BK-006,BK-016 | Tool allowlist and purpose/access matrix approved |
| BK-045 | P10 Implement Gimi domain-safe queries/actions and audit | Not started | BK-044,BK-011 | No direct persistence bypass; all actions authorized |
| BK-046 | P10 Implement notification outbox and delivery lifecycle | Not started | BK-006,BK-012 | Idempotent enqueue, retries, redacted content |
| BK-047 | P10 Integrate Gimi/notification UI with consent/error states | Not started | BK-045,BK-046 | Safe failure, no duplicate side effect |
| BK-048 | P11 Inventory legacy demo stores and define mapping | Not started | BK-007,BK-019,BK-036 | No personal dataset read; deterministic synthetic mapping |
| BK-049 | P11 Build dry-run import/validation/provenance pipeline | Not started | BK-048 | Counts, rejects, dedupe and reconciliation evidence |
| BK-050 | P11 Complete production-readiness deployment, backup and restore runbook | Not started | BK-009,BK-012 | Production-readiness evidence and restore rehearsal in explicitly authorized non-production target |
| BK-051 | P11 Execute authorized synthetic/approved-data migration rehearsal | Not started | BK-049,BK-050 | Explicit authorization, matched balances, rollback trigger |
| BK-052 | P11 Release readiness, observability and rollback gate | Not started | BK-015,BK-042,BK-046,BK-050,BK-051,BK-053..BK-060,BK-076 | Both payment channels, Gimi renewal, Admin lifecycle, local-first sync, backup/restore and related proof complete; no unexplained gaps |
| BK-053 | P5 Integrate reception card orders with physical Mercado Pago Point terminal | Not started | BK-020,BK-022,BK-024 | Open shift, authenticated actor, provider-compatible POS/terminal mapping, scoped amount/currency and safe duplicate-click handling; Point status/reconciliation acceptance in 04 |
| BK-054 | P5 Create one-time hosted Checkout Pro order/link for membership renewal | Not started | BK-023,BK-024,BK-027 | Server-calculated quote and immutable order snapshot; no recurring subscription; hosted URL and expiry behavior verified; acceptance in 04 |
| BK-055 | P5 Implement product-specific provider callbacks and payment reconciliation | Not started | BK-053,BK-054 | Public signature-validated webhook ingress, durable dedupe, async status query and amount/currency/account/scope verification; no blind retries |
| BK-056 | P5 Enforce exactly-once settlement across competing Point/online attempts | Not started | BK-053,BK-054,BK-055 | D-023 resolves same-renewal concurrency/method switch; no double settlement or activation |
| BK-057 | P10 Verify Gimi customer identity and deliver membership renewal checkout link | Not started | BK-027,BK-044,BK-046,BK-054,BK-055,BK-056 | D-022 incoming verified WhatsApp phone number matched with registered member mobile before quote/link disclosure; delivery retriable without duplicate order |
| BK-058 | P1 Implement Admin login, recovery and session administration | Not started | BK-010,BK-011 | D-025 recovery/MFA and authorization resolved; admin can safely recover own access and inspect/revoke authorized sessions |
| BK-059 | P1 Implement Admin employee enrollment-code issue/list/revoke | Not started | BK-011,BK-058 | One-time, expiring, rate-limited code lifecycle and staff enrollment audit; raw code shown only at issue |
| BK-060 | P1 Implement Admin-managed device enrollment/list/revoke | Not started | BK-011,BK-058,BK-059 | 6-digit pairing code expiry, attempt limits, device binding, admin list/revoke and audit; no credential/code secrets in logs |

| BK-061 | P0 Define Contingency Mode capability matrix, store-and-forward boundaries and hotspot handling | Not started | BK-001,BK-002,BK-006 | D-026, D-027 ratified; offline-allowed append-only events (check-in, cash sale, cash renewal, registration, shift Arqueo Físico) vs online-only boundaries explicit; hotspot tethering documented; 08 |
| BK-062 | P1 Cache PWA application shell and reception assets for offline launch | Not started | BK-008,BK-061 | Standalone launch without WAN after install; service worker caches static assets only; no unverified API caching; 08 |
| BK-063 | P1 Implement scoped IndexedDB read caches and local event queue schema | Not started | BK-008,BK-062 | Stores cached active members, catalog, register state, and append-only local_event_queue; quota/error handling and schema migrations; 08 |
| BK-064 | P1 Implement unified contingency command boundary and append-only event queue | Not started | BK-061,BK-063 | Single command dispatcher; offline-allowed actions generate device-prefixed immutable events (e.g. REC-xxx) committed atomically with local cache updates; 08 |
| BK-065 | P1 Implement device bootstrap endpoint for read model seeding | Not started | BK-011,BK-063,BK-064 | POST /api/v1/sync/bootstrap provisions device token and downloads compact active member roster, pricing, catalog, and register status; 08 |
| BK-066 | P1 Implement store-and-forward event batch ingestion and idempotency receipts | Not started | BK-009,BK-011,BK-064 | POST /api/v1/sync/contingency-events ingests event batches atomically; deduplicates on (event_id, payload_hash); returns durable per-event receipts; 08 |
| BK-067 | P1 Implement incremental read-cache refresh for active roster and catalog | Not started | BK-065,BK-066 | GET /api/v1/sync/roster-delta pulls updated/deactivated member records and catalog changes via timestamp cursor without multi-master complexity; 08 |
| BK-068 | P1 Implement staff offline PIN authentication and bounded contingency grant | Not started | BK-011,BK-061,BK-065 | Staff verifies against local bcrypt PIN hash for offline actions; explicit grant TTL (24-48h); server rechecks authorization on event flush; 08 |
| BK-069 | P1 Implement append-only event reconciliation, close-timestamp dedupe and stock audits | Not started | BK-061,BK-066,BK-067 | Server merges append-only event streams; deduplicates close member check-ins (<5 min); applies cash sales to stock ledger with variance audit flags; 08 |
| BK-070 | P1 Implement shift Arqueo Físico reconciliation and discrepancy audit logging | Not started | BK-011,BK-058,BK-069 | Server evaluates shift.arqueo_close declarations against calculated cash sales; flags cash drawer and stock variances for Admin audit sign-off; 08 |
| BK-071 | P1 Implement client Contingency Flush Manager and connectivity detection | Not started | BK-064,BK-065,BK-066,BK-067 | Auto-detects reconnect/hotspot tethering; flushes local_event_queue via exponential backoff; updates UI status (Offline / Syncing / Synced); 08 |
| BK-072 | P1 Enforce frontend capability guard for online-only features | Not started | BK-061,BK-063,BK-064,BK-068,BK-069 | Strictly blocks Mercado Pago Point, Checkout Pro links, Gimi AI, catalog edits, and complex refunds upfront when disconnected; 08 |
| BK-073 | P1 Coordinate multi-tab event queue sequencing and storage persistence | Not started | BK-063,BK-064,BK-066,BK-067 | IndexedDB locks prevent duplicate event dispatch across browser tabs; queue persists across browser restarts and version upgrades; 08 |
| BK-074 | P1 Verify Contingency Mode fault tolerance, hotspot flush and shift handoff | Not started | BK-068,BK-069,BK-070,BK-071,BK-072,BK-073 | Synthetic tests verify offline check-in, cash counter sales with REC-xxx, offline Arqueo Físico shift handoff, hotspot reconnect flush, and stream merge; 08 |
| BK-075 | P11 Define central database backup/PITR and un-flushed device queue loss runbooks | Not started | BK-050,BK-073 | RPO/RTO targets; restore verified for canonical events and audit logs; runbook for device destruction mitigations via physical receipts/arqueo; 08 |
| BK-076 | P11 Gate Contingency Mode production rollout on store-and-forward reliability | Not started | BK-074,BK-075 | Queue throughput, hotspot recovery speed, cash drawer discrepancy audit accuracy, and zero lost recorded cash sales verified before launch; 08 |

## Current progress and next action

- Progress: 9 of 76 tasks Done, 3 Partial (BK-010/BK-011/BK-012), and 64 Not started. BK-061 remains Not started.
- BK-012 local proof: prior suite 54 passed/4 skipped; correction RED exposed readiness, uncaught-500, metric-cap and unsupported-audit failures. Latest root/API-local suites each 63 passed/4 skipped; pip check/YAML passed. One fresh local PG attempt was cleaned but its probe script had Python syntax error before PG was exercised; prior independent PostgreSQL evidence applies only to the original implementation. Hosted CI not run.
- Next: parent readback, independent verification, and a work-unit commit that includes this master ledger plus all eight planning documents. Remaining BK-010/BK-011 production authentication/device/TTL, alert delivery and reset gates stay open; BK-012 does not close retention/access or deployment readiness.

### Evidence log

```text
2026-10-19 / BK-001:
Outcome: Done
Relevant files: docs/backend-plan/01-domain-and-schema.md, docs/backend-plan/02-business-rules-and-decisions.md, odd/tasks/backend-implementation.md
Exact command(s): not run (documentation formalization)
Observed result per command: n/a
Decision/rule references: D-001 confirmed by user
Coverage and authorization evidence: User confirmed single-organization multi-branch architecture with shared members/catalog and branch-isolated cash, terminals, stock, and visits.
Remaining gap / next action: BK-002 (Approve identity, date and time conventions needed by first slice)
Reviewer/receipt: Confirmed by user

2026-10-19 / BK-002:
Outcome: Done
Relevant files: docs/backend-plan/02-business-rules-and-decisions.md, odd/tasks/backend-implementation.md
Exact command(s): not run (documentation formalization)
Observed result per command: n/a
Decision/rule references: D-002, D-004 confirmed by user
Coverage and authorization evidence: User confirmed UUID PKs (UUIDv7/v4) with decoupled human-facing folios (D-002), and UTC TIMESTAMPTZ storage with branch IANA timezones (D-004).
Remaining gap / next action: BK-003 (Approve membership validity and activation rules)
Reviewer/receipt: Confirmed by user

2026-10-19 / BK-003:
Outcome: Done
Relevant files: docs/backend-plan/02-business-rules-and-decisions.md, odd/tasks/backend-implementation.md
Exact command(s): not run (documentation formalization)
Observed result per command: n/a
Decision/rule references: D-005 confirmed by user, R-001, R-002
Coverage and authorization evidence: User confirmed D-005 rules: new/inactive member activation immediately upon confirmed payment (starts_on = payment_date); early renewal chaining seamlessly from current expiration (starts_on = current_membership.ends_on) with zero truncated days; calendar month duration with clamp logic; [starts_on, ends_on) interval semantics in branch timezone; payment settlement distinct from activation (R-001); freezes out of scope (D-010).
Remaining gap / next action: BK-004 (Approve money conventions, transfer settlement and pending-sale behavior)
Reviewer/receipt: Confirmed by user

2026-10-19 / BK-004:
Outcome: Done
Relevant files: docs/backend-plan/02-business-rules-and-decisions.md, odd/tasks/backend-implementation.md
Exact command(s): not run (documentation formalization)
Observed result per command: n/a
Decision/rule references: D-003, D-006 confirmed by user, R-005, R-006
Coverage and authorization evidence: User confirmed D-003 monetary conventions (strict 64-bit integer minor units / bigint centavos in MXN, eliminating floating-point errors) and D-006 transfer settlement policy (SPEI transfers recorded as pending without settlement, membership activation, or permanent stock decrement until manual staff reconciliation against bank statements; modeled as decoupled togglable payment method for future deprecation readiness).
Remaining gap / next action: BK-005 (Approve returns, refunds, rentals and stock conversion policies)
Reviewer/receipt: Confirmed by user

2026-10-19 / BK-005:
Outcome: Done
Relevant files: docs/backend-plan/02-business-rules-and-decisions.md, odd/tasks/backend-implementation.md
Exact command(s): not run (documentation formalization)
Observed result per command: n/a
Decision/rule references: D-007, D-008, D-009 confirmed by user, R-006, R-010, R-011
Coverage and authorization evidence: User confirmed D-007 (memberships non-refundable once activated unless authorized admin override; same-day POS product returns with receipt to sellable or waste ledger), D-008 (distinct lifecycles: daily session rental for gloves with physical departure return invariant; monthly rental for lockers with disponible -> ocupado -> vencido -> 2-week grace period -> desalojado eviction, plus fuera_de_servicio and empleado administrative statuses), and D-009 (bulk container opening posts inventory movement to bar consumption stock; individual scoops decrement active container until depleted).
Remaining gap / next action: BK-006 (Approve baseline auth scope and member-data access policy)
Reviewer/receipt: Confirmed by user

2026-10-19 / BK-006:
Outcome: Done
Relevant files: docs/backend-plan/02-business-rules-and-decisions.md, odd/tasks/backend-implementation.md
Exact command(s): not run (documentation formalization)
Observed result per command: n/a
Decision/rule references: D-011, D-012 confirmed by user, R-012, R-014
Coverage and authorization evidence: User confirmed D-011 (baseline admin/receptionist roles via extensible role catalog; reception PC kiosk provisioned by admin login with bcrypt-hashed PIN staff switching and 5-attempt lockout; mobile receptionist access strictly paired via admin-issued one-time token with 1-device limit and immediate admin revocation) and D-012 (receptionist visibility restricted to operational profile: full name, member number, photo, phone/WhatsApp, membership status, emergency contact; admin retains full access to financial history, staff compensation, and audit logs).
Remaining gap / next action: BK-007 (Ratify domain glossary and source-of-truth map)
Reviewer/receipt: Confirmed by user

2026-10-19 / BK-007:
Outcome: Done
Relevant files: docs/backend-plan/01-domain-and-schema.md, odd/tasks/backend-implementation.md
Exact command(s): not run (documentation formalization)
Observed result per command: n/a
Decision/rule references: D-001, D-002, D-004, D-005, D-006, D-007, D-008, D-009, D-011, D-012, D-026, D-027 ratified
Coverage and authorization evidence: Domain glossary, entity relationship map, and source-of-truth boundaries formally reviewed and ratified by user. Canonical source of truth established as PostgreSQL (plus local IndexedDB contingency outbox for offline continuity); demo state (DemoProvider / localStorage) formally classified as provisional legacy to be adapted slice-by-slice behind API adapter seams. Unresolved policies for later phases (e.g. detailed accounting categorization, Gimi tool call scopes) remain explicitly deferred to their respective phases without blocking Phase P1. Phase P0 is 100% complete.
Historical next action (superseded by the explicit 2026-10-19 P1 authorizations below): begin BK-008; no current pause remains for the authorized local BK-012 slice.
Reviewer/receipt: Confirmed by user
```

## Key Learnings

1. The database map is a proposal, so schema approval remains a separate owner decision.
2. Payment settlement and membership activation are separate state transitions.
3. The backend workspace contains notebook data, not a FastAPI service target.

## P1 execution authorization — 2026-10-19

The latest user instruction supersedes the historical documentation-only authorization for local P1 implementation. Begin with BK-008 only: isolated api/ service scaffold, validated environment settings, local tests, and startup documentation. Preserve all existing notebook/data and frontend changes. No data import, external services, credentials, deployment, payments, push, or PR creation is authorized. Dependency installation is local to a new api/.venv; public package/documentation retrieval only, with no credentials.

Route: delegated direct (Luna), triggered by preparation and multiple non-trivial files. Parent reviews implementation and independently verifies it. RDD is off by clone-local preference; do not start native review or change that switch. Test-first evidence: first command observed collection/import RED because the scaffold did not yet exist; after tests and dependencies were in place, the initial settings implementation produced behavioral RED (5 failures / 1 pass) because its environment alias did not match the documented variable; correcting the alias produced GREEN, recorded below. BK-008 forecast: approximately 200–350 authored lines; P1 forecast remains 900–1,600. Delivery strategy remains ask-on-risk; chain choice is pending and no commit may occur before that decision. Work currently remains uncommitted and must not be marked Done until parent review and work-unit evidence are complete.

Memory reconciliation: the on-disk plan includes user-approved BK-001–BK-007 and revised contingency scope absent from the older Engram snapshot. Preserve the on-disk approvals; mirror the current file, never restore the older snapshot. BK-061 remains Not started pending evidence reconciliation, not a blocker for BK-008.

## BK-008 execution evidence and closure — 2026-10-19

Done: b080aee (`feat(backend): se agregó la base de FastAPI con configuración y pruebas`), nine API files/266 additions. Versions on CPython 3.14.5 and official sources are documented in api/README.md. RED: missing `app.settings` import, then behavioral settings 5 failed/1 passed from env alias mismatch; corrected focused suite 6 passed. Independent review found notebook-root venv README path and ambient env/import issue; corrected and added lifespan test. Root/API-local plus ambient config: 10 passed; pip check clean. No live Uvicorn. Scoped whitespace clean; unrelated frontend whitespace untouched. RDD disabled/unmanaged, independent verification used; rollback boundary api scaffold only.

## BK-009 authorization, evidence and closure — 2026-10-19

User authorized the PostgreSQL SQLAlchemy session boundary, explicit Alembic baseline and synthetic tests on `codex/backend-foundation`; no domain tables, auth, real data, remote DB, deployment, push or merge. RDD off. Test-first. SQLite was insufficient alone, so local Docker proof was required. Route delegated direct; parent reviewed/committed.

RED: database tests initially failed import; settings 5 failed/6 passed for missing URL validation/redaction/SQLite-only test boundary; an intermediate DSN validation leaked input. GREEN after explicit redacted URL validation: focused DB/migration 6 passed; root/API-local 22 passed; pip check clean. Tests cover fresh/repeated baseline, test-only predecessor data preservation, offline PostgreSQL SQL, lazy engine and rollback/close on success/error. No FastAPI dependency wiring or startup DB/migrations.

Live PostgreSQL: one local named-pipe attempt, cached `postgres:18-alpine`, `--pull=never`, synthetic credentials, tmpfs/no mounts, ephemeral loopback port 54657. Container `e7a0e218f14f4f37d906da6cf7775ce026076fed4f28a8be02aee8525a6551ed`, image sha256 `77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873`, PostgreSQL 18.6/psycopg. Fresh and repeated Alembic head resulted only in `alembic_version=0001_baseline`; a temporary test predecessor row survived baseline upgrade. Session success/error paths rolled back uncommitted inserts. Exact-container cleanup `docker --host npipe:////./pipe/docker_engine rm --force --volumes <id>` exit 0. No existing resources inspected. Independent and parent suites: 22 passed; ambient debug/production-debug variants 22 each; pip clean. No live Uvicorn. Unrelated whitespace findings retained untouched.

Commit fa84fcd — `feat(persistencia): se agregaron sesiones y migraciones de PostgreSQL`; 15 API files, 413 additions/10 deletions, 423 authored changed lines; cumulative BK-008/009 689. API/index clean after commit; unrelated changes retained; no push/merge. BK-009 Done; subsequent BK-010 adds staff auth foundation. Historical superseded pending/failed attempts are not current outcomes.
## BK-010 execution authorization — 2026-10-19

User chose lockout after 5 consecutive PIN failures for 5 minutes and Admin alert on activation. Authorized PIN hash/verification, persisted attempts/lock, one transactional pending alert and synthetic PostgreSQL proof only. No guessed password/reset/Admin recovery, public login, kiosk/device authorization, outbound notification channel, real credential, or service. Alert remains pending, not delivered. D-025 unresolved. RDD off; Spanish local work-unit commit authorized by parent after review; no remote actions.

## BK-010 execution evidence — 2026-10-19

Partial PIN-only foundation: bcrypt5 on CPython3.14.5, 5-failure/300s lock, pending Admin event, no public login/reset/password/device authority. Initial import RED was missing modules, not behavior. Review found a pre-lock clock race (120s wait shortened lock); trusted clock moved after locks+bcrypt and regressions passed. Live proof and final counts are recorded in the closure below; exact disposable container was cleaned. Rollback excludes prior migrations and unrelated work.
## BK-010 PIN work-unit closure — 2026-10-19

Commit db73310 — `feat(auth): se agregó bloqueo de PIN por 5 minutos y aviso pendiente al admin` — `codex/backend-foundation`, 13 API files, 590 authored changed lines; cumulative backend 1,289 lines. Parent accepted the clock-after-locks+bcrypt correction after reproducing the shortened lock and queued-correct-PIN defect; regressions RED then GREEN. Final root/API-local suites 29 passed/1 opt-in skip, pip clean; isolated PostgreSQL concurrency/held-row regression 1 passed in 5.47s and disposable container cleaned. Parent spot check 29 passed/1 skipped; no push/merge/PR. BK-010 remains Partial: password/reset/Admin login/provisioning/public auth and alert delivery absent; alert remains durable pending, not sent. RDD off; no receipt claimed.

## Progress summary reconciliation — 2026-10-19

Historical snapshot before BK-011 authorization; its counts, pause and untracked-plan status are superseded by the BK-011 closure and current summary above.
## BK-011 correction authorization and evidence — 2026-10-19

Internal branch/session foundation only; no production TTL/public route/device proof. Independent review found stale credential issuance, cached authority, and nullable duplicate organization Admin grants; scoped fixes and prior RED/GREEN/final live PostgreSQL proof are detailed in the closure below. Earlier fixture failures/stall are retained there. BK010/BK011 remain Partial; rollback excludes migrations 0001/0002 and unrelated data.
## BK-011 internal work-unit closure — 2026-10-19

Commit497ef70 — feat(auth): se agregaron permisos por sucursal y sesiones revocables — on codex/backend-foundation.11API files816add+8delete=824changed lines; coherent implementation/migration/security regression/docs unit retained, no size-only code compression. Cumulative backend2113changed lines across4commits. API/index clean; main unchanged b7aac21e9cec929564d6d4f3310e25e4894d2813,no push/merge/PR. Planning documents remain local/untracked.

Independent live PostgreSQL reproduced3issues: stale PIN success mint after credential rotation/lock, stale cached authority despite row locks, nullable duplicate orgAdmin grants. One scoped correction rechecks current locked PIN/hash/lock, refreshes authority via populate_existing, and adds unique partial orggrant index. Regression RED3fail then GREEN. Final independent full live44passed29.14s; default root/API41passed3skips,pipclean. Parent41passed3skips22.39s,pipclean; strengthened PG cached-object regression holds strongrefs and passed1test2.75s. Exact disposable containers removedfinally exit0. Earlier interrupted PG run was consistent with fixture-held locks, resolved with explicit rollback/bounded timeouts. Normalized two extra EOFblanklines before commit; parent final focused12passed9.21s and staged whitespaceclean. RDDoff,independent verification not native receipt. BK010/BK011 remain Partial: no public authentication/provisioning/device authority/production TTL,recovery/reset or delivered Admin notification. Session operation scope must derive from returned principal,not client branch labels. Historical pending review/PG text is superseded here.

## BK-012 authorization and local evidence — 2026-10-19

User authorized Luna implementation plus parent review and requires updated plan in every commit, starting with exact nine plan documents here. RDD off; only local API/CI configuration, no hosted execution/private data/deployment/push/merge. Delegated route justified by multi-file preparation. Source tests first observed five import errors (missing modules), not behavioral RED. Independent review later reproduced blocking readiness, lost error correlation/raw server exceptions, unsupported audit mutation permissions, lost405Allow and uncapped helper metrics; behavioral regressions8failed8passed before one correction batch. Earlier54passed4skipped and live proof are superseded by final corrected proof below. Worker PG attempts exposed fixture-before-flush and external script syntax errors; neither claimed success. No unrelated files changed. Audit retention/access/full wiring/tamper resistance remain future operational decisions. Master header/table/counts reflect current Partial, not production readiness. Local workflow definition validates the same explicit synthetic target/test convention; no remote CI run authorized.
## BK-012 reviewed work-unit evidence — 2026-10-19

Implementation commit identity: the commit adding this evidence with subject feat(api): se agregaron observabilidad, salud y CI con el plan actualizado; previous boundary497ef70,branchcodex/backend-foundation. Parent stages API/workflow+exact9planningfiles only; no main,push,merge,hostedCI or unrelatedprivate/frontendfiles. Currentcommit hash is recorded in session memory after commit,not written back to dirty the just-committed plan.

Independent corrections verified: readiness offloop/deadline and boundedworkers (12saturatedrequests kept1active,recoveryworks,liveness2.4ms);unexpected500sameUUIDbody/header/log/nooriginalexceptionpropagation;startedstreamone-response/cancellationsafe;Allowpreserved/CRLFsafe;3unsupportedmutationauditactionsdeny;1000metricinputs128series,totalcountpreserved. OriginalbehavioralRED8fail8pass,then defaultroot63pass4skip25.83s/API63pass4skip25.24s,pipclean. Localworkflowequivalent63pass4skip24.10s plus optins audit1pass2.08s,auth2pass4.31s,credentials1pass5.30s after ownsyntheticDBreset. ActualPG0003->0004preservedoldstate,auditcommit/rollback/currentgrantdenial,readiness200. Exactcontainercleanupfinallyexit0. Parentfocused20pass2.38s,pipclean. YAML+inlinePythonstaticvalid;hostedCI NOTexecuted. Nineplanlinksresolve,privacyboundedcheckpassed. BK012 remains Partial for hosted/operationalauditproof;BK010/011pendingproductionauth/device/TTL/Adminnotificationunchanged. Earlierreview/PGpendinglogs superseded by this observedproof. ReadinesslimitsHTTPwait/capacity,not forcibleterminationofblockeddrivers;retention/access,tamperresistanceandfulldomainauditwiringarefuturepolicies.
