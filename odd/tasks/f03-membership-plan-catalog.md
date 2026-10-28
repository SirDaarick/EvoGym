# F03 — Integrate the membership plan catalog

**Status: Implementation complete; focused and real API verification passed. Visual acceptance, sale-snapshot proof, full-suite disposition, and delivery remain pending.**

## Execution clarification (2026-10-27)

- The user explicitly authorized backend implementation, integration into the existing frontend, a separate Luna test author, Luna visual/flow validation, and parent review. Preserve the UI design and report scope deviations before implementing them.
- Sessions mean exactly one entrance for a class sample or visit. Other plans have no session-count limit. No N-session packages, usage counters, access-engine changes, or migration work is authorized or needed.
- Existing class-sample `single_entry` behavior is reusable; visit catalog entries retain their distinct kind. Do not silently broaden the membership checkout into visit sales.
- Route: delegated direct. One test writer first (meaningful observed RED), then one source writer, then independent read-only validation. Multi-file logic and preparation trigger delegation. Writers run sequentially to preserve the shared dirty worktree.
- Existing five tasks are retained. T01 is reconciled against Engram observation #1635 and the current source; T02–T05 remain pending until observed proof.
- RDD is explicitly off globally and clone-locally; do not enable it or start its lifecycle. Ordinary testing and independent review remain required.
- Pre-existing F02/F05 changes in `ApiProductApp.tsx` and its test must remain unstaged/uncommitted. Commit only F03 deltas if safe isolation is possible; otherwise report the limitation.
- Source inspection corrects two planning assumptions: mutable plan fields are `name` and `status` (`active`/`inactive`), not `is_active` and `description`. Applicability/conditions/restrictions remain immutable-version data in `restriction_notes`; no model field or migration is needed.
- First test-author attempt wrote no tests: backend baseline was 1 passed / 19 fixture errors (temporary-directory permissions); frontend runner timed out without results. These are environmental failures, not behavior proof. A bounded replacement test author will request elevated execution where permissions require it.

