# BK-040 — Staff labor attendance

## Objective

Implement branch-scoped labor attendance for all staff, including personnel without EvoGym accounts, with reception recording attendance and Administration reviewing it under existing grant scope.

## Problem and rationale

The backend only models staff login accounts, so cleaning and other employees without accounts cannot be rostered or marked. The owner confirmed attendance must cover all personnel, reception records for its own branch, and Administration has access using its existing branch or organization grant.

## Scope and constraints

- Do not use frontend/demo personnel data as backend authority.
- Keep labor attendance distinct from member visits and device pairing (BK-060).
- Reception is branch-scoped; Administration access follows active explicit Admin grants.
- Proposed conservative assumption to document: Admin manages branch roster; reception can view roster and record attendance but cannot manage identities.
- No push, no live database, and preserve unrelated dirty/untracked user files.

## Tasks

### BK040-S1 — Establish branch staff roster
- [x] Add persistent branch-scoped staff profiles independent of authentication accounts, with safe active/inactive lifecycle.
- [x] Add Admin-authorized roster operations scoped by existing grants; do not let reception manage employee identities.
- [x] Add migration and focused tests for branch isolation, duplicate/invalid data, and inactive records.
- [x] Update the master backend plan and this document with evidence and the Spanish work-unit commit.

### BK040-S2 — Record and review labor attendance
- [x] Add attendance records for all rostered staff, attributed to the reception actor, branch, and occurrence time.
- [x] Allow reception to read the roster and record only for its branch; Admin can read within active grant scope.
- [x] Treat each branch-local date as one positive attendance roll call per rostered employee; a retry returns the original record, and unmarked staff are not automatically labeled absent.
- [x] Keep records append-only, with server-derived UTC occurrence time, branch-local business date, and receptionist attribution.
- [x] Add route, authorization, migration/invariant, and branch-scope tests; update docs and commit.

### BK040-S3 — Configure schedules and record entry/exit
- [x] Let Admin configure each roster profile's expected entry time and grace tolerance through the branch-scoped roster API.
- [x] Classify a recorded entry as present through the configured tolerance boundary and late after that boundary, using the branch timezone.
- [x] Record employee exit time with reception attribution and idempotent retry behavior without weakening the existing append-only audit contract.
- [x] Add migration-backed API/model tests for configuration permissions, cutoff behavior, branch-local time, checkout, and retries; update docs and commit.
- [x] Do not implement or infer absence-finalization timing in this slice; preserve it as open until its operational trigger is defined.
- [x] Close verification follow-ups: preserve attendance snapshots on migration downgrade, include checkout in check-in replay responses, and batch checkout reads to avoid N+1 queries.

## Acceptance criteria

- Employees without login accounts can be rostered and receive labor attendance records.
- Staff profiles and attendance are always branch-scoped; no cross-branch read or write is possible for branch grants.
- Organization Admin can review all branches; branch Admin can review only its branch; reception records only its own branch.
- Inactive roster entries cannot receive new attendance; prior attendance remains readable.
- Actor identity is server-derived, and attendance is not conflated with member check-in.
- Admin can set an expected entry time and tolerance for each employee; entry at the grace boundary is present and entry after it is late.
- Entry and exit are retained with server time and receptionist attribution; same-day retries do not create duplicate events.
- Historical S2 marks without configured schedules remain unclassified rather than retrospectively guessing present/late.
- An employee with no mark is not automatically assigned absence by this slice; absence timing/scheduling remain explicitly unresolved.
- Schema changes are migration-backed; targeted checks and full applicable API tests are recorded.

## Route and verification

- Route: delegated direct. Trigger evidence: new schema, authorization, API, tests, and documentation require coordinated multi-file implementation and verification.
- Writer profile: `gpt-6-luna`; one writer at a time. Parent reviews the diff and independently spot-checks focused tests.
- RDD remains off; do not toggle it. No live PostgreSQL or external services unless a test requires only opt-in disposable infrastructure.
- BK040-S3 focused checks: `& .\api\.venv\Scripts\python.exe -m pytest -q api/tests/test_staff_attendance.py api/tests/test_staff_roster.py api/tests/test_migrations.py api/tests/test_contract_smoke.py`; then full `& .\api\.venv\Scripts\python.exe -m pytest -q api/tests`.
- Delivery strategy: ask-on-risk. Forecast for S3: approximately 250–380 authored lines; re-evaluate if actual task scope grows before commit.

## Progress

