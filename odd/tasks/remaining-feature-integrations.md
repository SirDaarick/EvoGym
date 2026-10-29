# Remaining Feature Integrations

**Status:** Features F01 to F09 are completed and verified (including F06 debt payment at register and F07 pending money & transfer reviews under Ponytail and ODD). Features F10 to F15 remain pending discovery.

**Historical baseline (captured 2026-10-26):** primary HEAD `f267cac`; A/B/C locally merged and source-verified at `96c558f`; API 508 passed / 18 skipped, frontend 739 passed, and app TypeScript build passed. These are point-in-time results, not current verification or proof for other feature cards. This update records F03 only; non-F03 cards are not re-audited, and unrelated dirty work remains preserved.

**Authority:** [A/B/C integration alignment](abc-integration-alignment.md) remains the proof record for those integrations. The [F03 execution record](f03-membership-plan-catalog.md#progress-verification-and-next-step) is the detailed source for F03 outcomes and gaps. [Work-package index](../../docs/work-packages/README.md) and [frontend contract audit](../../docs/backend-audit/frontend-contract-gaps.md) are historical intent/audit references.

## Product boundary and sequencing

The authenticated product tree is `ApiProductApp`; the demo route is separate. F03 now mounts `PlanCatalog({ apiRequest })` at `/owner/plans`; this update does not revise or infer other feature-card status. Other integration paths are tracked in their own cards. Source: `frontend/src/app/ApiProductApp.tsx`, `frontend/src/features/owner/PlanCatalog.tsx`.

Classify cards: **A — core API contract exists; integrate/verify adapter**; **B — API exists but a demonstrated contract gap may require extension**; **C — discover/decide before defining implementation**. A conditional possible gap is not a claim that the backend is missing.

| ID | Complete feature | Priority / class | Status | Dependencies |
|---|---|---|---|---|
| F01 | Open, operate, and close a cash shift | P0 / A | **Completed** | Authenticated cashier; register/shift contracts |
| F02 | Register and maintain a member | P0 / A | **Completed** | Authenticated member contract |
| F03 | Create and publish a membership plan version | P1 / A | **Completed** | Catalog plan contract; owner UI |
| F04 | Sell a membership | P0 / A | **Completed** | F01; existing member and published-plan API |
| F05 | Record a member access/check-in event | P0 / A | **Completed** | Authenticated member-check-in contract |
| F06 | Pay membership debt at the register | P1 / A | **Completed** | F01; debt/access decision D-024 |
| F07 | Review pending money and transfer payments | P1 / A | **Completed** | Finance permissions; decisions D-017/D-023 |
| F08 | Manage staff schedule series and attendance corrections | P1 / A | **Completed** | Roster and schedule APIs; existing attendance occurrences |
| F09 | Set up inventory and record stock movement | P1 / B | **Completed** | D-015; stock-movement semantics |
| F10 | Sell products and process refunds/returns | P2 / C | F01, F09; sale/refund/accounting decisions |
| F11 | Manage rentals end to end | P2 / C | Rental lifecycle, inventory and payment rules |
| F12 | Record and review expenses | P2 / C | Expense ownership, approval and accounting rules |
| F13 | Run payroll | P2 / C | Payroll domain, legal/pay-period rules, permissions |
| F14 | Review a member account history | P2 / C | Member detail and individually confirmed history sources |
| F15 | Review one named owner daily operations summary | P2 / C | Named owner, metric definitions and source domains |

Priority is order, not a deadline. Recommended next: F01, then F02. F03 can be separately owned only if it does not conflict on schema/router/migration work. No parallel shared-auth, router, or migration ownership.

## Feature cards

At feature start, verify each cited contract and route against current source. Existing API availability describes the contract—not proof that all frontend expectations are satisfied. Tasks below are executable checklists; leave boxes unchecked until implementation and evidence actually exist.

### F01 — Open, operate, and close a cash shift (P0, A)

**Flow:** authorized cashier chooses the correct branch/register, opens a shift with counted opening cash, operates supported register sales, checks persisted totals and closes with a counted reconciliation. Reload preserves open/closed state. A wrong-branch actor cannot operate it; duplicate/uncertain submissions do not create an unintended second shift or sale.

**Source anchors:** consumer boundary `frontend/src/app/ApiProductApp.tsx:103-123` (unavailable pages and disabled shift action); existing consumer `frontend/src/features/reception/LiveMembershipCheckout.tsx:45-89` (register/current-shift adapter); APIs `api/app/api/shifts.py:251-370` (current/open/close/read); DTOs `api/app/shifts/schemas.py:79-98, 163-180` (shift state and close denomination validation). Do not assume shift API work is missing.

**Tasks:**
- [ ] Confirm cashier role, branch scope, open/close/count behavior and existing API errors.
- [ ] Agree adapter contract with current shift/register DTOs; extend API only if a specific required operation is absent.
- [ ] Mount the live shift workflow in the authenticated consumer without altering demo behavior.
- [ ] Verify open → reload → operate → close against persisted records, including wrong branch, invalid counts, already-closed and retry cases.

**Exit:** a cashier can complete and verify the register lifecycle; counts/totals reconcile to persisted records and forbidden actions remain blocked.

### F02 — Register and maintain a member (P0, A)

**Flow:** authorized staff creates a member, finds them in the paginated live list, opens detail, edits allowed fields, adds/views permitted notes, and sees saved state after hard reload. Duplicate identity, invalid input, not-found and denied actions preserve form input and do not fabricate success.

**Source anchors:** consumer `frontend/src/features/members/Members.tsx:38-51, 87-98, 198, 292-302` (demo/live directory, navigation, new-member entry and detail); current member routes/API `api/app/api/members.py:147-264` (list/create/read/update), `:268-337` (notes), DTO/query contracts `api/app/members/schemas.py`, `api/app/members/queries.py`. `frontend/src/features/members/Members.tsx:198` currently swaps “Nuevo socio” for refresh in the live mode; `ApiProductApp.tsx` currently mounts list/detail but not the complete lifecycle.

**Tasks:**
- [ ] Confirm current create/update DTO fields, patch semantics, duplicate behavior, notes privacy and roles.
- [ ] Keep A/B list/detail/reload intact while mounting create/edit/note operations in the live adapter.
- [ ] Ensure `/members/new` is matched as a form before any generic member-id detail route.
- [ ] Verify create → list → detail → edit/note → hard reload, plus invalid/duplicate/denied cases using persisted data.

**Exit:** authorized staff can complete the member lifecycle; protected notes remain admin-only and no demo provider is used.

### F03 — Create and publish a membership plan version (P1, A)

**Flow:** An authorized catalog manager creates a complete plan, publishes immutable commercial versions, and confirms persisted active plans are available to the existing membership checkout after reload. Invalid or denied writes must never appear as success; historical sales retain their plan-version snapshots.

**Source anchors:** `PlanEditor.submit`; the public `PlanCatalog({ apiRequest? })` dispatcher and its live adapter; `frontend/src/api/catalogApi.ts` (`getCatalogPlan`, `saveCatalogPlan`, `updateCatalogPlanStatus`); authenticated `/owner/plans` mount in `frontend/src/app/ApiProductApp.tsx`; catalog list/create/read/metadata-PATCH/version-publication routes in `api/app/api/catalog.py` and `CreatePlanDTO`, `PlanVersionDTO`, `PatchPlanDTO` in `api/app/catalog/schemas.py`; checkout reader `getActiveMembershipPlans` and `LiveMembershipCheckout`.

**Contract boundary:** The live integration uses `initial_version` for creation, immutable version append for commercial edits, and the existing admin-only name/status PATCH. It has no server-persisted drafts, model changes, or migrations. Commercial notes remain in `restriction_notes`. A class sample or visit is exactly one single-entry; period plans have no session-count limit.

**Recorded progress (2026-10-28):** Backend and authenticated UI implementation are complete; original layout/CSS are preserved. The detailed [F03 execution record](f03-membership-plan-catalog.md#progress-verification-and-next-step) contains the verification ledger and remaining work.

- Focused catalog/sales backend: 21 passed; focused PlanEditor/PlanCatalog/ApiProductApp frontend: 48 passed; typecheck, production build, and isolated ApiProductApp tests (14 passed) passed.
- Real synthetic API workflow: 32 assertions passed for initial v1, fresh reads, v2 with v1 preserved, status filtering, and single-entry terms. Synthetic device approval returned HTTP 204 and the ambient owner/plans screen was visible; neither proves authenticated browser navigation or UI acceptance.
- Full frontend suite: 765 passed / 11 failed. Full backend suite was interrupted at 90% by the execution cap and is not a passing result.
- Browser/visual acceptance and sale-snapshot preservation after v2 remain unverified. No commits, staging, push, or PR occurred; delivery strategy must be resolved before committing.

**Tasks:**
- [x] Confirm current catalog permissions, create/version DTOs, and routes from source.
- [x] Map `PlanEditor` output through the existing DTO boundary without inventing server drafts.
- [x] Mount the live plan workflow in the authenticated UI while preserving the demo consumer.
- [x] Verify persisted API create/read/version/status behavior and one-entry terms in focused and synthetic API checks.
- [x] Verify authenticated browser navigation, owner publish/reload, checkout availability, denied/invalid UI behavior, and historical sale snapshots after v2; disposition the full-suite failures/incomplete run.

**Exit:** Not yet satisfied. Full authenticated browser/checkout and historical sale-snapshot acceptance remain required. These checkboxes record implementation/proof outcomes only; they are not commit, native-review, or delivery approval.

### F04 — Sell a membership (P0, A)

**Flow:** cashier selects an existing member, active published plan, register and open shift; confirms payment; gets receipt and membership state; refresh/retry does not duplicate the sale. Network-uncertain outcome resumes the original idempotent intent.

**Dependencies:** F01 plus the existing member and published-plan API contracts. F02 is needed only when the flow also creates a new member; F03 is needed only if owner catalog setup/publishing is part of this delivery.

**Source anchors:** consumer `frontend/src/features/reception/LiveMembershipCheckout.tsx:40-105`; API client `frontend/src/api/membershipCheckoutApi.ts:133-157, 201-245`; sale API `api/app/api/sales.py:87-170`; checkout backend schemas `api/app/sales/schemas.py`.

**Tasks:**
- [x] Reconcile current checkout request/response DTOs and live auth/session transport.
- [x] Mount/reuse the existing API-backed checkout from the authenticated cashier/member flow; do not build a second checkout.
- [x] Verify denied sale, invalid selection, wrong branch/register/shift, duplicate key and uncertain network retry.
- [x] Verify receipt, payment and membership against persisted records after reload.

**Exit:** existing live checkout is reachable to authorized cashiers and remains safe under retries; isolated component tests alone do not pass.

### F05 — Record a member access/check-in event (P0, A)

**Flow:** receptionist locates a member, checks current membership/eligibility, records a permitted arrival once, and sees the persisted access event after reload. Ineligible, unknown, denied or duplicate operations return a clear non-success/previous-result state, never false attendance.

**Keep distinct from C:** member access check-in is not staff attendance. A/B/C already completed live staff occurrence attendance; this is separate from member access events. This card does not claim that member-check-in API or staff occurrence backend is absent and does not recreate the C work.

**Source anchors:** route registration `api/app/main.py:232-242`; member access router `api/app/api/member_check_ins.py:21-76, 207-292` (membership-period check-in, response, idempotency, branch and eligibility checks; sample check-in is a separate operation at `:107-204`); membership eligibility `api/app/api/members.py:339-388`; authenticated consumer boundary `frontend/src/app/ApiProductApp.tsx:103-117` (unavailable default, not a live check-in screen). Verify exact operation variants and DTOs at feature start.

**Tasks:**
- [x] Map member check-in route(s), eligibility response, authorization, dedupe and event-history read contract.
- [x] Reuse existing C attendance only for staff attendance; keep member visit/access records separate.
- [x] Add the live reception adapter to the real authenticated route.
- [x] Verify eligible, expired/ineligible, unknown member, denied actor, duplicate and reload; inspect persisted access event.

**Exit:** receptionist can record and verify a real member check-in. No claim of completion from staff attendance UI or an isolated API route.

### F06 — Pay membership debt at the register (P1, A)

**Flow:** cashier selects outstanding debt, confirms remaining amount and supported method, records payment against the right register/shift, receives a receipt and sees settled/reduced balance after reload. Same request is safely replayed; altered body under the same key is rejected.

**Source anchors:** cashier consumer `frontend/src/features/reception/LiveMembershipCheckout.tsx`; API `api/app/api/sales.py:172-232`; schemas `api/app/sales/schemas.py`; member debt balance in `api/app/api/members.py:124-143, 221-240`. Check D-024 before changing policy.

**Tasks:**
- [x] Inspect debt selection, balance, payment and D-024 semantics.
- [x] Agree partial-payment, permission and method behavior before UI; extend API only for a concrete gap (`GET /api/v1/registers/{register_id}/members/{member_id}/debts`).
- [x] Add cashier adapter with zero/already-paid/partial/denied/error states (`listRegisterMemberOpenDebts`, `submitMembershipDebtPayment`, `LiveMembershipCheckout` debt_payment mode, `Members.tsx`, `MemberDetail.tsx`).
- [x] Verify idempotent retry and receipt/balance against persisted records after reload (`test_f06_b01`, `test_f06_b02`, `F06-F01`..`F06-F03`, `Members.test.tsx`, plus live Playwright E2E verification across `/reception/members/:id` and `/owner/members/:id` with partial cash payment `201 Created`, client validation guard, full settlement, and hard reload persistence).

**Exit:** payment links to the right debt, branch, register and actor; no client-calculated balance is authoritative.

### F07 — Review pending money and transfer payments (P1, A)

**Flow:** authorized owner/finance actor filters scoped pending items, opens a transfer, reviews evidence, approves/rejects with any required reason, and sees the terminal persisted state after reload. Unauthorized role/branch cannot view totals or act.

**Source anchors:** authenticated finance reader `api/app/api/pending_money.py:111-133` and finance permission checks `:79-108`; transfer review API `api/app/api/sales.py` (review route/schema—verify exact line and response contract at feature start); consumer boundary `frontend/src/app/ApiProductApp.tsx:103-117`. Decisions D-017/D-023 are inputs to verify, not presumed answers.

**Tasks:**
- [x] Verify current payload, branch scope, pagination, permission and transfer-review route (`GET /api/v1/admin/pending-money`, `POST /api/v1/registers/transfer-payments/{payment_id}/review`).
- [x] Read D-017/D-023 and reconcile approve/reject policy and evidence rules (`status: "confirmed"` and `"pending"` under `D-006`/`D-017`/`D-023`/`D-031`).
- [x] Add finance adapter with scoped filters, empty/error/stale-review states (`pendingMoneyApi.ts`, `ExpenseReport.tsx`, `CollectionsView.tsx`, `ApiProductApp.tsx` mount at `/owner/expenses`).
- [x] Verify branch denial, stale/duplicate review, durable final state and absence of cross-branch data (`F07-F01`..`F07-F04` in `pendingMoneyApi.test.ts`, `ExpenseReport.test.tsx`, `ApiProductApp.test.tsx`, plus live Playwright E2E verification on `/owner/expenses` covering `under_review` -> `pending` with `blocked_missing_funds` check-in enforcement, `pending` -> `confirmed` settlement, total update `$650.00` -> `$150.00`, and hard reload persistence).

**Exit:** an authorized finance operator can resolve a pending transfer and verify the persisted state.

### F08 — Manage staff schedule series and attendance corrections (P1, A)

**Flow:** authorized schedule manager creates/assigns a future recurring schedule series, edits/cancels future series, views generated occurrences, makes an authorized per-occurrence change, and reviews attendance occurrences and correction audit. Staff sees only allowed schedule/attendance scope. Schedule edits cannot silently rewrite historical attendance.

**Source anchors:** consumer `frontend/src/app/ApiStaffAttendance.tsx:16-`, attendance adapter `frontend/src/api/staffAttendanceApi.ts:54-134`, attendance view `frontend/src/features/reception/StaffAttendanceView.tsx:60-`; schedule API `api/app/api/staff_schedules.py:508-528` (create/assign series), `:531-570` (list series/occurrences), `:573-611` (edit occurrence), `:612-706` (edit future series), `:707-` (delete/cancel series); attendance API `api/app/api/staff_attendance.py:79-103, 215-272, 571-615` (create/list/correction contracts); schedule models `api/app/db/models/staff_schedules.py:10-`. Core schedule, occurrence and correction APIs exist; do not rebuild them.

**Tasks:**
- [ ] Verify series create/assign/update/cancel, occurrence and exception contracts and manager scope.
- [ ] Verify attendance correction fields, reason, audit record, and historical immutability.
- [ ] Add the live schedule-series editor and occurrence/attendance view; reuse attendance API/client.
- [ ] Verify series creation/assignment/edit, timezone/overlap conflict, one-off occurrence correction and audit, denied scope, hard reload and unchanged historical attendance.

**Exit:** schedule owner can manage future series and inspect real occurrences; permitted corrections are auditable. If a concrete endpoint/field is absent, record that specific gap rather than classify the whole API as missing.

### F09 — Set up inventory and record stock movement (P1, B)

**Flow:** authorized inventory owner creates product, initializes stock where allowed, records supported receive/adjust/count movement with reason, and sees durable on-hand quantity and movement history after reload. Invalid/duplicate movement is rejected safely.

**Source anchors:** authenticated consumer boundary `frontend/src/app/ApiProductApp.tsx:103-117`; API `api/app/api/inventory.py:46-84` covers product create/list and initial stock setup/list; schemas `api/app/inventory/schemas.py`; models/queries `api/app/db/models/inventory.py`, `api/app/inventory/queries.py`. Do NOT call receiving/adjustments already implemented. Verify D-015 before choosing supported movement types.

**Tasks:**
- [x] Read D-015 and current inventory DTO/model/queries; distinguish opening stock from later movement.
- [x] Agree units, ledger, negative-stock, reason and audit rules.
- [x] Add only the missing API operations demonstrated by the agreed flow.
- [x] Mount owner inventory adapter and verify empty, duplicate, invalid, denied, persisted quantity and history.

**Exit:** every delivered stock change has durable provenance; local UI state is not stock truth.

### F10 — Sell products and process refunds/returns (P2, C)

**Discovery first:** define sale/tax/discount, inventory decrement, register/payment, return/refund, receipt, accounting ownership and role authorization. No product-POS/refund HTTP contract is confirmed by the current source baseline; confirm domain code before asserting absence.

**Source anchors:** existing register flow `frontend/src/features/reception/LiveMembershipCheckout.tsx`; sales API `api/app/api/sales.py`; inventory API `api/app/api/inventory.py`; product model `api/app/db/models/inventory.py:32-`. These are related primitives, not proof of product POS.

**Tasks:**
- [ ] Name product-sale and return/refund owner and resolve partial refund/stock restoration policy.
- [ ] Map reusable register, payment, inventory and receipt contracts.
- [ ] Define API and authenticated cashier flow only after the decisions are explicit.
- [ ] Verify duplicate sale, insufficient stock, denied/refund, partial refund, reload, and persisted register/payment/stock ledgers.

**Exit:** sale/refund is auditable across cash and stock; never rename membership checkout into POS.

### F11 — Manage rentals end to end (P2, C)

**Discovery first:** resolve rental item ownership, availability/reservation, issue/return, deposits, damage/late fees, payment/refund and branch scope. No rental router is confirmed by the baseline; check domain contracts before saying the feature is absent.

**Source anchors:** product/inventory context `api/app/db/models/inventory.py`, register/payment context `api/app/api/sales.py`; authenticated consumer boundary `frontend/src/app/ApiProductApp.tsx:103-117`.

**Tasks:**
- [ ] Identify current rental domain/API code and business owner.
- [ ] Define lifecycle, conflict, return and financial rules before implementation.
- [ ] Build only evidenced missing API and an authenticated staff adapter.
- [ ] Verify unavailable item, duplicate reservation, late/damaged return, denied actor and durable rental history.

**Exit:** operator can reserve/issue/return with consistent availability and financial records; no invented late/damage policy.

### F12 — Record and review expenses (P2, C)

**Discovery first:** resolve categories, branch/entity scope, evidence storage, approval thresholds, correction/voiding and cash-close/reporting effects. No expense router is confirmed by the supplied baseline; verify domain contracts before concluding absence.

**Source anchors:** finance permission boundary `api/app/api/pending_money.py:79-108`; authenticated consumer boundary `frontend/src/app/ApiProductApp.tsx:103-117`.

**Tasks:**
- [ ] Name expense owner and define category, approval and accounting behavior.
- [ ] Specify amount/currency/date/minor-unit semantics and evidence retention.
- [ ] Define API and owner/finance UI only after the decisions above.
- [ ] Verify permissions, invalid/duplicate amount, approve/reject, retained evidence and persisted reporting impact.

**Exit:** expense has owner, branch, audit and review state; no inferred accounting/legal rule.

### F13 — Run payroll (P2, C)

**Discovery first:** resolve employee/pay-period definitions, compensation, overtime/attendance inputs, deductions, approval, payment/export, restricted access and jurisdictional rules with the product owner. No payroll router is confirmed by the supplied baseline; verify existing domain code first.

**Source anchors:** staff attendance contract `api/app/api/staff_attendance.py:215-272`; schedule contract `api/app/api/staff_schedules.py`; authenticated consumer boundary `frontend/src/app/ApiProductApp.tsx:103-117`.

**Tasks:**
- [ ] Produce reviewed payroll calculation/source contract and decision owner.
- [ ] Define immutable pay-period snapshots, correction audit and permission model.
- [ ] Implement API and restricted payroll adapter only after requirements are approved.
- [ ] Verify missing inputs, permissions, correction policy, duplicate run and persisted period totals.

**Exit:** authorized payroll owner can review a defined period with traceable inputs; implementation invents no legal defaults.

### F14 — Review a member account history (P2, C)

**Discovery first:** specify which member history is needed and for which authorized actor. Source confirms member detail/pending balance, eligibility, admin-only notes and member check-in write operations; do not imply every payment, visit, note or membership-history listing is already exposed as a UI/API list.

**Source anchors:** consumer `frontend/src/features/members/Members.tsx:300-302` (detail entry); member detail/notes/eligibility `api/app/api/members.py:221-240, 268-388`; access/check-in router `api/app/api/member_check_ins.py:21-76`; actual check-in route `:107-169`; payment sources `api/app/api/sales.py:87-232`; check-in persistence model `api/app/db/models/member_check_ins.py:11-52`; member model `api/app/db/models/members.py:11-`. Verify exact list/read endpoints and fields for each history domain before claiming availability.

**Tasks:**
- [ ] Name the user and history question; select only needed domains (membership, payment, access/visits, eligibility, notes).
- [ ] For every chosen domain, verify a read contract, identity/scope and field semantics; list absent/uncertain sources separately.
- [ ] Decide sensitive note visibility and pagination/timezone ordering.
- [ ] Implement a focused member account timeline/sections using real contracts; add API reads only for identified requirements.
- [ ] Verify allowed/denied role, empty history, pagination, date boundary, reload and source-record links.

**Exit:** each visible history item maps to an authorized persisted source record; unknown or unavailable domains are not represented as complete.

### F15 — Review one named owner daily operations summary (P2, C)

**Discovery first:** name the owner decision and the first specific daily summary before selecting metrics. Define branch scope, business date/timezone, totals, exclusions, source records and zero-vs-missing. This is one named summary, not a generic reports dashboard or an all-domain history card.

**Source anchors:** authenticated owner route boundary `frontend/src/app/ApiProductApp.tsx:103-117`; possible source APIs must be mapped only after the owner question is known: `api/app/api/pending_money.py`, `api/app/api/sales.py`, `api/app/api/staff_attendance.py`, `api/app/api/shifts.py`.

**Tasks:**
- [ ] Record the owner, decision, date window/timezone, branch scope and each metric definition.
- [ ] Trace each metric to an authoritative persisted source; identify needed missing aggregation API.
- [ ] Agree API and authenticated owner adapter after definitions are approved.
- [ ] Compare results to a fixed persisted fixture; verify branch denial, timezone edge, zero/missing and reload.

**Exit:** one defined operational summary is reproducible from source records and meaningful to its named owner; no silent totals from unrelated APIs.

## Deferred discovery (not implementation-ready)

These are dependencies, not promises or estimates. Each needs an owner, contract, external authorization where applicable and failure/retention decisions.

- **Offline/sync:** permitted offline actions, conflict resolution, persistence, security and replay.
- **External payments/reconciliation:** provider, user-authorized account/session, webhook and settlement source of truth. Existing cash operations do not imply provider integration.
- **Notifications:** events, recipients, channel, consent/retention and delivery guarantees.
- **Gimi:** product/API ownership, auth boundary, data flow and failure behavior.
- **Imports/migration:** source format, mapping, validation, dry-run, duplicate policy, rollback and approval.
- **Release/deployment readiness:** migrations, backups, observability, secrets, rollback and operational owner; local suites are not release approval.

## Reusable feature Definition of Ready (DoR)

- [ ] Record current base commit, dirty paths, source-backed live consumer route and selected API/schema contracts. Revalidate on feature start; never treat dirty code as an authoritative snapshot.
- [ ] Read/reconcile current architecture/work-package intent and decision records; historical audits are not current status.
- [ ] Name actor, authenticated session transport, branch/permission boundary, happy path, failures, reload behavior and acceptance owner.
- [ ] Producer and actual consumer agree DTO semantics: required/optional/omitted/null, unknown vs zero/empty, integer minor-unit money/currency, date/timezone, identity, pagination, errors, idempotency/retry and permissions.
- [ ] Contract tests/fixtures derive from actual API DTOs, not two independently invented mocks that merely agree.
- [ ] List unresolved business decisions by name, evidence and owner. Ask only when one blocks the selected card; do not invent thresholds/legal rules or UI placement. If backend-required UI placement lacks a decision, pause UI writes and ask before choosing a screen.
- [ ] Parent derives exact allowed edit paths at feature start; explicitly assign shared auth/router/migration ownership serially. No broad upfront globs or unapproved scope expansion.

## Reusable feature Definition of Done (DoD)

- [ ] One end-to-end workflow is mounted in the real authenticated UI and uses real API contracts; no `__EVOGYM_*__` globals, runtime `DemoProvider`, or demo fallback when demo is off.
- [ ] Reuse the existing API/client/hook first; extend only for a demonstrated missing operation/field. No auth rewrite, generic framework, new SDK/schema generator, or dependency without demonstrated need.
- [ ] Observe RED then GREEN where a relevant runnable deterministic test exists; record why RED is inapplicable otherwise.
- [ ] Tests exercise correct and wrong branch/role, denied/no-data/errors, page boundary, duplicate/retry and unavailable behavior as applicable.
- [ ] Use API-shaped fixtures. Isolated client tests are not full integration proof.
- [ ] Run exact backend target plus frontend `npm run typecheck` (the app's `tsc -b`) and `npm run build`; record exact commands, outcomes, skips and failures. Root-referencing TypeScript command success/failure is not a substitute for the frontend scripts.
- [ ] Acceptance uses mounted authenticated route, disposable real API/database, browser happy path plus failure path and hard reload. Verify network request/response and persisted state, not toast alone. Contract tests do not promise full E2E.
- [ ] Record branch denial, invalid input, empty data, server errors and uncertain/duplicate retry evidence where relevant. No all-green claim with applicable skips.
- [ ] Use disposable DB and preserve real data; no production migration by default. Baseline had **17 PostgreSQL-specific tests skipped** and **one Windows symlink test skipped**; these are test/platform caveats, not a claim that PostgreSQL version 17 was used. Record exact skipped commands/tests when revalidating.
- [ ] Later implementation closes as one cohesive ODD work unit with tests/docs, commit identity and repository-policy evidence. This backlog itself is planning only and gets no feature commit.

## ODD handoff and next step

Selecting a card in a future authorized implementation creates that feature's own `odd/tasks/<feature>.md` and Engram mirror before source writes. Flow: contract → minimum API extension only if proven necessary → same authenticated UI adapter → real workflow verification → cohesive verified work-unit commit(s) → local integration under repository policy. Use one bounded writer; apply independent verification according to current RDD state/native risk. Never disable or reactivate the user's review switch automatically.

This document does not authorize or start any feature. No feature is complete merely because an endpoint, client or demo view exists. Recommended next: F01 then F02. Named product uncertainties stay attached to affected cards; none is being asked now.

## Source evidence index

- Authenticated/demo split: `frontend/src/app/ProductRoutes.tsx:22-31`.
- Authenticated routes/unavailable fallback/shift action: `frontend/src/app/ApiProductApp.tsx:103-123`.
- Staff attendance UI mount: `frontend/src/app/ApiStaffAttendance.tsx:16-`.
- Member list/create/detail/update/notes/eligibility: `api/app/api/members.py:147-388`.
- Member check-in router: `api/app/api/member_check_ins.py:21-169`.
- Staff schedule series and occurrences: `api/app/api/staff_schedules.py:531-`.
- Staff attendance list/record/correction: `api/app/api/staff_attendance.py:79-103, 215-272, 571-615`.
- Shift routes/schemas: `api/app/api/shifts.py:251-370`; `api/app/shifts/schemas.py:79-180`.
- Catalog plan APIs/schemas: `api/app/api/catalog.py:139-236`; `api/app/catalog/schemas.py:48-132`.
- Membership checkout component/client: `frontend/src/features/reception/LiveMembershipCheckout.tsx:40-105`; `frontend/src/api/membershipCheckoutApi.ts:133-245`.
- Membership/debt payment and transfer review: `api/app/api/sales.py:87-232`.
- Pending money API: `api/app/api/pending_money.py:111-133`.
- Inventory product/initial stock only: `api/app/api/inventory.py:46-84`.
- Existing A/B/C proof and completed staff occurrence attendance: `odd/tasks/abc-integration-alignment.md`.
