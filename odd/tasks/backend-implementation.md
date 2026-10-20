# EvoGym FastAPI Backend — Implementation Plan

**Status: P4 in progress — BK-008/BK-009, BK-013, BK-015–BK-018 Done; BK-010/BK-011/BK-012 and BK-021/BK-032 Partial.** Starting with BK-012, the master ledger and eight linked backend-plan documents are versioned with implementation; every future backend commit must include the updated master plan. Earlier source commits did not include the then-local planning documents. Private notebook workspaces remain separate. BK-012 adds only safe observability, health, audit, metrics and an early CI definition; hosted CI is not executed.

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

Ledger totals: **18 Done, 6 Partial, 1 In progress, 51 Not started (76 total)**. Original P0 decision tasks BK-001–BK-007 and BK-061 are Done; BK-061 closes the ratified Contingency Mode decision/documentation task only, not offline implementation. BK-008/BK-009 and BK-013/BK-015–BK-018 are Done; BK-010/BK-011/BK-012/BK-021/BK-022 remain Partial. Dependencies use BK IDs. Detailed execution cards and acceptance criteria are in [phase cards](../../docs/backend-plan/04-implementation-phases.md#phase-cards). Local-first protocol and unresolved policy are specified in [08-local-first-and-sync](../../docs/backend-plan/08-local-first-and-sync.md).

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
| BK-013 | P2 Add member read DTO/query and API contract | Done | BK-011,BK-012 | Read-only member slice; OpenAPI and DTO mapping |
| BK-014 | P2 Integrate frontend member list behind local-first API adapter | Not started | BK-013,BK-062,BK-063,BK-065,BK-067,BK-071,BK-072 | Scoped cached reads work offline; one local command/read boundary; no mixed demo/live member source |
| BK-015 | P2 Establish API contract and migration smoke suite | Done | BK-009,BK-013 | OpenAPI 3.x schema, core endpoint map, DTO whitelists/secret protection, and fresh DB migration verified in api/tests/test_contract_smoke.py |
| BK-016 | P3 Persist members, notes and eligibility records | Done | BK-013,BK-015 | Member notes & eligibility models, migration 0008, optional preferred_name/birth_date, member_number uniqueness, soft-deletion/voiding, active/revocation query & API logic, and D-012 Admin-only notes access control verified in api/tests/test_members.py |
| BK-017 | P3 Build services, plan versions and eligibility catalog | Done | BK-016 | Published terms immutable; services, plans, plan versions & mappings persisted with code uniqueness, RBAC, and migration 0009 verified in api/tests/test_catalog.py |
| BK-018 | P3 Implement member create/update/search flows | Done | BK-016 | Member creation/update DTOs with bounds & validation; duplicate member_number 409 conflict; shared natural identifiers (name/phone/email); preferred_name search in queries and API; row-locked updates via with_for_update(); D-012 receptionist notes redaction verified in api/tests/test_members.py |
| BK-019 | P3 Integrate member profile and catalog UI incrementally | Not started | BK-017,BK-018 | Per-slice source of truth and DTO translation documented |
| BK-020 | P4 Persist registers, terminals and shift opening | Done | BK-011,BK-015 | Cash registers, payment terminals & shifts persisted with migration 0010; one-open-shift partial unique index & row locking; opening cash/counts, actor, timestamps; RBAC and concurrency verified in api/tests/test_shifts.py |
| BK-021 | P4 Implement opening denomination and inventory audit capture | Partial | BK-020 | Cash-opening denomination evidence is implemented. Owner also authorized global review of the entire presented inventory, physical exception-only counts, and no automatic adjustments. BK-021-S1a (immutable snapshot domain/persistence) and S1b (authenticated HTTP/API presentation) are implemented. Owner has now explicitly approved missing-baseline acceptance and no-change opening; BK-021-S2 atomic review/open-shift integration is implemented in the current uncommitted candidate. BK-021 remains Partial because supported coverage is piece-only and broader inventory/close rules remain incomplete. D-015 adjustment/valuation policies do not gate this read-only evidence. |
| BK-022 | P4 Define shift posting lock and overtime transition | Partial | BK-020 | CASH-02 adds immutable denomination-based close evidence and membership cash overtime posting/linking. Independent PostgreSQL race proof, other sale kinds/general reporting, and discrepancy attribution remain incomplete. |
| BK-023 | P5 Persist orders and immutable item snapshots | Not started | BK-017,BK-022 | Totals and line/source constraints; no catalog rewrite |
| BK-024 | P5 Implement payments, allocations and idempotency | Not started | BK-004,BK-023 | Duplicate/retry/payload mismatch safe; 02/05 |
| BK-025 | P5 Implement transfer verification and settlement | Not started | BK-004,BK-024 | Pending is not settled; actor/evidence retained |
| BK-026 | P5 Implement credit entries and debt gates | Not started | BK-016,BK-024 | Limit default 0; debt blocks new credit/check-in |
| BK-027 | P5 Implement membership activation, entitlements and renewal | Not started | BK-003,BK-023,BK-024 | Activation explicit and date/overlap invariants tested |
| BK-028 | P5 Integrate checkout and membership frontend adapter | Not started | BK-025..BK-027 | Payment state distinct from entitlement state |
| BK-029 | P6 Implement member check-in against entitlements/debt | Not started | BK-026,BK-027 | Unauthorized, blocked and repeat-visit cases covered |
| BK-030 | P6 Implement trial visit lifecycle | Not started | BK-029 | D-019 trial policy resolved; trial cannot accidentally create a membership |
| BK-031 | P6 Integrate attendance/trial API flows | Not started | BK-029,BK-030 | Staff workflow resilient to retry and errors |
| BK-032 | P7 Implement product catalog and stock movement ledger | Partial | BK-011 (starter); BK-021,BK-022 (full ledger) | Piece-only product catalog and explicit immutable branch initializations are implemented; movement ledger and non-piece units remain out of scope. |
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
| BK-058 | P1 Implement Admin login, recovery and session administration | In progress | BK-010,BK-011 | Owner chose password login, email recovery and no MFA; scoped HTTP/login/recovery/own-session unit; no real provisioning/mail or permanent expiry assumed |
| BK-059 | P1 Implement Admin employee enrollment-code issue/list/revoke | Done | BK-011,BK-058 | One-time, expiring, rate-limited code lifecycle and staff enrollment audit; raw code shown only at issue; verified in api/tests/test_enrollment.py |
| BK-060 | P1 Implement Admin-managed device enrollment/list/revoke | Done | BK-011,BK-058,BK-059 | 6-digit pairing code expiry, 3-attempt lockout, 1-device binding, admin list/revoke and audit; verified in api/tests/test_devices.py |

| BK-061 | P0 Define Contingency Mode capability matrix, store-and-forward boundaries and hotspot handling | Done | BK-001,BK-002,BK-006 | Decision/documentation only: ratified D-026/D-027 and 08 define offline-allowed append-only events vs online-only operations, independent-device/hotspot behavior, immutable Arqueo Físico handoff, physical-cash acceptance, and async discrepancy audit. No offline client or sync backend implementation is claimed. |
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

- Progress: 18 of 76 tasks Done, 5 Partial (BK-010/BK-011/BK-012/BK-021/BK-032), 1 In progress (BK-058), and 52 Not started. BK-061 is Done as a ratified decision/documentation task only; its implementation remains future work.
- BK-012 local proof: prior suite 54 passed/4 skipped; correction RED exposed readiness, uncaught-500, metric-cap and unsupported-audit failures. Latest root/API-local suites each 63 passed/4 skipped; pip check/YAML passed. One fresh local PG attempt was cleaned but its probe script had Python syntax error before PG was exercised; prior independent PostgreSQL evidence applies only to the original implementation. Hosted CI not run.
- Deferred: BK-021 still needs owner acceptance for missing-baseline/empty-catalog cases and atomic review/shift integration; the owner-approved global full review, no-changes, exception-only physical-count, and no-automatic-adjustment workflow remains in force. BK-022 needs the overtime financial destination after cashcut and a real posting path before close/post serialization can be proved. Full BK-032 movement ledger and fractional units remain separate work; Admin recovery email domain, hosted/deployment verification, and other BK-010/BK-011/BK-012 production gaps remain deferred. No defaults or scaffolding are inferred.

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

## BK-021 opening denomination counts and inventory snapshot authorization — 2026-10-20

The user authorized Luna to implement mandatory bill/coin counts when opening every new shift. Scope is limited to cash-denomination evidence: count entries are submitted with opening, validated and persisted atomically with the shift, must reconcile to server-computed opening cash, and remain retrievable. Zero cash is valid only with an explicit nonempty list of zero-quantity denominations. Historical shifts retain honestly absent evidence; no backfill or inferred denominations. The illustrative frontend denomination catalog is not an approved whitelist. No count may mutate stock. The owner later explicitly authorized a full presented-inventory review workflow: global Next/no-changes acceptance, count only physical exceptions, no mandatory recount for unchanged items, and no automatic adjustments. This supersedes the older cash-only authorization wording below; it does not settle missing-baseline or empty-catalog acceptance.

Inventory acknowledgement/adjustment and shift integration remain out of scope; unresolved missing-baseline and empty-catalog acceptance are not decided here. D-015 valuation, adjustment posting and negative-stock rules do not gate immutable read-only observations. D-014 remains unresolved for other shift policies (including overtime and close behavior), and BK-022 is out of scope. No frontend/offline work, closing flow, stock changes, remote/real-data access, credentials, deploy, or dependency install is authorized. Parent owns commits/review. Preserve unrelated frontend and untracked files. RDD is off by clone-local preference and must remain off.

Route: delegated direct, triggered by multi-file implementation and reading that prepares a write; the prior cash-only BK-021 unit remains separate. BK-021-S1 now implements only immutable register-scoped snapshot capture/read; no shift-open integration or review acknowledgment. Initial forecast 250–380 authored changed lines (advisory); actual is recorded below. RED observed the new POST route returning 404 before implementation; GREEN covers complete catalog, empty/missing/zero states, historical immutability, transaction rollback, and live actor/branch authorization. Delivery strategy remains ask-on-risk; parent owns commit decision. BK-021 remains Partial pending missing/empty acceptance policy and later acknowledgment/atomic shift integration. The old cash-only narrative above is superseded by the owner's later full-review authorization.

### Immutable opening-inventory snapshot prerequisite (BK-021-S1)

Outcome: Implemented as a bounded prerequisite; BK-021 remains Partial. Routes are `POST /api/v1/registers/{register_id}/inventory-snapshots` and `GET /api/v1/registers/{register_id}/inventory-snapshots/{snapshot_id}`. A single full ordered product/branch-initialization SELECT produces the copied item set; snapshots retain labels, unit, explicit missing-versus-zero state, initialization provenance, server actor/time, and descriptive empty/missing/all-initialized source state. Reads recheck live register branch authorization; no stock change, acceptance, shift link, update/delete route, or auto adjustment exists. The new migration is `0013_inventory_snapshots` -> `0012_inventory_foundation`; its downgrade removes only its two new tables/index.

Evidence: the new route test first observed 404 before implementation. After implementation, `api/tests/test_inventory.py` passed 8 tests, and `api/tests/test_migrations.py api/tests/test_contract_smoke.py` passed 13 tests; full `api/tests` passed 153 tests with 7 skipped (local opt-in PostgreSQL URL explicitly empty). `pip check` found no broken requirements; `git diff --check` passed with only line-ending conversion warnings. SQLite migration proof covers a populated 0012 inventory baseline and shift denomination row through head upgrade and downgrade; this subtask has no live PostgreSQL proof. Authored changes total approximately 631 lines including the new 77-line migration; no commit or staging was performed and parent owns delivery strategy. The full local task document is 92,667 bytes, above the mirror limit; its full Engram mirror remains pending, not truncated.

### S1a/S1b review slice refinement — 2026-10-20

The earlier full-candidate proof above is historical; independent verification found a direct-database NULL-check defect and stale optional PostgreSQL head expectations. Current status: **S1a domain/persistence in progress**; **S1b HTTP/API second slice prepared, not included in the first slice**. S1a retains the snapshot models, registration, capture/read domain queries, migration, populated-migration/direct-query regressions, DB/table/head contract assertions, and domain-facing docs. S1b contains the register HTTP handlers, snapshot DTOs, route acceptance tests/OpenAPI entries, and README endpoint contract. Owner asked to keep tests and docs with their behavior; a 631-line combined candidate is split once into coherent dependent units rather than compressed.

Regression RED: add a direct database test showing `initialized=true` with `expected_quantity=NULL` must fail; SQL CHECK expressions accept UNKNOWN, so checking only `expected_quantity >= 0` is insufficient. Fix both ORM and migration check constraints with explicit `IS NOT NULL`, while retaining valid false/null and true/zero states. The three opt-in PostgreSQL migration checks also need current head `0013_inventory_snapshots`; predecessor assertions remain explicit.

The exact S1b candidate bytes are preserved at `tmp/bk-snapshot-slices-luna-20261020-033548/manifest.json` with per-file SHA-256s. Do not overwrite S1a work from whole-file backups; restore S1b after S1a integration by applying the listed snapshot API/DTO/test/README changes and preserving S1a's migration-head/table assertions. Full Engram task mirror remains pending because the local master is over 50 KB; do not truncate it.

### Cash-opening evidence

RED observed on the new schema regression: the denomination-count request was rejected because the existing DTO required a client total and did not accept counts. A second targeted RED asserted the new Alembic head identifier fit 32 characters and observed the current 38-character value fail; shortening its value produced GREEN. The migration filename remains `0011_shift_opening_denomination_counts.py`, while its revision value is `0011_shift_opening_counts`. The earlier independent verifier observed 140 passed/4 skipped and all 19 negative probes rejected. The cash unit is implemented but the overall BK-021 row remains Partial because inventory audit capture is blocked by D-015.

- `$env:EVOGYM_TEST_POSTGRES_URL=''; .\api\.venv\Scripts\python.exe -m pytest -q api/tests/test_shifts.py api/tests/test_migrations.py api/tests/test_contract_smoke.py` — 28 passed, 1 warning in 13.91 seconds after the correction.
- `$env:EVOGYM_TEST_POSTGRES_URL=''; .\api\.venv\Scripts\python.exe -m pytest -q api/tests` — 141 passed, 4 skipped, 1 warning in 114.46 seconds after the correction; only local opt-in PostgreSQL tests were skipped, no live PostgreSQL concurrency claim.
- `api\.venv\Scripts\python.exe -m pytest -q api/tests/test_migrations.py -k new_head_migration` — RED: 1 failed with observed length 38; GREEN after revision correction: 1 passed, 4 deselected.
- `api\.venv\Scripts\python.exe -m pip check` — no broken requirements found.
- `git diff --check -- api odd/tasks/backend-implementation.md docs/backend-plan` — passed; Git emitted only LF-to-CRLF informational warnings.

Independent correction readback: 28 passed in 17.19 seconds; no candidate-caused blockers remain. Parent spot check: migration suite 5 passed in 6.39 seconds. Work-unit subject: `feat(shifts): require opening denomination counts`; commit identity is recorded in Engram after commit. Native assessment was unassessable/high because of unrelated untracked files; independent verification supplied ordinary evidence, with RDD disabled/unmanaged. The cash-opening subtask is implemented, while inventory audit remains blocked by D-015. The new Alembic revision now fits PostgreSQL's `alembic_version.version_num` width; the pre-existing 0010 identifier remains over-width and is deliberately unchanged, so no PostgreSQL migration compatibility is claimed. Only the scoped API and planning paths belong to this work unit; unrelated frontend changes are excluded. The full local plan currently exceeds its stated 49,000-byte mirror limit; Engram has a status note, not a full mirror, and the full mirror is pending rather than truncated. No live PostgreSQL proof or remote delivery action is claimed.

## Key Learnings

1. The database map is a proposal, so schema approval remains a separate owner decision.
2. Payment settlement and membership activation are separate state transitions.
3. The backend workspace contains notebook data, not a FastAPI service target.

## P1 execution authorization — 2026-10-19

The latest user instruction supersedes the historical documentation-only authorization for local P1 implementation. Begin with BK-008 only: isolated api/ service scaffold, validated environment settings, local tests, and startup documentation. Preserve all existing notebook/data and frontend changes. No data import, external services, credentials, deployment, payments, push, or PR creation is authorized. Dependency installation is local to a new api/.venv; public package/documentation retrieval only, with no credentials.

Route: delegated direct (Luna), triggered by preparation and multiple non-trivial files. Parent reviews implementation and independently verifies it. RDD is off by clone-local preference; do not start native review or change that switch. Test-first evidence: first command observed collection/import RED because the scaffold did not yet exist; after tests and dependencies were in place, the initial settings implementation produced behavioral RED (5 failures / 1 pass) because its environment alias did not match the documented variable; correcting the alias produced GREEN, recorded below. BK-008 forecast: approximately 200–350 authored lines; P1 forecast remains 900–1,600. Delivery strategy remains ask-on-risk; chain choice is pending and no commit may occur before that decision. Work currently remains uncommitted and must not be marked Done until parent review and work-unit evidence are complete.

Memory reconciliation at this 2026-10-19 note: the on-disk plan includes user-approved BK-001–BK-007 and revised contingency scope absent from the older Engram snapshot. Preserve the on-disk approvals; mirror the current file, never restore the older snapshot. BK-061 was then pending evidence reconciliation, not a blocker for BK-008; its current Done status is recorded in the authoritative ledger above.

## BK-008 execution evidence and closure — 2026-10-19

Done: b080aee (`feat(backend): se agregó la base de FastAPI con configuración y pruebas`), nine API files/266 additions. Versions on CPython 3.14.5 and official sources are documented in api/README.md. RED: missing `app.settings` import, then behavioral settings 5 failed/1 passed from env alias mismatch; corrected focused suite 6 passed. Independent review found notebook-root venv README path and ambient env/import issue; corrected and added lifespan test. Root/API-local plus ambient config: 10 passed; pip check clean. No live Uvicorn. Scoped whitespace clean; unrelated frontend whitespace untouched. RDD disabled/unmanaged, independent verification used; rollback boundary api scaffold only.

## BK-009 authorization, evidence and closure — 2026-10-19

User authorized the PostgreSQL SQLAlchemy session boundary, explicit Alembic baseline and synthetic tests on `codex/backend-foundation`; no domain tables, auth, real data, remote DB, deployment, push or merge. RDD off. Test-first. SQLite was insufficient alone, so local Docker proof was required. Route delegated direct; parent reviewed/committed.

RED: database tests initially failed import; settings 5 failed/6 passed for missing URL validation/redaction/SQLite-only test boundary; an intermediate DSN validation leaked input. GREEN after explicit redacted URL validation: focused DB/migration 6 passed; root/API-local 22 passed; pip check clean. Tests cover fresh/repeated baseline, test-only predecessor data preservation, offline PostgreSQL SQL, lazy engine and rollback/close on success/error. No FastAPI dependency wiring or startup DB/migrations.

Live PostgreSQL: one local named-pipe attempt, cached `postgres:18-alpine`, `--pull=never`, synthetic credentials, tmpfs/no mounts, ephemeral loopback port 54657. Container `e7a0e218f14f4f37d906da6cf7775ce026076fed4f28a8be02aee8525a6551ed`, image sha256 `77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873`, PostgreSQL 18.6/psycopg. Fresh and repeated Alembic head resulted only in `alembic_version=0001_baseline`; a temporary test predecessor row survived baseline upgrade. Session success/error paths rolled back uncommitted inserts. Exact-container cleanup `docker --host npipe:////./pipe/docker_engine rm --force --volumes <id>` exit 0. No existing resources inspected. Independent and parent suites: 22 passed; ambient debug/production-debug variants 22 each; pip clean. No live Uvicorn. Unrelated whitespace findings retained untouched.

Commit fa84fcd — `feat(persistencia): se agregaron sesiones y migraciones de PostgreSQL`; 15 API files, 413 additions/10 deletions, 423 authored changed lines; cumulative BK-008/009 689. API/index clean after commit; unrelated changes retained; no push/merge. BK-009 Done; subsequent BK-010 adds staff auth foundation. Historical superseded pending/failed attempts are not current outcomes.
## BK-010 authorization, evidence and partial closure — 2026-10-19

Owner approved five failed PINs -> five-minute lock and Admin alert, plus receptionist access only Admin-assigned branches. db73310 on codex/backend-foundation committed13API files580add10delete=590lines; no main/push/merge. bcrypt5 onPython3.14.5,salted/no>72byte truncation/malformed denial; typed staff/credential/pending security-event schema0002; owned attempt+alert transaction, no public PIN route/provision/reset/password/roles/deviceproof or actual notice delivery. Initial importRED then independentPG found pre-lock clock shortened lock by120s and denied correct PIN after expiry. One correction clock sampled after locks+bcrypt;2regressions RED->GREEN. Root/API29pass1optinskip,pipclean;livePG1pass5.47s,ten concurrent failures->onealert,heldrow120s wait then300s lock,actual eventINSERTfailure rollback. Parent29pass1skip14.84s,pipclean;scopedwhitespaceclean. Exactsyntheticcontainerscleanedfinally. RDDoff/independentproof,not receipt. Cumulative original backend1289changedlines after BK010; newer exact commits supersede. Partial for broader auth/Admin delivery; no automatic idle/cashclose logout is now owner policy (later clarification). Rollback only BK010 paths,not priorbaseline or unrelated files.
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

## Admin access unit authorization — 2026-10-19

User resolved email recovery for Admin and explicitly declined MFA; implement next bounded Admin password/login/recovery/own-session slice with Luna+independentreview. Owner also prohibits receptionist logout from inactivity or cashshiftclose: outgoing reception continues overtime sales after earlycashcut; session,cashshift,staffattendance separate. Preserve frozen cashcut and actorprovenance; final overtimeaccounting stillD014. No defaultAdmin/signup,realaccount/emailprovider/actualmail/networkauthorization implied. Syntheticseededfixtures only; unconfiguredsender must failuniformly/not claimdelivery or leakrawrecoverytokens. Explicitvalidatedserverconfiguration required for Adminsession/recoveryexpiry,no inventedpermanenttoken/productionTTL. Source+tests+updatedmaster and relevantplans ineachcommit oncodex/backend-foundation,Spanishsummary,no main/push/merge, RDDoff. Route delegateddirect(multifile/preparation),RED/GREEN+realisolatedPGproof;forecast700–1000authoredlines advisory,no codegolf. BK058InProgress;BK010/011/012Partial untiltheirfullacceptanceobserved. Fixonlyactual8supportdocpaths,not hallucinated overview/master filenames. Keepmaster<49000UTF8bytes usingconcisehistory,neverdrop taskrows/ownerdecisions/proof.


## BK-059 and BK-060 execution evidence and closure — 2026-10-20

User authorized implementation of BK-059 (Employee Enrollment Codes) and BK-060 (Admin-managed Device Enrollment / 6-digit Device Pairing).

BK-059:
- Table `staff_enrollment_codes` with UUID PK, unique SHA-256 code hash, normalized login, role check (`admin`, `receptionist`), branch check (`(role != 'receptionist') OR (branch_id IS NOT NULL)`), created_by FK, and expiry check.
- `issue_enrollment_code`: generates random secret token (`secrets.token_urlsafe(32)`), stores SHA-256 hash, invalidates prior pending code for same login, logs `enrollment_code_issued` in `admin_auth_events`, returns raw code once.
- `list_enrollment_codes`: lists safe metadata with status (`pending`, `used`, `revoked`, `expired`); raw codes and hashes never returned.
- `revoke_enrollment_code`: sets `revoked_at` idempotently, logs `enrollment_code_revoked`.
- REST endpoints under `/api/v1/admin/enrollment-codes` requiring Admin Bearer.
- 6 tests in `api/tests/test_enrollment.py` all passed.

BK-060:
- Tables `staff_device_pairing_codes` (UUID PK, staff FK, SHA-256 hash of 6-digit code, 900s TTL, failed_attempts check `0 <= attempts <= 3`) and `staff_paired_devices` (UUID PK, staff FK, hardware UUID hash, device name, partial unique index `uq_staff_active_paired_device` where `revoked_at IS NULL`).
- `issue_device_pairing_code`: generates 6-digit numeric string, stores SHA-256 hash, revokes prior pending codes, logs `device_pairing_code_issued`, returns code to Admin.
- `pair_device`: validates login and 6-digit code, locks out after 3 failed attempts, commits failed attempts on denial, enforces 1 active device per staff by automatically revoking previous active device, binds device, marks code used, logs `device_paired`.
- `list_paired_devices` and `revoke_paired_device`: Admin inspection and revocation, logs `device_revoked`.
- REST endpoints `/api/v1/admin/staff/{staff_id}/device-pairing`, `/api/v1/admin/devices`, `/api/v1/admin/devices/{device_id}/revoke`, and public rate-limited `/api/v1/auth/devices/pair`.
- 8 tests in `api/tests/test_devices.py` all passed.

Migration `0006_enrollment_and_devices.py` updates `admin_auth_events` check constraint to include all 5 new audit actions and creates all 3 tables with proper constraints and indexes.
Total test suite: 89 passed, 4 skipped in 37.87s (100% green).

## BK-013 execution evidence and closure — 2026-10-20

User authorized implementation of BK-013 (Member read DTO, query, and API contract).

BK-013:
- Database model `api/app/db/models/members.py`: table `members` with UUID PK (`id`), unique text index `ix_members_member_number` on `member_number` (String(32)), indexes on `full_name`, `phone`, and `status`, check constraint `ck_members_status` (`status IN ('active', 'inactive', 'expired', 'suspended', 'pending')`), `joined_on` Date (default `CURRENT_DATE`), `credit_balance_minor` BigInteger (default 0 centavos MXN), `notes` Text, `email`, `birth_date`, `emergency_contact_name`, `emergency_contact_phone`, `photo_url`, `created_at`, `updated_at`. Exported in `api/app/db/models/__init__.py`.
- Migration `api/migrations/versions/0007_members.py`: revises `0006_enrollment_and_devices`, creates `members` table with all indexes and constraints, reversible downgrade. `api/tests/test_migrations.py` updated and verified.
- DTOs `api/app/members/schemas.py`: `MemberListItemDTO`, `MemberDetailDTO`, and `MemberListResponseDTO` with Pydantic v2 validation.
- Queries `api/app/members/queries.py`: `list_members` with case-insensitive search (`full_name`, `phone`, `member_number`), `status` filtering, sorting by `full_name`, `joined_on`, and `member_number` (`asc`/`desc`), pagination with `total` and `pages` calculation; and `get_member_by_id`.
- API endpoints `api/app/api/members.py`: `GET /api/v1/members` and `GET /api/v1/members/{member_id}`.
- Auth principal dependency: supports Admin Bearer (`validate_admin_session`) and Staff Bearer with `Permission.MEMBER_OPERATIONAL_READ` (`validate_session`); enforces D-012 privacy restriction (Receptionist visibility receives `notes: null`, Admin visibility receives populated `notes`).
- Router wired into `create_app` in `api/app/main.py`.
- 8 new tests in `api/tests/test_members.py` all passed.
- Total test suite: 97 passed, 4 skipped in 45.54s (100% green).

## BK-015 execution evidence and closure — 2026-10-20

User authorized implementation of BK-015 (Establish API contract and migration smoke suite).

BK-015:
- Test suite in `api/tests/test_contract_smoke.py`:
  - `test_openapi_schema_generation_and_standards`: asserts `app.openapi()` generates a valid dictionary conforming to OpenAPI 3.x specifications (`openapi`, `info` with title "EvoGym API" and version, `paths`, `components.schemas`).
  - `test_core_endpoints_registered_in_contract_and_app_router`: asserts all 13 core API endpoint paths and their respective HTTP methods are registered in OpenAPI paths (`/api/v1/auth/sessions` [POST], `/api/v1/auth/recovery/start` [POST], `/api/v1/auth/recovery/complete` [POST], `/api/v1/admin/sessions` [GET], `/api/v1/admin/sessions/{session_id}/revoke` [POST], `/api/v1/admin/enrollment-codes` [POST, GET], `/api/v1/admin/enrollment-codes/{code_id}/revoke` [POST], `/api/v1/admin/staff/{staff_id}/device-pairing` [POST], `/api/v1/admin/devices` [GET], `/api/v1/admin/devices/{device_id}/revoke` [POST], `/api/v1/auth/devices/pair` [POST], `/api/v1/members` [GET], `/api/v1/members/{member_id}` [GET]), verifies operational health endpoints (`/health/live` [GET], `/health/ready` [GET]) are registered on the app router, and performs HTTP smoke tests (200 for live, 503 fail-closed for unconfigured ready, 401 for unauthenticated member access).
  - `test_dto_field_whitelists_and_secret_protection`: asserts strict field whitelist on `MemberListItemDTO` (`id`, `member_number`, `full_name`, `phone`, `status`, `joined_on`, `credit_balance_minor`, `emergency_contact_name`, `emergency_contact_phone`, `photo_url`) and `MemberDetailDTO` (adds `email`, `birth_date`, `notes`); asserts that internal database fields (`password_hash`, `secret_hash`, `token_digest`, `code_hash`, `device_identifier_hash`) NEVER leak into any OpenAPI schema.
  - `test_fresh_db_migration_smoke_and_seed`: creates an ephemeral test database (`tmp_path`), applies Alembic migrations from baseline to head (`0007_members`), asserts all 14 expected operational tables exist (`branches`, `staff_users`, `staff_credentials`, `staff_role_grants`, `staff_sessions`, `security_events`, `admin_password_credentials`, `admin_recovery_tokens`, `admin_auth_events`, `audit_events`, `staff_enrollment_codes`, `staff_device_pairing_codes`, `staff_paired_devices`, `members`), confirms `organizations` table is omitted per D-001 single-organization architecture, verifies table columns and Alembic version, seeds minimal operational sample data across branches, staff users, credentials, role grants, and members, and executes smoke read queries (counts, filters, and joins).
- Verification: 4 new smoke tests passed; full test suite: 101 passed, 4 skipped in 48.98s (100% green).

## BK-016 execution evidence and closure — 2026-10-20

User authorized implementation of BK-016 (Persist members, notes and eligibility records).

BK-016:
- Database models in `api/app/db/models/members.py`:
  - `Member`: added optional `preferred_name: Mapped[str | None] = mapped_column(String(160), nullable=True)`.
  - `MemberNote`: restricted audit note table (`member_notes`) with UUID PK `id`, `member_id` (FK to `members.id`, cascade delete), `author_id` (FK to `staff_users.id`, restrict), `body` Text, `created_at` TIMESTAMPTZ, `voided_at` TIMESTAMPTZ, `voided_by` (FK to `staff_users.id`, restrict), index on `member_id`, and `is_voided` property.
  - `MemberEligibilityRecord`: attestation table (`member_eligibility_records`) with UUID PK `id`, `member_id` (FK to `members.id`, cascade delete), `eligibility_type` String(64), `verified_by` (FK to `staff_users.id`, restrict), `verified_at` TIMESTAMPTZ, `valid_until` Date, `notes` Text, `created_at` TIMESTAMPTZ, `revoked_at` TIMESTAMPTZ, `revoked_by` (FK to `staff_users.id`, restrict), indexes on `member_id` and `eligibility_type`, and `is_valid` property.
  - Re-exported `MemberNote` and `MemberEligibilityRecord` in `api/app/db/models/__init__.py`.
- Migration `api/migrations/versions/0008_member_notes_and_eligibility.py`:
  - Revises `0007_members`.
  - Adds `preferred_name` column to `members`.
  - Creates `member_notes` and `member_eligibility_records` tables with all FKs, defaults, and indexes.
  - Fully reversible `downgrade()`.
- DTO schemas in `api/app/members/schemas.py`:
  - Updated `MemberListItemDTO` and `MemberDetailDTO` to include `preferred_name: str | None = None`.
  - Created `MemberNoteDTO` and `CreateMemberNoteDTO` (body 1..5000 chars).
  - Created `MemberEligibilityDTO` and `CreateMemberEligibilityDTO` (eligibility_type 1..64 chars).
- Query operations in `api/app/members/queries.py`:
  - Notes: `add_member_note`, `list_member_notes` (excluding voided by default, including voided when requested), `void_member_note`.
  - Eligibility: `add_member_eligibility`, `list_member_eligibility` (active filtering based on `revoked_at IS NULL` and `valid_until >= CURRENT_DATE`), `revoke_member_eligibility`.
- API endpoints in `api/app/api/members.py`:
  - `GET /api/v1/members/{member_id}/notes`: Admin only (403 for Receptionist), returns note list with optional `include_voided`.
  - `POST /api/v1/members/{member_id}/notes`: Admin only (403 for Receptionist), creates note (201 Created).
  - `POST /api/v1/members/{member_id}/notes/{note_id}/void`: Admin only (403 for Receptionist), voids note and records voided_by/voided_at.
  - `GET /api/v1/members/{member_id}/eligibility`: accessible by Admin and Staff with `Permission.MEMBER_OPERATIONAL_READ`, returns eligibility records with `only_active` filter.
  - `POST /api/v1/members/{member_id}/eligibility`: Admin only (403 for Receptionist), creates eligibility attestation (201 Created).
  - `POST /api/v1/members/{member_id}/eligibility/{record_id}/revoke`: Admin only (403 for Receptionist), revokes eligibility record.
- Contract smoke and migration suites updated:
  - `api/tests/test_contract_smoke.py`: recognized all 6 new member notes & eligibility routes, updated whitelist on `MemberListItemDTO` to include `preferred_name`, updated expected table count to 16 operational tables (`member_notes` and `member_eligibility_records`), asserted Alembic head revision `0008_member_notes_and_eligibility`.
  - `api/tests/test_migrations.py`: verified migration head `0008_member_notes_and_eligibility`, PostgreSQL offline SQL emission, and non-destructive upgrade behavior.
- Test suite in `api/tests/test_members.py`:
  - Added 6 new unit and integration tests verifying optionality of `preferred_name` and `birth_date`, `member_number` uniqueness integrity constraint, notes CRUD/soft-deletion, notes RBAC (Receptionist 403 vs Admin 200/201), eligibility CRUD/revocation/expiry filtering, and eligibility RBAC (Receptionist read vs Admin create/revoke).
- Verification: 107 passed, 4 skipped in 64.90s (100% green).

## BK-017 execution evidence and closure — 2026-10-20

User authorized implementation of BK-017 (Build services, plan versions and eligibility catalog).

BK-017:
- Database models in `api/app/db/models/catalog.py`:
  - `Service`: Commercial service table (`services`) with UUID PK `id`, unique indexed `code` String(32), `name` String(160), `status` String(24) CheckConstraint active/inactive, `created_at` TIMESTAMPTZ, `updated_at` TIMESTAMPTZ.
  - `Plan`: Commercial plan table (`plans`) with UUID PK `id`, unique indexed `code` String(48), `name` String(160), `kind` String(24) CheckConstraint membership/visit, `status` String(24) CheckConstraint active/inactive/archived, `created_at` TIMESTAMPTZ, `updated_at` TIMESTAMPTZ, and `versions` relationship ordered by `version_number`. Property `current_version` resolves the latest version.
  - `PlanVersion`: Immutable published plan version table (`plan_versions`) with UUID PK `id`, `plan_id` (FK to `plans.id`, restrict), `version_number` Integer (> 0), `name` String(160), `price_minor` BigInteger (>= 0), `currency` String(3) default MXN, `reference_amount_minor` BigInteger, `duration_value` Integer (> 0), `duration_unit` String(16) CheckConstraint day/month/year, `eligibility_type` String(64), `restriction_notes` Text, `is_active` Boolean default True, `published_at` TIMESTAMPTZ, UniqueConstraint on `(plan_id, version_number)`.
  - Immutability enforcement: attached SQLAlchemy `@event.listens_for(PlanVersion, "before_update")` raising `ValueError("Published plan versions are immutable")`.
  - `PlanVersionService`: Composite mapping table (`plan_version_services`) with composite PK `(plan_version_id, service_id)`, FK to `plan_versions.id` (cascade), FK to `services.id` (restrict), and optional `session_limit` Integer (> 0).
  - Re-exported `Service`, `Plan`, `PlanVersion`, and `PlanVersionService` in `api/app/db/models/__init__.py`.
- Migration `api/migrations/versions/0009_catalog_services_and_plans.py`:
  - Revises `0008_member_notes_and_eligibility`.
  - Creates `services`, `plans`, `plan_versions`, and `plan_version_services` tables with all columns, check constraints, foreign keys, unique constraints, and indexes.
  - Fully reversible `downgrade()`.
- DTO schemas in `api/app/catalog/schemas.py`:
  - `ServiceDTO` and `CreateServiceDTO`.
  - `PlanServiceLinkDTO` and `PlanVersionServiceCreateDTO`.
  - `PlanVersionDTO` and `PublishPlanVersionDTO`.
  - `PlanDTO` and `CreatePlanDTO`.
- Query operations in `api/app/catalog/queries.py`:
  - Services: `create_service`, `list_services`, `get_service_by_id`, `get_service_by_code`.
  - Plans & Versions: `create_plan` (with optional initial version), `publish_plan_version` (calculating incremental `version_number` and validating linked services), `get_plan_by_id`, `get_plan_by_code`, `list_plans` (with kind, status, and eligibility_type filters).
  - Model-to-DTO conversion helpers: `to_service_dto`, `to_plan_dto`, `to_plan_version_dto`, `to_plan_service_link_dto`.
- API endpoints in `api/app/api/catalog.py` (mounted at `/api/v1/catalog` in `api/app/main.py`):
  - `GET /api/v1/catalog/services`: accessible by Staff or Admin (200), returns service list with optional status filter.
  - `POST /api/v1/catalog/services`: Admin only (403 for Receptionist), creates commercial service (201 Created), returns 409 on duplicate code.
  - `GET /api/v1/catalog/plans`: accessible by Staff or Admin (200), returns plan list with optional kind, status, and eligibility_type filters.
  - `POST /api/v1/catalog/plans`: Admin only (403 for Receptionist), creates plan with optional initial version (201 Created), returns 409 on duplicate code.
  - `GET /api/v1/catalog/plans/{plan_id}`: accessible by Staff or Admin (200), returns plan details and version history.
  - `POST /api/v1/catalog/plans/{plan_id}/versions`: Admin only (403 for Receptionist), publishes incremental version (201 Created), validates referenced services.
- Contract smoke and migration suites updated:
  - `api/tests/test_contract_smoke.py`: registered the 4 new catalog endpoints (GET/POST services, GET/POST plans, GET plans/{id}, POST plans/{id}/versions), updated expected table count to 20 operational tables (`services`, `plans`, `plan_versions`, `plan_version_services`), asserted Alembic head revision `0009_catalog_services_and_plans`.
  - `api/tests/test_migrations.py`: verified migration head `0009_catalog_services_and_plans`, 20 operational tables, PostgreSQL offline SQL emission, and non-destructive upgrade behavior.
- Test suite in `api/tests/test_catalog.py`:
  - 6 comprehensive tests verifying service creation and duplicate code rejection, plan creation with/without initial versions, incremental version publishing, plan version immutability via SQLAlchemy event listener, plan listing and filtering by kind/status/eligibility, and catalog RBAC (Receptionist 200 GET / 403 POST vs Admin 200/201).
- Verification: 113 passed, 4 skipped in 82.31s (100% green).

## BK-018 execution evidence and closure — 2026-10-20

User authorized implementation of BK-018 (Implement member create/update/search flows).

BK-018:
- DTO schemas in `api/app/members/schemas.py`:
  - `CreateMemberDTO`: `member_number` (1..32 chars), `full_name` (1..160 chars), `preferred_name` (<= 160 chars), `phone` (1..32 chars), `email` (<= 320 chars), `birth_date` (date), `emergency_contact_name` (<= 160 chars), `emergency_contact_phone` (<= 32 chars), `photo_url` (<= 512 chars), `joined_on` (date), `initial_notes` (<= 5000 chars, persisted only if actor is Admin).
  - `UpdateMemberDTO`: optional demographic/operational updates with length bounds and status regex constraint `^(active|inactive|expired|suspended|pending)$`.
- Query operations in `api/app/members/queries.py`:
  - `list_members`: extended search filter to match `preferred_name.ilike(term)` alongside `full_name`, `phone`, and `member_number`.
  - Added custom exception `DuplicateMemberNumberError`.
  - `create_member`: checks if `member_number` exists (raises `DuplicateMemberNumberError`), populates trimmed strings and default `joined_on=date.today()`, attaches `MemberNote` and sets `member.notes` if `initial_notes` provided and actor `is_admin` is True, catches unique constraint `IntegrityError` and raises `DuplicateMemberNumberError`.
  - `update_member`: uses row locking `select(Member).where(...).with_for_update()`, updates non-None attributes, and returns updated `Member` or None.
- API endpoints in `api/app/api/members.py`:
  - `POST /api/v1/members`: 201 Created, accessible by authenticated staff (Admin or Receptionist), creates member via `create_member`, catches `DuplicateMemberNumberError` and raises HTTP 409 Conflict, returns serialized `MemberDetailDTO` adhering to D-012 (`notes: null` for receptionists, notes populated for admin).
  - `PATCH /api/v1/members/{member_id}`: 200 OK, accessible by authenticated staff, updates member under row lock via `update_member`, returns HTTP 404 if not found, returns serialized `MemberDetailDTO` adhering to D-012.
- Contract smoke suite updated:
  - `api/tests/test_contract_smoke.py`: updated `EXPECTED_CORE_API_ENDPOINTS` to include `POST` on `/api/v1/members` and `PATCH` on `/api/v1/members/{member_id}`.
- Test suite in `api/tests/test_members.py`:
  - Added 7 comprehensive tests:
    - Member creation with full data and admin notes (201 Created, D-012 notes visibility, and `MemberNote` persistence).
    - Member creation with minimal data by receptionist (201 Created, defaults applied, initial_notes ignored, notes redacted).
    - Duplicate member number rejection (409 Conflict).
    - Shared natural identifiers (duplicate full_name, phone, and email across different member numbers successfully created without collision).
    - Search by `preferred_name` across query layer and API endpoint.
    - Member update via `PATCH /api/v1/members/{id}` (updating name, phone, status, 404 on nonexistent ID, 422 on invalid status regex, D-012 notes redaction for receptionists vs admin visibility).
    - Query-level unit tests for `create_member` and `update_member` under session row locks.
- Verification: 120 passed, 4 skipped in 94.88s (100% green).

## BK-020 execution evidence and closure — 2026-10-20

User authorized implementation of BK-020 (Persist registers, terminals and shift opening).

BK-020:
- Database models in `api/app/db/models/shifts.py`:
  - `PaymentTerminal`: Table `payment_terminals` with UUID PK `id`, `branch_id` (FK to `branches.id`, restrict), `code` String(32), `name` String(160), `provider` String(32) default 'mercado_pago', `device_id` String(64), `mp_store_id` String(64), `mp_pos_id` String(64), `status` String(24) CheckConstraint active/inactive/maintenance, TIMESTAMPTZ timestamps, UniqueConstraint on `(branch_id, code)`.
  - `CashRegister`: Table `cash_registers` with UUID PK `id`, `branch_id` (FK to `branches.id`, restrict), `code` String(32), `name` String(160), `default_terminal_id` (FK to `payment_terminals.id`, set null), `status` String(24) CheckConstraint active/inactive, TIMESTAMPTZ timestamps, UniqueConstraint on `(branch_id, code)`, relationships `default_terminal` and `shifts`.
  - `Shift`: Table `shifts` with UUID PK `id`, `cash_register_id` (FK to `cash_registers.id`, restrict), `opened_by` (FK to `staff_users.id`, restrict), `closed_by` (FK to `staff_users.id`, restrict), `opened_at` TIMESTAMPTZ, `closed_at` TIMESTAMPTZ, `status` String(24) CheckConstraint open/closing/closed, `opening_cash_minor` BigInteger CheckConstraint >= 0, `expected_cash_at_close_minor`, `counted_cash_minor`, `difference_minor`, `closing_notes` Text, TIMESTAMPTZ timestamps, relationship `cash_register`.
  - Partial Unique Index `uq_shifts_active_per_register` on `cash_register_id` where `status IN ('open', 'closing')` (PostgreSQL and SQLite).
  - Re-exported `PaymentTerminal`, `CashRegister`, and `Shift` in `api/app/db/models/__init__.py`.
- Migration `api/migrations/versions/0010_registers_terminals_and_shifts.py`:
  - Revises `0009_catalog_services_and_plans`.
  - Creates `payment_terminals`, `cash_registers`, and `shifts` tables with constraints, foreign keys, and the partial unique index `uq_shifts_active_per_register`.
  - Fully reversible `downgrade()`.
- DTO schemas in `api/app/shifts/schemas.py`:
  - `PaymentTerminalDTO` and `CreatePaymentTerminalDTO`.
  - `CashRegisterDTO` (with `has_open_shift: bool`) and `CreateCashRegisterDTO`.
  - `ShiftDTO` and `OpenShiftDTO` (`opening_cash_minor: int = Field(ge=0)`).
- Query operations in `api/app/shifts/queries.py`:
  - Custom exceptions `ShiftAlreadyOpenError` and `CashRegisterNotFoundError`.
  - `create_payment_terminal`, `list_payment_terminals` (filtered by branch).
  - `create_cash_register`, `list_cash_registers` (filtered by branch), `get_cash_register`, `get_active_register_ids`.
  - `get_open_shift`, `get_shift_by_id`.
  - `open_shift`: row lock on `cash_registers` via `with_for_update()`, check active shift status, insert `Shift`, trap `IntegrityError` from concurrency race on partial unique index `uq_shifts_active_per_register` and re-raise `ShiftAlreadyOpenError`.
  - DTO mapping helpers: `to_payment_terminal_dto`, `to_cash_register_dto`, `to_shift_dto`.
- API endpoints in `api/app/api/shifts.py` (mounted at `/api/v1` in `api/app/main.py`):
  - `GET /api/v1/terminals`: accessible by Staff (filtered to branch) or Admin.
  - `POST /api/v1/terminals`: Admin only (403 for Receptionist), creates terminal (201 Created), returns 409 on duplicate code.
  - `GET /api/v1/registers`: accessible by Staff (filtered to branch) or Admin, returns registers with `has_open_shift` indicator.
  - `POST /api/v1/registers`: Admin only (403 for Receptionist), creates cash register (201 Created), returns 409 on duplicate code.
  - `GET /api/v1/shifts/current`: accessible by Staff/Admin for their branch, returns active shift (200) or 404 if no open shift or register not found.
  - `POST /api/v1/shifts/open`: accessible by Staff/Admin (201 Created), validates register branch, opens shift under lock, returns 409 Conflict if active shift already open, returns 422 if opening cash is negative.
  - `GET /api/v1/shifts/{shift_id}`: accessible by Staff/Admin for their branch, returns shift details (200) or 404 if not found.
- Contract smoke and migration suites updated:
  - `api/tests/test_contract_smoke.py`: registered the 5 new core endpoints (`/api/v1/terminals`, `/api/v1/registers`, `/api/v1/shifts/current`, `/api/v1/shifts/open`, `/api/v1/shifts/{shift_id}`), updated expected table count to 23 operational tables, asserted Alembic head revision `0010_registers_terminals_and_shifts`.
  - `api/tests/test_migrations.py`: asserted revision `0010_registers_terminals_and_shifts`, 23 operational tables, PostgreSQL offline SQL generation of new tables and partial unique index `uq_shifts_active_per_register`, and non-destructive predecessor upgrades.
- Test suite in `api/tests/test_shifts.py`:
  - 6 comprehensive tests verifying payment terminal creation & branch code uniqueness, cash register creation & default terminal linkage, shift opening lifecycle & actor/timestamp retention, single active shift invariant & direct DB partial index enforcement, negative cash rejection, multi-threaded concurrency race condition simulation (yielding exactly 1 open shift and 1 `ShiftAlreadyOpenError`), and complete API RBAC matrix (Receptionist branch isolation, 403 on register/terminal creation, 409 on duplicate open, 422 on negative cash).
- Verification: 126 passed, 4 skipped in 99.86s (100% green).








## BK-032 piece-only product/existence starter authorization — 2026-10-20

Authorization: user approved backend products and explicit branch stock initializations, but not fake/demo product loading. Scope is limited to piece-counted products with mandatory nonnegative signed-64-bit initial quantities, immutable per-branch initializations, Admin-only paginated APIs, server-owned actor/time provenance, and additive migration 0012_inventory_foundation down-revision 0011_shift_opening_counts. Product catalog is shared across branches; initializations are branch-isolated. Missing initialization is represented as initialized=false, quantity=null, distinct from explicit zero. No movement ledger, fractional/conversion units, sales, adjustment, deactivation, valuation, stock review/snapshot acceptance, or frontend/demo integration is authorized. Existing D-009 does not establish conversion ratios; fractional support remains unresolved. Migration history identifier 0010_registers_terminals_and_shifts remains a pre-existing 35-character gap and is not changed, so PostgreSQL migration compatibility is not claimed.

Route: delegated direct (bounded Luna writer; multi-file behavior and preparation). Forecast: 500–700 authored changed lines; advisory only, no code-golf. RDD remains clone-local OFF; do not enable. Local regression must first observe absent product route then pass after implementation. Required commands: focused inventory; migration/contract; full API; pip check; scoped diff check. Local synthetic SQLite only; PostgreSQL opt-in explicitly disabled, and no live-PostgreSQL proof. Delivery strategy ask-on-risk; parent owns commit/chain decision.

Progress: 17 Done, 5 Partial (BK-010/BK-011/BK-012/BK-021/BK-032), 1 In progress (BK-058), 53 Not started. BK-021 remains Partial pending inventory audit decision D-015; BK-032 remains Partial pending movement ledger and unresolved inventory policies. Full Engram mirror is pending because current master exceeds the mirror's safe size; preserve this complete local ledger rather than truncating it.


Verification: RED observed: synthetic Admin product-creation request returned 404 before the router existed. GREEN: api/tests/test_inventory.py 3 passed; api/tests/test_migrations.py api/tests/test_contract_smoke.py 10 passed; complete api/tests 146 passed, 4 skipped in 120.30s, with one Starlette/httpx deprecation warning. PostgreSQL opt-in was set empty; SQLite synthetic tests only, no live-PostgreSQL concurrency proof. pip check reported no broken requirements. Trailing documentation whitespace was normalized before final checks; scoped diff check is clean. Opening behavior distinguishes absent initialization from explicit zero; product creation does not create stock. Negative, boolean, fractional, string, and signed-64-bit overflow quantities are rejected; missing branch/product and duplicate initialization paths are covered. RDD remained clone-local OFF; no commit/staging performed. Full Engram mirror pending because local master exceeds 50KB; preserve full file.

Correction after independent verification: Shared product-code/name normalizers reject NUL, normalize whitespace, casefold product codes, and enforce final normalized lengths before persistence; both request DTOs and domain queries use them. Both paginated GET routes and domain query functions validate signed-64-bit offsets before SQL. Regression RED reproduced HTTP 500 for expanded `ß` code and overlarge pagination; NUL product code/name requests were accepted before correction. Correction GREEN: inventory tests 4 passed; migration and contract tests 10 passed; full API suite 146 passed, 4 skipped in 120.30s. `pip check` clean and final scoped `git diff --check` clean. Independent review originally counted 474 lines; after correction the independently measured total is 549 (488 new-file lines, 52 additions, 9 deletions), before this final documentation readback. Independent corrected checks: 14 focused tests passed in 14.56s; malformed-input probes returned 422 with no writes, and no candidate-caused blockers remained. Parent spot check: 4 inventory tests passed in 5.66s. The generated __pycache__ files are ignored by Git; no cleanup is needed. Owner selected one commit on the existing backend branch on 2026-10-20: delivery strategy exception-ok for this bounded inventory starter only, accepting the approximately 550-line coherent unit instead of a chain. Work-unit identity: the commit adding this evidence with subject feat(inventory): add piece-based catalog and branch initialization, parent 44d93a3; the resulting hash is recorded in Engram after commit. Only the 16 scoped implementation/test/documentation paths are staged; unrelated frontend changes are excluded. No remote push or PR creation is authorized by this local commit step.

## PostgreSQL Alembic version-width recovery — BK-015-PG1 — 2026-10-20

Authorization: user explicitly approved this bounded PostgreSQL migration compatibility fix and real disposable local PostgreSQL proof. Published revision IDs remain immutable; this work may widen version tracking but must not rename historical IDs, truncate IDs, alter domain migrations, or implement inventory/closing behavior. Preserve unrelated frontend changes; do not stage, commit, push, deploy, install packages, or access remote services or private data.

Route: delegated direct, one bounded writer; preparation and implementation are scoped to the migration chain/version-table contract, tests, README, and the listed plan documents. Forecast: approximately 200–350 authored changed lines, subject to the actual diff; advisory only. Acceptance: supported explicit version-table width covers every current revision in offline and online migration paths; safely evolves existing short-width tracking tables before version updates; upgrade, downgrade, repeated/no-op paths are compatible; SQLite remains green; disposable PostgreSQL demonstrates real migration-chain behavior and preserves predecessor/domain data. TDD runner: `api/.venv/Scripts/python.exe -m pytest -q api/tests/test_migrations.py`, followed by opt-in `api/tests/test_migrations_postgres.py` against a new isolated local synthetic database; validate chain-to-head before any `create_all()` tests. Required broader checks: full API tests, `pip check`, scoped `git diff --check`. No live DB means unavailable evidence, never a pass.

RDD remains clone-local OFF; do not enable or start native review. No commit or staging authorized; parent owns final verification and delivery decision. Recovery checklist: (1) migration/version-width fix and regression tests; (2) inventory review preparation is read-only and remains uncompleted here; (3) closing-count review preparation is read-only and remains uncompleted here. Master-ledger item totals and unrelated statuses are unchanged. Local master is the source of truth; full Engram mirror remains pending because it exceeds 50 KB, and observation 589 is stale and must not be restored or truncated.

Progress: BK-015-PG1 implementation, documentation, and bounded PostgreSQL proof completed; no staging or commit, and the parent owns final verification/delivery. Three-aspect recovery checklist: (1) PostgreSQL version-width fix/proof completed; (2) inventory review was read-only preparation only; (3) closing review was read-only preparation only. The two review maps were returned separately; no inventory or closing implementation, policy decision, or domain-task completion is attributed to this migration unit. Master-ledger totals and BK-021/BK-022 statuses are unchanged.

Verification evidence: RED from real PostgreSQL 18.6 fresh-chain upgrade at `0007_members -> 0008_member_notes_and_eligibility`, with `StringDataRightTruncation` against `VARCHAR(32)`; initial SQLite/offline regression checks also observed 2 failures and 4 passes because fresh `alembic_version` and offline SQL still used 32. GREEN after fix: `api/tests/test_migrations.py` 7 passed; the four existing opt-in PostgreSQL tests plus three migration PostgreSQL tests passed together (7 passed in 62.74s) against a fresh local loopback-only PostgreSQL 18.6 container/database. The opt-in run verified existing `VARCHAR(32)` widening, fresh/repeated head, inventory row survival on no-op head, populated 0011 shift/count upgrade, and scoped downgrade/re-upgrade preservation. Full API suite earlier reported 146 passed, 7 skipped, one existing Starlette/httpx deprecation warning in 356.05s, before the final unbounded-TEXT guard and explicit legacy SQLite-width regression were added; affected migration SQLite/offline and PostgreSQL suites were rerun afterward. `pip check` found no broken requirements; scoped `git diff --check` and new-file whitespace scan were clean. Four uniquely named local ephemeral containers were removed (zero owned containers remain); no persistent PG volume/process was created, and both PostgreSQL URL environment variables were cleared. Proof outputs are under `tmp/bk-postgres-proof-*`. Local master is the source of truth; full Engram mirror remains pending above 50 KB, and stale observation 589 was not restored or overwritten.

Authored change count: 286 lines total (60 tracked additions + 5 tracked deletions + 221 new source/test lines); generated PostgreSQL proof logs are excluded. No source commit was made.

Independent final evidence: 147 passed / 7 opt-in skips in the complete API suite (320.46s), plus 7 passed in one fresh PostgreSQL 18.6 run. Final source includes the TEXT guard and legacy SQLite regression. Parent spot check: 7 migration tests passed in 21.00s; pip and scoped whitespace checks are clean. Independent runtime did not separately cover TEXT/quoted identifiers/limited roles; no such proof is claimed. Disposable container and attached volume were removed and verified absent. Native assessment was unassessable/high due unrelated untracked files; independent Luna verification is the ordinary proof, RDD remains disabled/unmanaged.

Owner continuation authorization: proceed with every unblocked backend unit using Luna and local work-unit commits on codex/backend-foundation, preserving unrelated frontend. Parent may commit this verified migration unit; no remote push/PR is implied. Work-unit identity is the commit carrying this evidence with subject fix(db): widen Alembic revision tracking for PostgreSQL, parent e0370e8; final hash is recorded in Engram. Next ready slice: server-owned inventory snapshot capture/read only. Review acceptance for unknown/empty inventory and post-cut overtime accounting remain deferred business decisions, not invented defaults.

## BK-021-S1a immutable snapshot domain slice — 2026-10-20

Owner-authorized bounded prerequisite: capture/read only, no review acknowledgment, shift-open integration, inventory mutation, or claim that piece-only data represents all physical inventory. Domain snapshot source states (`empty_catalog`, `missing_initializations`, `all_initialized`) describe evidence only. Missing-baseline/empty-catalog acceptance remains open; global Next/no-changes, exception-only physical counts, and no automatic adjustment are owner-approved workflow policy. D-015 stock-changing policies remain unresolved but do not gate these read-only observations. S1b HTTP routes/DTO/endpoint docs remain backed up for a later delivery slice at `tmp/bk-snapshot-slices-luna-20261020-033548/manifest.json`; all backup hashes were verified. Do not restore the backup over S1a master/tracking edits.

S1a implementation evidence: the full catalog uses one ordered outer-join query and persists copied labels, expected quantity (including unknown as NULL), initialization provenance, actor/time, source state, item count and missing count. No catalog size cap or stock mutation is introduced. GET query eagerly loads snapshot items. Migration `0013_inventory_snapshots` follows `0012_inventory_foundation`, preserves predecessor data, and downgrades only its own tables. Direct DB regression now requires initialized rows to contain a non-NULL expected quantity; explicit zero remains valid and uninitialized rows remain NULL.

Test-first evidence: before the constraint fix, `api/tests/test_inventory_snapshots.py::test_snapshot_item_check_rejects_initialized_null_but_allows_explicit_zero` failed because SQLite CHECK accepted SQL UNKNOWN. The model and migration now explicitly require `expected_quantity IS NOT NULL` in the initialized branch; the test passes. Three stale current-head literals in opt-in `api/tests/test_migrations_postgres.py` now expect `0013_inventory_snapshots`; predecessor targets remain unchanged.

Verification with `EVOGYM_TEST_POSTGRES_URL=''`: snapshot domain + existing inventory tests 9 passed; migration + contract tests 13 passed; full `api/tests` 154 passed, 7 skipped in 107.95s. `pip check`: no broken requirements. Scoped `git diff --check -- api docs/backend-plan odd/tasks/backend-implementation.md`: clean (Git printed only line-ending normalization warnings). PostgreSQL opt-in was not run in this correction turn; independent parent verification remains required for the NULL constraint against PostgreSQL. One existing Starlette/httpx deprecation warning appeared. At the S1a-only boundary, HTTP routes were held in the verified backup manifest; S1b has since been restored into the current candidate without overwriting the corrected constraints, migration assertions, or master evidence. BK-021 remains Partial. No commit/staging performed; parent owns delivery. Full Engram mirror remains pending above the safe size; preserve the full local master.

## BK-021-S1 snapshot capture/read candidate — S1a + S1b — 2026-10-20

S1a domain/persistence and S1b HTTP/API presentation are now both implemented in the current candidate. S1b was restored only from hash-verified manifest entries for shifts routes, snapshot DTOs, HTTP tests, API docs, plus the two route assertions merged into the corrected contract file. The PG migration head assertions, corrected model/migration NULL constraint, domain tests, and this master were not overwritten. The backup manifest remains at `tmp/bk-snapshot-slices-luna-20261020-033548/manifest.json` as recovery evidence; no future restore should replace the master or corrected domain files.

HTTP behavior: POST captures and commits the full catalog snapshot for a register; GET reads it by register/snapshot IDs. Every operation revalidates the live Admin/receptionist principal and register branch; snapshot IDs are not grants. Product labels, piece unit, baseline quantity/unknown state, provenance and server actor/time are read from the captured snapshot. It does not acknowledge Next/no-changes, link to or alter shift opening, mutate stock, or claim uninitialized/empty inventory accepted. Owner-approved global review and exception-only counts remain policy; missing-baseline/empty acceptance and atomic review/shift integration remain open. Non-piece inventory remains unsupported.

Final test-first/verification evidence: direct initialized=true/NULL constraint regression was observed RED (SQLite accepted CHECK UNKNOWN), then GREEN after explicit `expected_quantity IS NOT NULL` in model and migration; zero remains valid. Focused snapshot-domain + HTTP/existing inventory tests: 13 passed. Migration + contract tests: 13 passed. Full `api/tests`: 158 passed, 7 skipped, 110.55s, one existing Starlette/httpx deprecation warning. `$env:EVOGYM_TEST_POSTGRES_URL=''`; no live PostgreSQL ran in this writer turn, so independent PostgreSQL verification is pending. `pip check`: no broken requirements. Final scoped `git diff --check -- api docs/backend-plan odd/tasks/backend-implementation.md`: clean; Git emitted only line-ending normalization warnings.

Current authored candidate size is approximately 858 changed lines (tracked additions 565, tracked deletions 23, plus 270 lines of new migration and direct-domain tests; generated backup excluded). This exceeds the review slice budget; it was not reduced through code-golf or test omissions. Parent must resolve the candidate-specific delivery/size exception before any commit; no staging or commit was made. BK-021 stays Partial pending later real policy decisions and atomic review/shift integration. Local master is authoritative; full Engram mirror remains pending over safe size; no truncation performed.

## BK-061 decision closure and current deferred queue — 2026-10-20

BK-061 is Done as a decision/documentation task only: ratified D-026/D-027 and `docs/backend-plan/08-local-first-and-sync.md` define allowed offline append-only operations, online-only exclusions, independent PC/phone operation, hotspot reconnection, immutable Arqueo Físico handoff, physical-cash acceptance, and asynchronous discrepancy auditing. This closes no client or backend sync implementation. The 2–3 second hotspot estimate in 08 is not verified; overtime-sale attribution after cashcut is now owner-decided under D-014 but backend posting/linking remains unimplemented and does not block this capability-matrix decision.

Current snapshot candidate: BK-021-S1a domain/persistence and S1b HTTP read/capture are implemented in an uncommitted 15-path, 858-line candidate, including an 88-line migration and 182-line domain test. Writer verification: 158 passed, 7 skipped; independent focused verification: 26 passed plus 3 PostgreSQL migration tests; parent snapshot/inventory check: 13 passed in 13.43s. The initialized-NULL CHECK regression now rejects with SQLSTATE 23514 while explicit zero and missing initialization remain valid. No stock mutation, acknowledgment, or shift-opening behavior was added. Real PostgreSQL containers/volumes were removed, and source bytes were unchanged after verification. Candidate exceeds 400 lines after one honest split (631-line core; full candidate restored); parent must resolve the candidate-specific size exception before delivery. Nothing was staged or committed; RDD is off and no remote push occurred.

Still deferred: BK-021 missing-baseline/empty-catalog acceptance and atomic review/shift integration; BK-022 overtime financial destination and real posting-path serialization; full BK-032 movement ledger/fractional units; Admin recovery email domain; hosted/deployment gates. Owner-approved BK-021 full review, no-changes, exception-only physical counts, and no automatic adjustment remain authoritative. The full Engram mirror remains pending above 50 KB; preserve the complete local ledger and do not restore stale observation 589.

## BK-021 snapshot work-unit delivery — 2026-10-20

Owner explicitly approved the complete approximately 814-line snapshot candidate as one commit after one honest slicing pass did not fit the review budget. Delivery strategy is exception-ok for this candidate only; no future size exception or remote push is implied. Work-unit identity: the commit carrying this entry with subject feat(inventory): capture immutable register inventory snapshots, parent 33b1717; final hash is recorded in Engram after commit. Parent pre-commit spot check repeated snapshot/domain plus inventory tests: 13 passed in 13.78s, one existing Starlette/httpx warning. The prior final full suite (158 passed / 7 opt-in skips) and independent PostgreSQL proof (3 passed plus constraint probes) remain the evidence for unchanged source. This closes capture/read delivery only: BK-021 remains Partial pending inventory-review acceptance/opening integration and unresolved source-state policy. Full Engram master mirror remains pending above its size limit.

## BK-021-S2 atomic inventory review and shift opening — implemented — 2026-10-20

Owner decision supersedes the earlier S1-only status: a shift may open when product initial quantities are missing. Opening with no entered changes records the receptionist's global acceptance/no-changes declaration, not a physical verification or blame judgment. An actually captured empty catalog is an explicit source state; database/snapshot unavailability is never treated as empty. Existing cash denomination counts remain mandatory. Optional item counts are physical observations only, and unknown expected quantities remain unknown. No stock initialization or adjustment occurs. Piece-only inventory remains the supported scope; fractional units and closing/posting rules remain out of scope.

BK-021-S2 delegated-direct implementation is complete and independently verified; delivery remains pending a candidate-specific size exception. POST /api/v1/shifts/open must atomically consume the exact server-owned, live-current register snapshot and create the shift, mandatory denomination evidence, review provenance, and optional observations in the caller-owned transaction. The review is one-to-one with the new shift and unique per consumed snapshot; actor/time are server-derived. Historical shifts remain without fabricated reviews. Live snapshot/source authorization is repeated for opening, and PostgreSQL source-table locks protect the full ordered catalog comparison through commit. Stale snapshots require refresh; no silent recapture. Estimate: 450–600 authored changed lines, advisory only; preserve readable tests and documentation rather than code-golf. Delivery strategy remains ask-on-risk; prior size exception was candidate-specific to the already delivered S1 snapshot unit.

Acceptance checks: meaningful RED for opening with an authorized snapshot and no observations lacking a persisted review; GREEN for no-change with missing baseline, explicit zero baseline, accepted captured empty catalog, optional physical observations, strict numeric/range/duplicate/item validation, stale/foreign/consumed snapshots, live RBAC, rollback atomicity, historic shifts with no review, populated 0013 migration, and real PostgreSQL competing-open/source-writer locking tests. Verification is local synthetic only; PostgreSQL opt-in is not run by this writer. Expected full suite cost is approximately 2–3 minutes; no external or ambient database access.

Verification: RED was observed before implementation when OpenShiftDTO discarded the supplied snapshot ID; the targeted test then passed after the required field and behavior were implemented. Focused inventory review/snapshot, shifts, migration, and contract tests: 49 passed, 3 skipped. Full api/tests: 170 passed, 10 skipped in 123.05s; opt-in PostgreSQL locking/migration checks skipped because EVOGYM_TEST_POSTGRES_URL was empty. pip check reports no broken requirements; scoped git diff --check is clean, with Git line-ending normalization warnings only. No live PostgreSQL concurrency claim is made.

Current status: BK-021-S2 is implemented and locally verified, but no commit/staging was made; parent owns delivery/review. After the bounded correction, candidate authored lines total 1,008 (382 tracked additions + 42 tracked deletions + 584 untracked additions, including migration and new tests); it remains over 400 after the single honest slicing pass, and no size exception was requested for this new candidate. The full local master remains authoritative; Engram mirror is pending because the document exceeds safe size. This S2 section supersedes earlier dated S1-only statements that described missing-baseline/empty acceptance and atomic integration as unresolved.
## BK-021-S2 bounded independent-correction evidence — 2026-10-20

Independent verification found that SQLAlchemy identity-map reuse could hide a committed product/baseline change in an opening session, and falsey non-list observation values were being treated like an omitted list. The shared full-catalog reader now projects fresh scalar database values for both snapshot capture and opening validation; only `None` means no observations. Added strong-reference cache regressions for both paths and falsey-value regressions; all six were observed failing before the fix and passing after it. The competing-open PostgreSQL test now captures the first shift UUID before closing its session, and an opt-in PostgreSQL cache-staleness test was added. PostgreSQL tests remain unrun here; do not claim live proof until independent execution.
Final correction verification: exact focused inventory-review/snapshot/shift tests 40 passed; migrations/contracts 15 passed; full `api/tests` 176 passed and 11 skipped in 135.56s. The six cache-freshness/falsey-list regressions passed after implementation. `pip check` found no broken requirements and final scoped `git diff --check` was clean apart from Git line-ending warnings; no PostgreSQL runtime is claimed.
Independent final S2 proof: 40 focused inventory-review/snapshot/shift tests and 15 migration/contract tests passed; a newly owned local PostgreSQL 18.6 target passed all 7 migration/shift opt-in tests. Actual PG reused-session probes confirmed fresh product and initialization values for capture and stale rejection during opening; no-change acceptance preserved NULL baselines without stock mutation. Snapshot single-consumption and catalog/baseline writer blocking through opening commit passed. The exact disposable container and attached volume were removed and verified absent, and the test URL cleared. Parent repeated the 40-test focused command: 40 passed in 19.94s. Source remains unchanged after this proof; full default suite remains 176 passed / 11 opt-in skips. Parent reconciled pre-bookkeeping candidate size: 1,009 authored lines across 17 paths, including 584 new-file lines. No further slicing or code trimming; size exception is the remaining delivery decision. No commit, push or PR has occurred for this S2 unit.

## BK-021-S2 delivery authorization — 2026-10-20

The owner explicitly approved this candidate-specific approximately 1,000-line single-commit exception. Delivery strategy for this unit is exception-ok; no test omissions, code-golf, or further artificial slicing. Work-unit identity: feat(shifts): record inventory acceptance during opening, parent 337489a. Verified source is unchanged; the exact 17-path unit includes its migration, tests and documentation. Rollback boundary is this opening-inventory acceptance unit, not prior immutable snapshot capture. RDD remains clone-local off (disabled/unmanaged); independent Luna verification and parent spot check are recorded above. No push or PR is authorized by this exception. Full Engram mirror remains pending; preserve the full authoritative local document.

## BK-022-D1 ratified overtime cash rules — complete — 2026-10-20

Bounded documentation-only reconciliation of explicit owner decisions; delegated-direct route for three existing documents, forecast under 150 authored changed lines, delivery strategy ask-on-risk. Acceptance: decision register and phase plan distinguish ratified rules from implementation; D-014 is partially resolved; no posting/linker implementation is claimed; task counts and prior evidence remain unchanged. Passive documentation checks only: structural readback confirms owner attribution/provenance, pending successor link, physical-count inclusion, no-double-count example, explicit implementation gaps, and no status inflation; runtime behavior and RED/GREEN are N/A because no executable code changed. Scoped `git diff --check` passed. Documentation work-unit identity: `docs(plan): ratify overtime cash handoff rules`, parent `1626846`; no commit or staging performed by this writer.

Owner decisions to record: post-cut overtime proceeds financially belong to the next shift whose drawer holds the money, while retaining the actual seller and prior/source shift overtime attribution; the frozen cut remains immutable. If the next shift is not yet open, the sale remains pending and links automatically at that next opening. Mandatory opening denomination counts physically include pending overtime cash. Therefore raw count is evidence; do not add those receipts again to expected drawer cash (for example, 1,000 counted including 200 pending overtime means expected cash is 1,000 with no subsequent drawer movements, not 1,200). Do not invent another authoritative amount or infer guilt from flags.

Still not implemented or settled by this documentation task: canonical sale/payment persistence and pending linker, posting-versus-close serialization, final expected-cash calculation/reporting, and any remaining discrepancy attribution behavior. D-014 remains Partial; BK-022 is Not started in the task ledger, since no source behavior has been implemented. Full Engram mirror is pending because the authoritative master exceeds its safe size; parent owns synchronization.

## Cash membership posting and overtime handoff — 2026-10-20

Owner authorization: continue unblocked backend implementation with Luna, local work-unit commits on codex/backend-foundation; no push, frontend changes, production data, external payment execution or ambient credentials. Published membership price is the final cash amount, without additional tax, fee or discount. Prior overtime decisions remain authoritative.

Scope: one published-plan membership per MXN cash sale, immutable server-priced order/payment provenance and atomic membership-period activation; then the same real posting path extended to immutable cash cuts, pending overtime and automatic successor linkage without double-counting physical opening cash. Excluded: products, credit, other payment methods, discounts, refunds, financial-history reads, frontend and offline sync. This coordinated route breaks the BK-022/BK-023 dependency cycle with a real posting path rather than a placeholder linker.

- [x] CASH-01 — Post a cash membership sale to an open authorized shift, with server-owned immutable price/item snapshot, persisted confirmed payment and atomic membership activation/renewal. Unique idempotency key must replay identical requests without duplicate money or periods, and reject conflicting reuse. Route: delegated-direct, multi-file source/migration/tests and research belong to one Luna writer. Checks: observed applicable RED/GREEN, price/authorization/range/rollback/idempotency/calendar tests, populated 0014-to-head migration, full API suite, independent verification. No financial-history endpoint. Forecast approximately 400–600 authored lines; preserve readable code/tests if larger.
- [x] CASH-02 — Extend that canonical path to close/post serialization, frozen cashcut and overtime seller/source attribution; pending sales automatically link once at next register opening. Required physical opening count includes pre-opening overtime cash, so those receipts are not a second drawer inflow. Route: delegated-direct, dependent on CASH-01 verified boundary. Checks: close/reopen scenario, idempotent linkage, race/open/close tests on PostgreSQL, no mutation of prior cut, no duplicate cash.
- [x] CASH-03 — Independent Luna verification of each work unit plus parent spot check; reconcile actual scope/status and record local commit identities. Route: delegated verification for financial/concurrency risk. Keep BK-022/023/024/027 Partial or Not started honestly until corresponding proof; do not mark entire tasks Done from this starter.

Delivery strategy: ask-on-risk; forecast whole feature 600–850 authored lines. Prior candidate size exceptions do not authorize this unit. Use the two coherent behavioral units above as the single honest slicing pass; report actual sizes and seek a candidate-specific exception before any oversized commit. No PR or push is authorized. RDD remains clone-local OFF; no native review START. Full master Engram mirror remains pending because it exceeds safe storage size; preserve the complete local document.

## CASH-01 membership cash posting — in progress — 2026-10-20

Bounded source unit authorized by owner: one published membership plan, existing member, MXN cash and a live branch-scoped principal with an open shift. Persist canonical order, item/price snapshot and confirmed cash payment, then atomically activate or renew membership using D-005 calendar-month clamp and [start,end) dates. Published price is final; client never supplies authoritative totals. Server owns actor, branch, seller and source shift. Branch operational dates use the ratified `branches.timezone` IANA field, default `America/Mexico_City`; this CASH-01 scope adds that model field and migration for existing branches, validates IANA values fail-closed, and tests a nondefault-zone date boundary. Membership period rows are branch-neutral date records only: they do not grant cross-branch entitlement or implement check-in access. A unique idempotency key binds authenticated actor/branch plus normalized request; identical replay returns original outcome and conflicting payload reuse conflicts. Serialize concurrent renewal against the member row and posting against register/shift. CASH-02 overtime/close behavior is explicitly excluded.

Delegated-direct multi-file route; estimated 400–600 authored lines, heuristic only, delivery ask-on-risk. Before implementation, observe RED for the authorized membership cash-posting route/behavior. Acceptance also covers strict positive/signed-64-bit price and accumulation bounds, stale/inactive plan and member/branch/shift scope, rollback atomicity, idempotency actor/payload binding, repeated sale safety, and populated `0014` migration preservation. No generic pending scaffolding, stock, credit, non-cash payment, discount, refund, UI/offline, financial-history read or real payment provider. Do not mark BK-023/024/027 complete. Full local master is authoritative; Engram mirror remains pending above safe size.

CASH-01 implementation evidence (2026-10-20): the first HTTP regression was observed RED as an unmatched-route 404 before the sales router existed; it now passes with 201 creation and 200 exact replay. Implemented branch IANA timezone storage/default (D-004, `America/Mexico_City`) and fail-closed validation; canonical order/item price snapshot, confirmed cash payment, and branch-neutral membership period; seller/branch/register/source-shift are server-derived; published amount is final; request cannot supply totals. The query leaves commit to its caller, locks register, open shift, member, plan, and branch, binds idempotency to actor/branch and normalized request, and computes local date plus calendar-clamped D-005 duration. Membership periods are date records only, not cross-branch entitlement/check-in grants. No CASH-02 close/overtime, financial history, provider request, products, credit, other tender, discount, refund, UI, or offline scaffolding was added.

Verification after final normalization: `api/tests/test_sales.py api/tests/test_sales_postgres.py api/tests/test_shifts.py api/tests/test_catalog.py`: 32 passed, 2 PostgreSQL opt-ins skipped. `api/tests/test_migrations.py api/tests/test_migrations_postgres.py api/tests/test_contract_smoke.py`: 17 passed, 3 PostgreSQL opt-ins skipped. Full `api/tests`: 185 passed, 13 skipped in 133.73s; `$env:EVOGYM_TEST_POSTGRES_URL=''`. `pip check`: no broken requirements. `git diff --check -- api docs/backend-plan odd/tasks/backend-implementation.md`: clean after final normalization. One pre-existing Starlette/httpx deprecation warning appeared. SQLite verified populated 0014 branch preservation/default, downgrade, and re-upgrade. No live PostgreSQL run occurred; concurrent retry/member-renewal PostgreSQL tests are present but skipped, so independent live-PG verification remains pending.

Current candidate size is 1,268 authored changed lines: 124 tracked additions + 11 deletions + 1,133 lines across 9 new files. This is larger than the 400–600 forecast; no test/code trimming or second slicing pass was attempted. The CASH-01/CASH-02 behavioral split remains the one honest split. Parent must resolve a candidate-specific size exception before commit; this writer did not stage or commit. CASH-01 remains unchecked pending independent verification, especially real PostgreSQL locking. Full Engram master mirror remains pending above safe size.

## CASH-01 PostgreSQL foreign-key ordering correction — 2026-10-20

Independent PostgreSQL verification found both same-key replay and concurrent-member-renewal tests failed because the membership period could flush before its referenced order item. Added a deterministic SQLite regression with `PRAGMA foreign_keys=ON`; it failed before the fix with a foreign-key violation. The sale query now flushes the order, then its dependent item/payment, then the membership period, all inside the caller-owned transaction with no intermediate commit. The FK-enabled regression now passes. Final default-suite and PostgreSQL rerun evidence is pending; the independent verifier must rerun the two real PostgreSQL cases. Earlier 0015 PostgreSQL migration verification remains separate and is not evidence that these sales flows pass.

## CASH-01 PostgreSQL test instance-lifetime correction — 2026-10-20

The independent PostgreSQL rerun confirmed the sale invariants work, but two assertions dereferenced ORM objects after their committing sessions closed and SQLAlchemy expired those instances. The opt-in tests now capture the order UUID and membership end date as primitives while the first session is live, then compare those saved values after concurrent work completes. The assertions are unchanged in meaning; the independent verifier still needs to rerun the opt-in suite. No sale source was changed.

Final owned-target verification: a fresh disposable PostgreSQL 18 container with a dedicated named volume and loopback-only random port passed `api/tests/test_migrations_postgres.py api/tests/test_sales_postgres.py`: 5 passed in 15.61s. Both concurrent test workers now also return only primitive replay/order-ID or renewal-start-date values captured before their sessions commit and close; no detached ORM result is inspected. The exact container and volume were removed and verified absent, and `EVOGYM_TEST_POSTGRES_URL` was cleared. No sale source was modified in this test-only correction.

## CASH-02 closed-shift overtime posting and immutable cash cut — in progress — 2026-10-20

Owner-authorized continuation of the existing CASH-02 contract: a receptionist may continue selling after a shift is cut/closed without changing that frozen source shift or attendance. The authenticated seller and closed source shift remain immutable attribution. Under the shared register-row lock, cash proceeds go to the next open shift, or remain pending until the next shift opens; opening automatically links pending orders exactly once. Mandatory physical opening counts already include pending cash, so those pre-opening receipts are marked included in opening cash and excluded from later inflow expectations. Example: 1,000 physically counted including pending 200 yields expected 1,000 with no later drawer movements, not 1,200.

Bounded slice: add authenticated `POST /api/v1/shifts/{shift_id}/close` with mandatory validated denomination counts, server-derived expected cash/count difference, actor/time, immutable close evidence and exact same-payload retry behavior. Extend the existing cash membership route only for server-validated `source_shift_id` after a closed source, requiring it to be the latest closed source relative to the current successor (or latest closed when no successor exists). Persist separate source (`orders.shift_id`) and financial shift attribution; migration backfills current CASH-01 orders to their source shift. Opening links pending cash within its existing transaction. No new pending framework or arbitrary client-selected financial destination. Route: delegated-direct multi-file source/migration/tests and docs, forecast 450–650 authored lines (advisory), ask-on-risk; parent owns staging/commit and any size exception.

CASH-02 implementation is present in the current candidate: close requires bounded denomination counts and freezes expected/count/difference/actor/time; same-count retry replays that cut and changed counts conflict. Closed-source overtime membership cash sale preserves seller and source shift, targets the current successor or stays pending, and opening atomically links pending orders once while excluding those receipts from later cash inflow. The shared register lock serializes posting/open/close and migration 0016 backfills existing CASH-01 orders to their source shift. Deterministic RED was observed for the missing close endpoint (404); focused GREEN: sales/shifts/inventory-review 53 passed; migrations/contracts 19 passed; full API 198 passed, 16 PostgreSQL opt-in skips; pip check and scoped whitespace check clean. The sales PostgreSQL test helper's undefined branch variable produced a test-worker `NameError`; it now receives the authorized branch explicitly at every callsite. Worker/session cleanup uses bounded database lock/statement timeouts and releases held transactions in `finally` without weakening wait assertions. Owned loopback PostgreSQL 18 verification of migration, sales, and shift opt-in suites passed 12 tests; the exact temporary container/volume were removed and the test URL cleared. Remaining limits: only membership cash sales; no universal sale/reporting surface or discrepancy attribution/escalation. D-014 remains Partial. The 20-path candidate is 1,013 authored changed lines including new migration 0016; this exceeds the advisory review budget and needs parent/owner size-exception resolution before commit. No source changes should follow final proof without rerunning checks.

CASH-01 final parent reconciliation: sale source is frozen and verified; delivery alone remains pending a candidate-specific size exception. Final default suite after the FK fix: 186 passed, 13 opt-in skips in 139.07s; focused sales/shifts/catalog 33 passed and migrations/contracts 17 passed (3 opt-in skips), pip check clean. Independent Luna PostgreSQL probes passed calendar clamping/renewals, rollback row-count preservation, mismatched retry rejection, branch denial, spoofed amount rejection and exact replay without repricing/duplicates after plan/version/shift state changes. The final test-only lifetime correction then passed all 5 migration/sales PostgreSQL tests on the owned local target as recorded above. Parent spot check: api/tests/test_sales.py, 8 passed in 16.15s. Final 19-path candidate counted 1,278 authored changed lines before this bookkeeping append. CASH-02 overtime/linking/close is not implemented; do not claim it delivered. Full authoritative master mirror remains pending above safe size. No staging, commit or push for CASH-01 yet.

CASH-01 delivery authorization: the owner explicitly approved this approximately 1,300-line candidate as one local work-unit commit. Candidate-specific strategy: exception-ok; prior exceptions were not reused. Work-unit identity: feat(sales): post cash membership purchases, parent d3be691. Verification and independent PostgreSQL invariants are recorded above; the source is unchanged since proof. Rollback boundary is this cash-membership sale, period persistence and branch timezone migration, not prior inventory acceptance. No push or PR is authorized. CASH-02 remains pending.

CASH-02 final parent reconciliation (2026-10-20): independent Luna rechecked the corrected helper and transaction cleanup, then the exact migration/sales/shifts PostgreSQL suites passed 12 tests in 30.16s against a fresh cached local PostgreSQL 18 target. The exact owned container and volume are absent and URL cleared. Prior independent focused local proof is 53 behavior tests plus 19 migration/contract tests; the source default full suite remains writer-reported 198 passed / 16 opt-in skips. The final ad-hoc lifecycle probe was not run; do not claim that separate proof. CASH-01 was already delivered as dd4059e, superseding its historical pending-delivery statements above. CASH-02 source is implemented and verified but uncommitted, pending its own approximately 1,000-line size exception. D-014/BK-022 remain Partial for broader reporting/discrepancy scope. No staging, commit, push or PR for CASH-02; full authoritative master mirror remains pending above safe size.

CASH-02 delivery authorization (2026-10-20): the owner explicitly approved this approximately 1,000-line candidate as one local work-unit commit. Candidate-specific strategy: exception-ok. Work-unit identity: feat(shifts): close cash shifts and carry overtime sales forward, parent dd4059e. Scope rollback is this closing/overtime/linkage unit plus migration 0016, preserving the earlier CASH-01 sale foundation. Verified source is unchanged; parent repeated the 53-test behavior suite successfully in 48.43s. CASH-02 and its independent verification are complete for the bounded membership-cash scope; broader D-014/BK-022 discrepancy and reporting scope remains Partial. No push or PR is authorized; full master mirror remains pending above safe size.