- Owner decision recorded: all personnel, including cleaning staff without application access, must be included.
- Remaining design assumption: Admin manages roster; document and flag if code evidence or existing policy contradicts it.
- S2 conservative assumptions (not user-confirmed business rules): record only explicitly observed presence; an unmarked person has unspecified status, never inferred absence. Each roster profile may have one mark per branch-local date; retries on that date return the immutable original mark. The API derives the UTC timestamp and branch-local business date server-side.
- BK040-S1 and BK040-S2 are complete. The user has now authorized the new BK040-S3 scope for configurable schedules, punctuality classification, and exit capture.
- The former conservative S2 rule (unmarked means unknown, not absent) remains historically true; it is not the final requested status model. S3 implements present/late from recorded entries only.
- Open for a later task: how a reception roll-call records absence, which days an employee is expected, and when an absence is finalized. Do not invent a weekly calendar or payroll-absence consequence.
- BK040-S3 is complete: schedules classify new attendance entries as present/late, checkouts are immutable and idempotent, and absence remains outside this slice until its operational trigger is resolved.
- Independent verification follow-ups are corrected: S3 downgrade refuses when attendance schedule snapshots exist, check-in replay includes any checkout fields, and attendance-list checkout reads use a single bounded batch query.

## Relevant files

- `docs/backend-plan/04-implementation-phases.md` — master P9 requirements.
- `odd/tasks/backend-implementation.md` — canonical backend task board.
- `api/app/db/models/` — existing staff and branch persistence.
- `api/app/auth/authorization.py` — active Admin and Reception grant checks.


## BK040-S1 implementation proof

- **Implemented:** `StaffRosterProfile` persists a branch-owned identity separate from `StaffUser`, with normalized non-empty name/position, case-insensitive per-branch duplicate protection, active state, and timestamps. Admin create/update/deactivation and read operations honor active explicit branch/organization grants. Reception can read only its granted branch; identity writes are denied.
- **Migration:** `0021_staff_roster` adds the roster table, branch FK, checks, and indexes. Downgrade refuses to discard any roster rows.
- **Assumption retained:** Admin manages roster entries; reception reads its own roster but cannot modify identities. This is a conservative implementation assumption, not a user-confirmed policy. BK040-S2 below implements the attendance capture and authorization contract.
- **Test-first evidence:** initial `GET /api/v1/staff-roster` returned 404 before route implementation (RED).
- **Focused verification:** `& .\api\.venv\Scripts\python.exe -m pytest -q api/tests/test_staff_roster.py api/tests/test_migrations.py api/tests/test_contract_smoke.py` - **27 passed, 1 existing Starlette/httpx deprecation warning**.
- **Full API verification:** `& .\api\.venv\Scripts\python.exe -m pytest -q api/tests` - **220 passed, 17 skipped, 1 existing Starlette/httpx deprecation warning**. Initial full run exposed two stale assertions in `api/tests/test_contract_smoke.py` (the expected table set omitted `staff_roster_profiles`, and the migration-head check expected revision 0020); parent explicitly authorized this one test file, both assertions now expect the 0021 roster migration, and reruns pass. No live PostgreSQL or external services were used.
- **Runtime boundary:** N/A beyond exercised TestClient routes and SQLite migration tests; no deployment boundary.
- **Rollback boundary:** revert the `0021_staff_roster`-backed model, authorization, route, registration, focused tests, and BK040-S1 evidence together; migration downgrade is intentionally blocked after roster data exists.
- **Work-unit commit:** `7e7b3cb42f65c951f0044ed8948bc08608e42a18` — `feat(personal): agregar roster laboral por sucursal`.


## BK040-S2 implementation proof