The user approved the minimalist **Class-A Ponytail path** for F03 and F08. This document updates the planning baseline and execution boundaries; source writes, tests, services, and commits still require execution under the bounded ODD task steps below. This document follows [the remaining integrations backlog](remaining-feature-integrations.md#f03--create-and-publish-a-membership-plan-version-p1-a).

## Objective and problem

Let an authorized catalog manager create a plan and publish immutable commercial versions through the existing frontend, then verify persistence and availability to the existing membership checkout.

Under the approved Class-A Ponytail scope, saving in `PlanEditor.tsx` requires complete commercial terms and publishes immediately using the existing `api/app/api/catalog.py` / `api/app/catalog/schemas.py` contract (`initial_version` on create; version append on commercial edit), with no server-persisted drafts and no Alembic database migrations. `PlanEditor` output maps directly to the existing API DTO at the form/client boundary without splitting `restriction_notes` into new database columns or adding draft tables.

## Scope and constraints

- Bind the real authenticated API directly in `frontend/src/features/owner/PlanCatalog.tsx` via a minimal `frontend/src/api/catalogApi.ts` helper, and mount `/owner/plans` in `frontend/src/app/ApiProductApp.tsx`. Do not add redundant wrapper layers such as `ApiPlanCatalog.tsx`.
- Make `onSave` asynchronous in `frontend/src/features/owner/PlanEditor.tsx`, disabling the submit button while `await onSave(...)` is in flight to prevent duplicate clicks and retaining input/error state on rejection. Do not invent custom catalog idempotency frameworks or PostgreSQL row-lock ceremonies.
- No server-persisted drafts and no Alembic database migrations (`api/app/db/models/catalog.py` is excluded from edit surfaces).
- Treat current form fields and actions as the consumer contract; preserve design, layout, styles and existing components.
- Reuse existing catalog routes, queries, models, authenticated request transport and checkout reader. Do not create another catalog framework or checkout.
- No new dependencies, generic repositories, schema generators, event buses, background publication, speculative workflow engine or durable drafts.
- Keep money as integer minor units in MXN. Do not recompute authoritative sale terms in the browser.
- Preserve every pre-existing dirty/untracked file. Reconcile any existing `ApiProductApp.tsx` and test state before route edits. Do not reset, clean, stash or commit unrelated work.

## Verified baseline

| Area | Current evidence |
| --- | --- |
| F03 intent | `remaining-feature-integrations.md:67–81`: create/publish/reload/checkout, immutable history, no assumed server drafts. |
| Catalog HTTP | `api/app/api/catalog.py:91–236`: service read/create, plan read/create/detail, version publication. |
| Initial publication | `api/app/catalog/queries.py:198–226`: `initial_version` publishes version 1 inside plan creation; no second publication request is needed. |
| Later versions | `api/app/catalog/queries.py:127–195`: appends version with next version number. |
| Access policy | `api/app/api/catalog.py:38–84,156–164,204–213`: catalog writes are admin-only, not specifically owner-only; staff can read. Catalog is not branch-specific. |
| Immutable terms | `api/app/db/models/catalog.py:93–97,179–181`: current version is latest version; ORM updates of published versions are rejected. |
| Existing form | `frontend/src/features/owner/PlanEditor.tsx:259–281`: calls synchronous `onSave`, immediately closes, catches only synchronous failure. |
| Existing catalog | `frontend/src/features/owner/PlanCatalog.tsx:17–35,221–229,405–435`: demo provider/store, edit/toggle actions and demo products panel. |
| Authenticated mount | `frontend/src/app/ApiProductApp.tsx:104–125`: no `/owner/plans` handling, so unavailable page remains. |
| Checkout reader | `frontend/src/api/membershipCheckoutApi.ts:133–156`; `frontend/src/features/reception/LiveMembershipCheckout.tsx:65–71`: reads active membership plans, then excludes missing current versions. |
| Sale enforcement/snapshot | `api/app/sales/queries.py:217–282`: validates membership kind, plan/version activity and MXN, then copies commercial terms to order item. |

Line anchors describe inspected source and must be refreshed if intersecting work changes it.

## Approved Class-A Ponytail flow

1. Authorized manager opens the existing `PlanCatalog.tsx` surface through the authenticated `/owner/plans` route in `ApiProductApp.tsx`; list and services come from the API via `catalogApi.ts`, never demo fallback.
2. Manager opens the existing three-step editor, enters complete services, duration, conditions and price, then reviews the final step. Incomplete/pending terms are rejected at validation before submission rather than stored as server drafts.
3. Final Save awaits `onSave(...)` with the submit button disabled while the request is in flight. Creating a plan submits `initial_version` in one atomic request/transaction so complete terms become published and available to checkout after fresh reads.
4. Editing commercial terms on an existing plan appends a new immutable version via the existing publication endpoint; it never rewrites an old version or historical sale. Narrow plan metadata/status updates use only the minimum backend route/query extensions required by existing `PlanCatalog.tsx` controls without schema migrations.
5. On definitive server success, the editor closes and `PlanCatalog.tsx` refreshes from authoritative API state. On failure, `PlanEditor.tsx` retains entered values, re-enables submission, and displays the error surface.
6. Refresh and hard reload show the same persisted terms. A receptionist's existing checkout obtains the newly published active plan through its existing reader.

## Resolved Class-A contract decisions

| ID | Existing frontend versus backend | Approved Class-A Ponytail resolution |
| --- | --- | --- |
| D1 | Editor allows pending services and pending/calendar expiry; backend has neither field. | Require complete terms on Save and publish immediately (`initial_version` on create; version append on edit). No server-persisted drafts and no draft tables. |
| D2 | `onSave: (...) => void` closes immediately; API is asynchronous. | Make `onSave` asynchronous (`Promise<void>`) in `PlanEditor.tsx`, disable the submit button while `await onSave(...)` is in flight, and retain input/error on failure. No visual redesign. |
| D3 | Duration includes `week` and `session`; API only accepts day/month/year for period entitlements. | Map `PlanEditor` duration selections deterministically at the form/client boundary onto existing `api/app/catalog/schemas.py` entitlement fields (e.g., weeks normalized to days; single/session entitlements mapped to existing API kind/entitlement representation) with no DB schema changes. |
| D4 | Form has `applicability`, `conditions.notes` and `restriction`; backend only has `restriction_notes`. | Map `PlanEditor` condition/restriction fields directly to existing `restriction_notes` on the API DTO at the form/client boundary without splitting `restriction_notes` into new database columns. |
| D5 | Existing activate/deactivate action; no catalog status mutation route. | Add only the narrow plan active-status / metadata update in `api/app/api/catalog.py`, `api/app/catalog/schemas.py`, and `api/app/catalog/queries.py` using existing `CatalogPlan` columns (`status`, `name`; descriptions remain versioned in `restriction_notes`). Preserve old versions and historical sales. |
| D6 | Editable plan name/kind; publication changes version fields, not plan metadata. | Update `CatalogPlan` metadata via the narrow existing-model update while appending a version when commercial terms change; block incompatible kind changes if prohibited by existing domain rules. |
| D7 | No visible code input; API requires unique code. | Generate a deterministic technical code at the client/API boundary on create intent without adding a new form field. |
| D8 | UI service keys are gym/box/box-kids; API requires UUIDs and arbitrary codes. | Resolve service UUIDs from the authenticated catalog services list at the client boundary; surface an actionable error if a required service is missing or inactive. |
| D9 | Backlog says owner; backend authorizes admin. | Retain existing backend admin authorization for writes and staff authorization for reads. |
| D10 | Catalog includes a demo products table. | Bind `PlanCatalog.tsx` directly to the live catalog API without demo fallback or absorbing F09 inventory movements. |
| D11 | Version publication has no idempotency key and computes max(version)+1. | Guard against duplicate clicks in `PlanEditor.tsx` by disabling the submit button while `await onSave(...)` is in flight. Do not add custom catalog idempotency frameworks or PostgreSQL row-lock ceremonies. |
| D12 | `current_version` means latest version; checkout only filters version presence. | Keep `current_version` as latest immutable version and enforce active status via `CatalogPlan.status` so deactivated plans are excluded from active checkout reads and sale enforcement. |

Evidence: `frontend/src/domain/models.ts:17–23`; `frontend/src/demo/plans.ts:4–16`; `PlanEditor.tsx:15–33,263–277`; `api/app/catalog/schemas.py:82–102,126–132`; baseline anchors above.

## ODD execution checklist

These are stable planning task IDs; all remain unchecked until implementation runs. Before the first source write, reconcile this file with its Engram mirror and current source. Use one bounded writer for F03 source work. Tasks are outcome/check boundaries, not automatic review cycles or forced micro-commits.

| Task | Proposed route and trigger | Outcome/check |
| --- | --- | --- |
| F03-T01 | Completed in planning + Class-A refinement. | Class-A Ponytail decisions, DTO boundary mapping, exact candidate surfaces, and zero-overlap parallel boundary with F08 recorded. |
| F03-T02 | Delegated direct writer; narrow backend status/metadata update and tests in `catalog` / `sales`. | Minimum existing-model update in `api/app/catalog/*` and `api/app/api/catalog.py` with zero migrations; deterministic RED → GREEN → refactor in `test_catalog.py` and `test_sales.py`. |
| F03-T03 | Same bounded writer, sequentially; `catalogApi.ts`, async `PlanEditor.tsx`, live `PlanCatalog.tsx`, and `/owner/plans` mount in `ApiProductApp.tsx`. | Direct API binding in `PlanCatalog.tsx` (no `ApiPlanCatalog.tsx` wrapper), in-flight submit disable in `PlanEditor.tsx`, and high-value integration tests across the 3 existing frontend test files. |
| F03-T04 | Delegated verification; test execution and cross-layer persisted workflow proof. | Checkout/history/status regression, exact checks and disposable-data browser acceptance; report failures/skips honestly. |
| F03-T05 | Parent structural review and ordinary delivery coordination. | Update evidence/mirror, scoped conventional work-unit commit(s) only after implementation authorization; review follows current user-owned RDD state. No push/PR/merge without authorization. |

- [x] **F03-T01:** Accepted Class-A flow, DTO boundary mapping, exact surfaces and zero-overlap F08 split are recorded; execution authorization and one-entry session semantics reconciled.
- [ ] **F03-T02:** Backend meets the agreed frontend contract without schema migrations or rewriting catalog/version/sales architecture.
- [ ] **F03-T03:** Existing authenticated frontend (`PlanEditor.tsx`, `PlanCatalog.tsx`, `ApiProductApp.tsx`) completes create/edit/status workflows through `catalogApi.ts`.
- [ ] **F03-T04:** Functional and browser acceptance demonstrate durable state, denial/error handling and historical preservation.
- [ ] **F03-T05:** Task/mirror/verification/commit evidence is reconciled and remaining risks are reported.

### Test-first and delivery policy

- Observe RED before each applicable deterministic behavior change, then GREEN and refactor. Existing passing tests are regressions, not invented RED evidence.
- Passive planning documentation needs structural readback only. Browser checks supplement tests; they do not replace durable backend assertions.
- Provisional forecast: **150–300 authored lines** across backend, frontend, and tests (excluding generated files), reflecting the minimalist Class-A Ponytail scope with zero migrations and no redundant wrapper components or test slop.
- Delivery strategy: **ask-on-risk**. At 150–300 lines, F03 fits comfortably within a single cohesive delivery unit below the 400-line budget; ask only if unexpected scope threatens to cross the budget.
- Run source-mutating normalizers before final functional checks and native candidate freeze. Read RDD status without changing it; assess/review only according to current native state and exact returned continuations.

## Meaningful verification plan

Trim test surfaces to high-value integration coverage without test slop. Reuse `api/tests/test_catalog.py`, `api/tests/test_sales.py`, `frontend/src/features/owner/PlanEditor.test.tsx`, `frontend/src/features/owner/PlanCatalog.test.tsx`, and `frontend/src/app/ApiProductApp.test.tsx` (do not create standalone `catalogApi.test.ts` or `ApiPlanCatalog.test.tsx`).

| Regression | Proof that matters |
| --- | --- |
| Create and reload | Authenticated HTTP create with `initial_version`; re-read from fresh database session; commercial terms, centavos and service UUIDs preserved (`api/tests/test_catalog.py`). |
| Publication/edit history | Publish v2 after a synthetic v1 sale; v1, sold price/name/duration and existing entitlement remain unchanged, fresh checkout selects current active version (`api/tests/test_catalog.py`, `api/tests/test_sales.py`). |
| Status | Deactivation excludes future sale/selection and does not alter old sales; reactivation restores availability (`api/tests/test_catalog.py`, `api/tests/test_sales.py`). |
| Async save & duplicate guard | Deferred response keeps `PlanEditor.tsx` open with submit button disabled while `await onSave(...)` is in flight; rejection retains input and error; rapid duplicate click sends only one call (`frontend/src/features/owner/PlanEditor.test.tsx`). |
| DTO roundtrip & catalog actions | `PlanCatalog.test.tsx` exercises `catalogApi.ts` through the component using API-shaped DTO fixtures for load, create/publish, commercial edit, status toggle, and reload without demo fallback (`frontend/src/features/owner/PlanCatalog.test.tsx`). |
| Live route mount | Mounted `/owner/plans` route in `ApiProductApp.tsx` renders the live catalog using authenticated transport and surfaces loading/error states honestly (`frontend/src/app/ApiProductApp.test.tsx`). |

### Planned commands — not executed in this planning session

From the repository root:

```powershell
.\api\.venv\Scripts\python.exe -m pytest -q api/tests/test_catalog.py api/tests/test_sales.py
.\api\.venv\Scripts\python.exe -m pytest -q api/tests
```

From `frontend`:

```powershell
npm test -- src/features/owner/PlanEditor.test.tsx src/features/owner/PlanCatalog.test.tsx src/app/ApiProductApp.test.tsx
npm run typecheck
npm run build
npm test
```

No Alembic migration commands or separate PostgreSQL row-lock harnesses are required under the approved Class-A scope. Record exact command, observed result and skipped test identities during verification.

## Browser acceptance plan

Prerequisites: disposable synthetic database and real local API/frontend; demo mode off; authorized manager and receptionist sessions; explicit service-code mapping; member and open cash shift if testing a purchase. Do not use real member data or mutate the existing development database without explicit authorization.

1. Open authenticated `/owner/plans`; inspect real catalog/service GET requests. Verify loading, empty, denied and server-error states; no demo fallback values.
2. Complete existing three-step editor using representative combined services, conditions and exact decimal price. Final Save submits `initial_version` with the button disabled while in flight; inspect one POST and response.
3. Confirm fresh GET and hard reload reproduce all terms mapped via the existing API contract.
4. Open existing receptionist checkout and inspect active-plan GET; select new plan and verify published name/version/price. Complete one synthetic purchase only if authorized within the disposable setup.
5. Edit commercial terms into v2; reload owner view and fresh checkout. Compare persisted v1 order item/entitlement against v2.
6. Deactivate/reactivate and inspect fresh checkout plus backend sale enforcement; old receipts/sales remain unchanged.
7. Induce validation, denied write, and server failure. Form/input remains available; in-flight guard prevents duplicate submission.
8. Compare existing desktop/mobile layout and keyboard/dialog focus behavior. No visual changes or new placement decisions are accepted implicitly.

## Acceptance criteria

- [ ] Authorized manager completes create, immediate publication (`initial_version`), commercial version append, and status toggle in `PlanCatalog.tsx` / `PlanEditor.tsx` mounted on `/owner/plans` with real API/database persistence and zero Alembic migrations.
- [ ] `PlanEditor` output maps cleanly to the existing API DTO at the form/client boundary (`restriction_notes`, duration/entitlements, centavos, service UUIDs) with no server drafts.
- [ ] `PlanEditor.tsx` awaits `onSave` asynchronously, disables submit while in flight to prevent duplicate clicks, and retains user input and error banner on failure.
- [ ] Published historical terms and existing sale snapshots remain stable after edits/status changes; current active membership version is available to checkout after reload.
- [ ] Existing design/styles/components remain unchanged except the approved async `onSave` and live API binding in `PlanCatalog.tsx`.
- [ ] High-value tests in `test_catalog.py`, `test_sales.py`, `PlanEditor.test.tsx`, `PlanCatalog.test.tsx`, and `ApiProductApp.test.tsx` pass, and unrelated F02/F05 work remains intact.

## Candidate source surfaces — NOT authorized by this document

These exact candidates reflect the approved Class-A Ponytail scope (no `api/app/db/models/catalog.py`, no `ApiPlanCatalog.tsx`, no `ApiPlanCatalog.test.tsx`, and no `catalogApi.test.ts`):

- `api/app/catalog/schemas.py`
- `api/app/catalog/queries.py`
- `api/app/api/catalog.py`
- `api/tests/test_catalog.py`
- `api/tests/test_sales.py`
- `frontend/src/api/catalogApi.ts` (proposed new minimal client helper)
- `frontend/src/app/ApiProductApp.tsx` (exclusively owned by F03 in the F03/F08 parallel wave to mount `/owner/plans`)
- `frontend/src/app/ApiProductApp.test.tsx` (exclusively owned by F03 in the F03/F08 parallel wave)
- `frontend/src/features/owner/PlanCatalog.tsx` (direct API data/action binding via `catalogApi.ts`)
- `frontend/src/features/owner/PlanCatalog.test.tsx` (API-shaped DTO roundtrip + create/publish/reload)
- `frontend/src/features/owner/PlanEditor.tsx` (async `onSave` + in-flight submit disable + error retention)
- `frontend/src/features/owner/PlanEditor.test.tsx` (async save + error retention + in-flight duplicate guard)

No database models, Alembic migrations, CSS, generic auth rewrites, unrelated members/shifts edits or inventory-movement work are included.

## Parallel-work boundary with F08 (zero-overlap execution strategy)

**F03 and F08 have 100% disjoint edit surfaces and can be implemented in parallel by separate bounded writers with zero shared files.**

Exact file ownership split:

- **F03 exclusively owns `frontend/src/app/ApiProductApp.tsx` and `frontend/src/app/ApiProductApp.test.tsx`** to mount `/owner/plans`, alongside `api/app/catalog/*`, `api/app/api/catalog.py`, `api/tests/test_catalog.py`, `api/tests/test_sales.py`, `frontend/src/api/catalogApi.ts`, and `frontend/src/features/owner/PlanCatalog*` / `PlanEditor*`.
- **F08 does not touch `ApiProductApp.tsx` or `ApiProductApp.test.tsx`**, because its target views (`frontend/src/features/owner/StaffManagement.tsx` on `/owner/staff` and `frontend/src/features/reception/StaffAttendanceView.tsx` on `/reception/staff`) are already mounted. F08 is strictly confined to `api/app/api/staff_schedules.py`, `api/app/api/staff_attendance.py`, `api/tests/test_staff_schedules.py`, `api/tests/test_staff_attendance.py`, `frontend/src/api/staffSchedulesApi.ts`, `frontend/src/api/staffAttendanceApi.ts`, `frontend/src/app/ApiStaffAttendance.tsx`, `frontend/src/features/owner/StaffManagement*`, and `frontend/src/features/reception/StaffAttendanceView*`.
- Neither F03 nor F08 introduces Alembic migrations or touches shared database models.
- When running test suites (`pytest`, `npm test`, `npm run typecheck`, `npm run build`), run verification commands sequentially or in isolated worktrees to avoid test-runner process or SQLite/file contention. Preserve all pre-existing F02/F05 changes in the working tree.

## Progress, verification and next step

- F03-T01 is reconciled with the approved Class-A plan and the explicit one-entry business rule.
- F03-T02 backend implementation is verified by the catalog/sales focused suite (21 passed). Name/status PATCH is admin-only and rejects explicit nulls. No models or migrations changed.
- F03-T03 frontend integration is implemented in the existing components, without CSS/design changes, a new wrapper file, or dependencies. The focused frontend suite passed 48 tests. Parent typecheck spot check and independent production build passed.
- F03-T04 is partial: 32 assertions passed against the real disposable API, including genuine admin/device approval, fresh-client persistence, immutable v1 after v2, active/inactive listing, and class-sample/visit single-entry terms. Browser acceptance and sale-snapshot-after-version-publication proof remain unverified.
- F03-T05 is partial: parent read the connected source and tests, and independent Luna reviews led to scoped corrections. No commits, staging, push, or PR creation occurred. Preserve every unrelated F02/F05 delta.
- Implementation task checkboxes remain open until their pending delivery/proof evidence is reconciled; source completion is not a claim of full acceptance.

### Verification ledger (latest)

| Check | Observed result |
| --- | --- |
| Focused backend catalog/sales | 21 passed, existing deprecation warning. |
| Focused frontend PlanEditor/PlanCatalog/ApiProductApp | 48 passed across three files. |
| Typecheck | Passed, including a parent spot check after the test mock typing fix. |
| Production build | Passed in independent verification. |
| Isolated ApiProductApp tests | 14 passed; the three failures seen under full-suite load did not reproduce. |
| Full frontend suite | 765 passed / 11 failed across seven files. Catalog/editor files passed. Do not call other failures pre-existing without base proof. |
| Full backend suite | Incomplete: interrupted at 90% after the 10-minute cap; no failure output at that point is not a passing verdict. |
| Real API flow | 32 assertions passed; command: `api/.venv/Scripts/python.exe tmp/f03-runtime/verify_flow.py`; results: `tmp/f03-runtime/flow-results.json`. |
| Browser visual / UI flow | Blocked: no in-app browser surface; Chrome app approval timed out before interaction. No screenshots or visual pass claimed. |
| Historical sale snapshot after v2 | Pending; immutable catalog history alone does not prove sale/entitlement snapshots. |
| Whitespace / source readback | `git diff --check` passed; parent inspected source and meaningful test changes. |

Useful test-first evidence: the backend PATCH test returned 405 before implementation and passed afterward. The legacy-student no-op test initially appended an unintended version; the scoped restriction fallback fix made it pass. The first async-save RED had an invalid missing-price fixture and is not counted as valid behavior evidence; the corrected fixture passes.

Independent review also corrected UUID service decoding, canonical version comparisons, legacy eligibility/notes preservation, unsupported-term safeguards, stable create intent codes, and fresh detail reads before uncertain publication retries. These use existing endpoints and DTOs; no new catalog/idempotency framework was added.

### Delivery and recovery

- Observed F03 product/test delta is approximately **474 authored lines**, excluding pre-existing F02/F05 changes and temporary validation files; the initial 150–300 forecast was low. Keep the useful regression checks; do not shrink code cosmetically to fit the heuristic.
- Delivery strategy remains `ask-on-risk`. The chain strategy is not selected; resolve `stacked-to-main` versus `feature-branch-chain` before the next commit. No PR or remote operation is authorized by choosing a strategy alone.
- RDD remains explicitly off. Native risk assessment was unavailable because of unrelated untracked inventory, so independent verification was treated as high-risk; no review lifecycle was started.
- Temporary validation uses only `tmp/f03-runtime/f03.sqlite3`. The existing `api/dev.db` was not touched. API: `http://127.0.0.1:18003`, parent exec session `58578`; frontend: `http://127.0.0.1:15173`, parent exec session `48784`. These are loopback synthetic fixtures, not production services. Credentials/approval delivery are confined to the temporary validation file; never commit them.
- Temporary bootstrap supports `--resume` only for its recognized validation database. Its configuration uses `.mts` because the temporary directory is outside the frontend ESM package.
- Next step: obtain browser/app access for the pending visual/UI acceptance; then complete/disposition sale-snapshot and full-suite proof, resolve delivery strategy, and create only safely isolated F03 work-unit commits. Do not include the dirty member-registration changes in `ApiProductApp.tsx` or its existing test.
