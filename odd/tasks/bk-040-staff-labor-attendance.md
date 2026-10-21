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
- [ ] Add attendance records for all rostered staff, attributed to the reception actor, branch, and occurrence time.
- [ ] Allow reception to read the roster and record only for its branch; Admin can read within active grant scope.
- [ ] Treat each branch-local date as one positive attendance roll call per rostered employee; a retry returns the original record, and unmarked staff are not automatically labeled absent.
- [ ] Keep records append-only, with server-derived UTC occurrence time, branch-local business date, and receptionist attribution.
- [ ] Add route, authorization, migration/invariant, and branch-scope tests; update docs and commit.

## Acceptance criteria

- Employees without login accounts can be rostered and receive labor attendance records.
- Staff profiles and attendance are always branch-scoped; no cross-branch read or write is possible for branch grants.
- Organization Admin can review all branches; branch Admin can review only its branch; reception records only its own branch.
- Inactive roster entries cannot receive new attendance; prior attendance remains readable.
- Actor identity is server-derived, and attendance is not conflated with member check-in.
- Schema changes are migration-backed; targeted checks and full applicable API tests are recorded.

## Route and verification

- Route: delegated direct. Trigger evidence: new schema, authorization, API, tests, and documentation require coordinated multi-file implementation and verification.
- Writer profile: `gpt-6-luna`; one writer at a time. Parent reviews the diff and independently spot-checks focused tests.
- RDD remains off; do not toggle it. No live PostgreSQL or external services unless a test requires only opt-in disposable infrastructure.
- Focused checks to be selected by the writer after mapping the existing API patterns; then run the relevant API suite.
- Delivery strategy: ask-on-risk. Forecast: approximately 350–500 authored lines across both implementation tasks; do not trim tests/docs to meet a size heuristic.

## Progress

- Owner decision recorded: all personnel, including cleaning staff without application access, must be included.
- Remaining design assumption: Admin manages roster; document and flag if code evidence or existing policy contradicts it.
- S2 working assumption to avoid false attendance claims: record only explicitly observed presence; no check-in implies no status, not an absence. One employee may be marked once per branch-local date; retries return the existing immutable event.
- Current next step: implement BK040-S2.

## Relevant files

- `docs/backend-plan/04-implementation-phases.md` — master P9 requirements.
- `odd/tasks/backend-implementation.md` — canonical backend task board.
- `api/app/db/models/` — existing staff and branch persistence.
- `api/app/auth/authorization.py` — active Admin and Reception grant checks.


## BK040-S1 implementation proof

- **Implemented:** `StaffRosterProfile` persists a branch-owned identity separate from `StaffUser`, with normalized non-empty name/position, case-insensitive per-branch duplicate protection, active state, and timestamps. Admin create/update/deactivation and read operations honor active explicit branch/organization grants. Reception can read only its granted branch; identity writes are denied.
- **Migration:** `0021_staff_roster` adds the roster table, branch FK, checks, and indexes. Downgrade refuses to discard any roster rows.
- **Assumption retained:** Admin manages roster entries; reception reads its own roster but cannot modify identities. This is a conservative implementation assumption, not a user-confirmed policy. S2 still owns attendance capture and its authorization semantics.
- **Test-first evidence:** initial `GET /api/v1/staff-roster` returned 404 before route implementation (RED).
- **Focused verification:** `& .\api\.venv\Scripts\python.exe -m pytest -q api/tests/test_staff_roster.py api/tests/test_migrations.py api/tests/test_contract_smoke.py` - **27 passed, 1 existing Starlette/httpx deprecation warning**.
- **Full API verification:** `& .\api\.venv\Scripts\python.exe -m pytest -q api/tests` - **220 passed, 17 skipped, 1 existing Starlette/httpx deprecation warning**. Initial full run exposed two stale assertions in `api/tests/test_contract_smoke.py` (the expected table set omitted `staff_roster_profiles`, and the migration-head check expected revision 0020); parent explicitly authorized this one test file, both assertions now expect the 0021 roster migration, and reruns pass. No live PostgreSQL or external services were used.
- **Runtime boundary:** N/A beyond exercised TestClient routes and SQLite migration tests; no deployment boundary.
- **Rollback boundary:** revert the `0021_staff_roster`-backed model, authorization, route, registration, focused tests, and BK040-S1 evidence together; migration downgrade is intentionally blocked after roster data exists.
- **Work-unit commit:** `feat(personal): agregar roster laboral por sucursal` (Spanish Conventional Commit; SHA reported in delivery).