- **API:** `GET /api/v1/staff-attendance` lists recorded presence events, optionally filtered by authorized `branch_id` and `business_date`, with bounded pagination. Reception reads its branch; Admin reads only branches permitted by active explicit grants. `POST /api/v1/staff-attendance/branches/{branch_id}/profiles/{profile_id}` records presence only for a receptionist's own branch. No update/delete route exists.
- **Event contract:** each row references the branch roster profile and reception actor, stores server-derived UTC `occurred_at` and the branch-local `business_date`, and includes the profile name/position in reads. A branch/profile/date unique constraint returns the original event on same-day retry; ORM guards and database triggers prevent update/delete. A composite profile/branch FK blocks cross-branch association.
- **Unknown is not absent:** the API returns only positive marks. An unmarked profile has no attendance row and no inferred status. Deactivated staff cannot receive a new mark, but earlier events remain queryable; a retry for an existing event returns that immutable row.
- **Assumption retained (not user-confirmed):** attendance is an explicit observation of presence, one mark is allowed for a roster profile per branch-local calendar date, and same-date retries return the first stored event. Server clock and branch timezone derive occurrence time/date. This conservative contract does not claim that unmarked personnel are absent.
- **Migration:** `0022_staff_attendance` adds `staff_attendance_records`, a composite branch/profile FK, one-per-profile/date uniqueness, lookup index, and SQLite/PostgreSQL update/delete triggers. Downgrade refuses to discard attendance rows. `api/tests/test_contract_smoke.py` was maintained to expect the new table and head revision 0022.
- **Test-first evidence:** initial `GET /api/v1/staff-attendance` returned 404 before route implementation (RED).
- **Focused verification:** `& .\api\.venv\Scripts\python.exe -m pytest -q api/tests/test_staff_attendance.py api/tests/test_migrations.py api/tests/test_contract_smoke.py` - **29 passed, 1 existing Starlette/httpx deprecation warning**.
- **Full API verification:** `& .\api\.venv\Scripts\python.exe -m pytest -q api/tests` - **223 passed, 17 skipped, 1 existing Starlette/httpx deprecation warning**. All database-backed tests used disposable SQLite; no live PostgreSQL or external services were used.
- **Runtime boundary:** N/A beyond TestClient/SQLite; no deployment or remote service.
- **Rollback boundary:** revert the `0022_staff_attendance` migration, model, permission, router registration, focused tests, smoke expectations, and BK040-S2 documentation together. Migration downgrade is blocked while attendance rows exist.
- **Work-unit commit:** `8780821821867269934247ff1c96af8c12ccfdb4` — `feat(personal): registrar asistencia laboral por sucursal`.


## BK040-S3 implementation proof

- **Implemented:** Admin configures `expected_entry_time` plus `grace_tolerance_minutes` through the existing grant-scoped roster PATCH. Reception cannot configure it. Check-in uses server UTC and branch IANA timezone, rejects incomplete schedules, classifies through the inclusive cutoff as `present` and afterward as `late`, and snapshots the applied values.
- **Checkout:** Reception appends a separate checkout event tied to an entry; actor/time are server-derived, retry returns the existing event, checkout before entry and checkout without entry are rejected. Entry records remain append-only.
- **Migration:** `0023_staff_sched_checkout` adds nullable roster schedule and entry snapshots plus unique checkout event. Existing S2 rows stay unclassified (`status: null`), without backfill.
- **Remaining boundary:** Absence creation/finalization and expected-day agenda are not implemented; do not infer an absence rule from lack of entry.
- **Test-first:** new schedule classification and schedule precondition tests failed before implementation (missing classification and old behavior accepted incomplete schedule).
- **Focused check:** `& .\api\.venv\Scripts\python.exe -m pytest -q api/tests/test_staff_attendance.py api/tests/test_staff_roster.py api/tests/test_migrations.py api/tests/test_contract_smoke.py` — **35 passed, 15 warnings** (existing Starlette/httpx deprecation and SQLite expression-index reflection warnings).
- **Full API check:** `& .\api\.venv\Scripts\python.exe -m pytest -q api/tests` ? **226 passed, 17 skipped**, 15 warnings of the same types.
- **Correction proof:** migration downgrade now refuses to discard attendance rows carrying S3 status/schedule snapshots, in addition to its existing checkout-history guard. Check-in retries now include a previously recorded checkout, matching GET output. Attendance listing loads checkout rows with one `IN` query for the page rather than one query per attendance row. New migration, replay-consistency, and bounded-query tests cover all three findings.
- **Test-first correction:** the new downgrade and replay tests failed before their fixes. The first query-count assertion observed the setup engine instead of the app's engine and was too weak; it was corrected to observe the live app engine and require exactly one checkout SELECT for a three-row page, directly detecting the former N+1 behavior.
- **Focused correction verification:** the required command completed with **35 passed, 15 warnings**, comprising the existing Starlette/httpx deprecation and SQLite expression-index reflection warnings. `git diff --check` passed after edits.

- **Focused verification (S3 implementation):** 33 passed, 15 warnings before the verification corrections below.
- **Full API verification (final):** 226 passed, 17 skipped, 15 warnings.

- **Work-unit commit:** `61709bae2dee27f2a69adf9bf869b24324f6b240` — `feat(personal): configurar horarios y registrar salidas` (verified current S3 commit; supersedes the erroneous recorded hash `4e7ac1c`).
