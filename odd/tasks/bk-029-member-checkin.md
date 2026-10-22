# BK-029 - Online member check-in

Implement one bounded online API slice for membership check-in. This is partial progress only: offline capture/synchronization and end-to-end BK-029 remain blocked by BK-031/BK-064 and synchronization-time entitlement revalidation.

## S1 scope and acceptance

### Included

- Add an append-only member check-in event and migration.
- Add an authenticated online POST endpoint for an authorized receptionist or Admin at a selected branch.
- Resolve the specified membership period and enforce `evaluate_membership_access` at the current branch-local date. The evaluator remains authoritative for period dates, payment restrictions, and sale-branch equality.
- Require an `Idempotency-Key`; exact same-actor/branch/key/payload replay returns the original event, while key reuse for a different request returns conflict.
- Attribute accepted check-ins to the authenticated actor and server-owned timestamp; preserve an immutable audit event.
- Snapshot the evaluator's access reason and warnings on each accepted event for later audit; partial-payment warnings remain warning-only.
- Verify check-in, replay/mismatch, authentication/authorization, branch mismatch, invalid/expired entitlement, migration, and router registration with deterministic SQLite tests.

### Explicitly out of scope

- Offline grants, local queue, device/event IDs, batch sync, sync receipts, and revalidation on reconnect.
- BK-030 trials, physical turnstiles, client/UI integration, and staff attendance.
- Do not claim BK-029 end-to-end complete; the canonical board must retain pending dependencies.

## Blockers and open contracts

- **Dependencies:** BK-031 integration, BK-064 client queue/idempotency, and the exact synchronization-time behavior when access/payment state changes while disconnected remain unresolved.
- **Approved replay and visit-deduplication policy:** (a) an exact replay of the same event with the same idempotency key returns its original result and creates no second event; (b) a distinct event for the same member within five minutes of the first valid access counts as the same visit and points to that visit, while preserving its own auditable duplicate event. The fixed window starts with the first valid access and duplicate attempts do not extend it. Online T4 implements this fixed-window policy; offline event-time handling remains pending.
- **Approved offline time policy:** Preserve both the device-captured time and the server-received time when an offline event synchronizes. Use device-captured time for the five-minute visit window. If the device clock appears incorrect, retain the event and mark it for review rather than discarding it.
- **Approved offline clock rule:** Compare the raw device capture time against an estimate derived from a trusted server UTC anchor plus elapsed local monotonic time; classify absolute skew greater than five minutes for review. Preserve the original capture time and never silently correct it. A missing anchor/time origin or invalid monotonic reading is unverified/review, not an estimated timestamp.
- **Offline contracts still open:** BK-031/BK-064 integration, offline queue/sync, and entitlement/payment revalidation when reconnecting remain unresolved. The isolated frontend classifier below is not integrated and does not implement queueing, persistence, or backend event acceptance. BK-029 remains Partial.
- A successful online write records server acceptance only. It does not create an offline grant or imply acceptance of an unconnected client event.

## Acceptance criteria

- A membership is checked in only when the confirmed membership-access evaluator permits it for the selected branch and current local date.
- Expiry and wrong-branch access remain denied; no client-provided branch or status can override them.
- Retries with the same idempotency key and request return the same immutable check-in; conflicting reuse is rejected.
- The event records actor, membership period, branch, and server timestamp and cannot be updated or deleted through normal database protections.
- Exact idempotency-key replay and the approved five-minute same-member visit policy are distinct: the former returns the original event, while the latter links a new auditable duplicate event to the existing visit and never extends the window from the first valid access.
- Offline queue/sync and reconnect-time entitlement revalidation remain pending. The isolated classifier applies the approved five-minute clock tolerance without changing timestamps, but does not integrate the offline flow; overall BK-029 completion remains pending, and BK-029 remains Partial.

## BK-029-T2 - Offline clock anomaly classifier

- [x] Implement and test a pure frontend classifier using the fixed server UTC anchor plus local monotonic elapsed time; preserve captured timestamps and flag >5-minute skew or unverifiable inputs for review.
- [x] Document the approved threshold and algorithm while keeping offline integration and end-to-end BK-029 explicitly pending.
- Route: delegated direct, one bounded worker; test-first RED then GREEN.
- Authorized scope: `frontend/src/features/checkIns/offlineClock.ts`, `frontend/src/features/checkIns/offlineClock.test.ts`, `docs/backend-plan/08-local-first-and-sync.md`, and this task record.
- Checks: `npm test -- --run src/features/checkIns/offlineClock.test.ts` from `frontend`; `git diff --check`.
- Runtime harness: N/A; this is a pure helper with no runtime integration.
- Rollback boundary: revert only the classifier, its focused test, and associated documentation/task progress; no queue, persistence, or API behavior is changed.
- Verification: initial test-first RED (`npm test -- --run src/features/checkIns/offlineClock.test.ts`) failed because the not-yet-created classifier import could not resolve; initial GREEN -> 1 file, 7 tests passed. A follow-up regression test then showed that increasing numeric readings alone cannot prove a shared monotonic origin (RED: 1 failed, 7 passed); the classifier now requires explicit same-origin confirmation. Follow-up GREEN and `git diff --check` results are recorded in the follow-up commit evidence.
- Runtime harness: N/A; helper is pure and remains unintegrated.
- Commit identity is reported in delivery evidence; the commit cannot embed its own hash in its tree.

## BK-029-T3 - Reconcile canonical backend plan

- [x] Reconcile the decision ledger, implementation board, and P6 BK-029 phase card with the approved five-minute offline clock rule and the isolated helper's actual scope.
- [x] Keep BK-029 Partial; distinguish online exact request idempotency from T4's online five-minute visit dedupe, and keep BK-031/BK-064 offline integration and reconnect-time revalidation pending.
- Acceptance: all four authorized documents, including the P6 BK-029 card, state the approved threshold/clock-origin semantics and do not imply queue, persistence, backend ingestion, or full integration.
- Route: delegated direct, documentation-only bounded work unit.
- Authorized scope: `odd/tasks/backend-implementation.md`, `docs/backend-plan/02-business-rules-and-decisions.md`, `docs/backend-plan/04-implementation-phases.md`, and this task record.
- Checks: structural readback of all changed sections; `git diff --check`.
- Runtime/tests: N/A; documentation only, no executable behavior changed.
- Rollback boundary: revert only this documentation reconciliation commit.
- Follow-up outcome: parent review found the P6 card still lacked a current-status note; the card now records >5-minute review, shared-origin requirement, unknown-origin review, isolated helper scope, and pending offline queue/sync plus reconnect revalidation. Structural readback and `git diff --check` passed; tests N/A. Follow-up commit hash is reported outside this task file to avoid self-reference.

## Route and verification

- Route: delegated direct, one bounded S1 online work unit; one Luna writer, one commit.
- Authorized surfaces: `api/app/db/models/member_check_ins.py`, `api/app/db/models/__init__.py`, `api/app/api/member_check_ins.py`, `api/app/main.py`, `api/migrations/versions/0026_member_check_ins.py`, `api/tests/test_member_check_ins.py`, `api/tests/test_migrations.py`, `api/tests/test_contract_smoke.py`, `docs/backend-plan/04-implementation-phases.md`, `odd/tasks/backend-implementation.md`, and this file.
- Forecast: approximately 433 authored changed lines across the API, append-only model/migration, regression tests, migration-head synchronization, and task-state documentation; generated files excluded. The actual scoped diff is 419 insertions and 14 deletions (generated files excluded).
- Expected checks: `& .\api\.venv\Scripts\python.exe -m pytest -q api/tests/test_member_check_ins.py api/tests/test_membership_entitlements.py api/tests/test_membership_access.py api/tests/test_migrations.py api/tests/test_contract_smoke.py`; scoped `git diff --check`.
- Runtime harness: N/A; this slice is an HTTP API, verified through SQLite-backed FastAPI TestClient tests without live external services.
- PostgreSQL live migration/runtime proof is not part of this deterministic SQLite-only slice.
- Rollback boundary: revert the BK-029 S1 work-unit commit to remove the online route and event table without changing existing membership-sale or entitlement behavior.

## Progress

- Read-only mapping confirmed that the repository has a branch-aware membership access evaluator and separate staff attendance audit patterns, but no member check-in persistence/API.
- S1 online implementation is complete after BK-027 S1-S5; BK-029 remains Partial because offline sync and reconnect-time revalidation are pending.
- Test-first RED was observed: `pytest api/tests/test_member_check_ins.py` failed collection because the not-yet-implemented `MemberCheckIn` model was unavailable.
- GREEN: `& .\api\.venv\Scripts\python.exe -m pytest -q api/tests/test_member_check_ins.py` -> 2 passed, 1 Starlette deprecation warning.
- The first full planned run exposed 10 stale migration-schema/head expectations; after updating the current head/table expectations, `& .\api\.venv\Scripts\python.exe -m pytest -q api/tests/test_member_check_ins.py api/tests/test_membership_entitlements.py api/tests/test_membership_access.py api/tests/test_migrations.py api/tests/test_contract_smoke.py` -> 37 passed, 16 warnings.
- Migration coverage now includes the new table, Alembic head, and SQLite append-only trigger registration; smoke coverage also includes the table and head revision.
- Canonical phase-plan and backend-board entries record online-only S1 as Partial. User subsequently approved the five-minute visit policy: exact replay returns the original event; a distinct same-member event inside five minutes of first valid access links to the existing visit and is preserved as its own audit event, without extending the window.
- Online T4 now implements five-minute visit deduplication using server-recorded UTC time. Offline queue/sync remains unimplemented. The user approved preserving device-captured and server-received times, using capture time for the offline five-minute window, retaining/flagging (not discarding) events with apparently incorrect device clocks, and a five-minute clock-skew threshold. BK-031/BK-064 integration, queue/sync, and reconnect-time entitlement revalidation remain open. The isolated classifier compares the raw timestamp against a server UTC plus monotonic-elapsed estimate only when both monotonic readings are known to share the same origin; unknown/lost origin is unverified and requires review. No timestamp correction is performed.
- Commit identity: report the final work-unit hash in delivery and Engram close evidence; a commit cannot embed its own hash in its tree without changing that hash.

## Relevant files

- `api/app/memberships/eligibility.py` - authoritative membership access evaluation.
- `api/app/api/members.py` - existing authenticated Admin/receptionist principal convention.
- `api/app/api/staff_attendance.py` and `api/app/db/models/staff_attendance.py` - related append-only event patterns; not reused as member attendance.
- `docs/backend-plan/08-local-first-and-sync.md` - future offline contract and unresolved distinction between request replay and close-time visit dedupe.

- Verification: structural readback confirmed the four authorized documents align; `git diff --check` passed. Tests N/A because no executable behavior changed.
- Outcome: BK-029 remains Partial; only documentation was reconciled.

## BK-029-T4 - Online fixed-window visit deduplication

### Objective and acceptance

Implement the already-approved five-minute visit rule for the online check-in endpoint only. Keep the existing exact idempotency-key replay behavior distinct from visit deduplication.

- [x] A valid online check-in with a new idempotency key for the same member inside the five-minute window from the first valid access creates its own immutable audit event and links it to the original visit.
- [x] The first valid access starts the fixed window; duplicate events do not extend it. A check-in at exactly five minutes is outside the window and starts a new visit.
- [x] An exact same-key retry returns its original event and does not create another audit event.
- [x] PostgreSQL requests serialize on the member row before selecting or creating a visit root; SQLite tests do not prove this lock behavior.
- [x] Persist and return the visit relationship without weakening branch authorization, the membership access evaluator, or event immutability. Historical events migrate as distinct roots.
- [x] Update API tests and canonical implementation status; preserve BK-029 as Partial while offline queue/sync and reconnect-time entitlement revalidation remain unfinished.

### Scope and route

- **Route:** Delegated direct; one Luna writer implements code, tests, and documentation together.
- **Allowed edit surfaces:** `api/app/api/member_check_ins.py`; `api/app/db/models/member_check_ins.py`; new migration file under `api/migrations/versions/`; `api/tests/test_member_check_ins.py`; `api/tests/test_migrations.py`; `api/tests/test_contract_smoke.py`; `docs/backend-plan/04-implementation-phases.md`; `odd/tasks/backend-implementation.md`; and this task file.
- **Explicitly excluded:** root `backend/` notebooks, spreadsheets, exports, and virtual environment; offline queue/sync; frontend; Mercado Pago; unrelated dirty worktree files.
- **Expected checks:** `& .\api\.venv\Scripts\python.exe -m pytest -q api/tests/test_member_check_ins.py api/tests/test_migrations.py api/tests/test_contract_smoke.py`; scoped `git diff --check`.
- **Runtime harness:** N/A; online route behavior is verified with deterministic API/database tests, with no live provider or production service calls.
- **Rollback boundary:** revert the T4 work-unit commit to remove visit-link persistence and fixed-window online deduplication while retaining the existing S1 endpoint and its exact idempotency behavior.

### Progress

- [x] Record commit hash after implementation; parent review notes remain pending.
- [x] Update and read back the complete Engram mirror at `odd/bk-029-member-checkin/tasks` after the task closes.
- **Implementation:** Added durable `member_check_in_visits` roots; each event stores and returns `visit_id`. Migration 0027 gives every historical event its own root. For valid new requests, the member row is locked, then the latest visit is reused only when elapsed time is strictly less than 300 seconds. Denied access exits before root creation. Both event and visit records remain append-only.
- **Test-first RED:** The first pre-implementation run of `pytest -q api/tests/test_member_check_ins.py -k fixed_five_minute` failed before exercising visit-link assertions because the fixture's January timestamp denied access against the current entitlement date; the fixture was corrected to server-current UTC before focused GREEN. The initial failure is recorded accurately, not presented as proof of the desired behavior.
- **Focused GREEN:** `pytest -q api/tests/test_member_check_ins.py -k 'fixed_five_minute or denies_expired'` -> 2 passed, 1 deselected, 1 existing Starlette/httpx deprecation warning.
- **Full planned verification:** `& .\api\.venv\Scripts\python.exe -m pytest -q api/tests/test_member_check_ins.py api/tests/test_migrations.py api/tests/test_contract_smoke.py` -> 34 passed, 16 warnings (15 existing expression-index reflection warnings and one Starlette/httpx deprecation warning) in 58.83s. Scoped `git diff --check` passed.
- **Work-unit commit:** `05497d9`: `feat(check-in): vincular accesos duplicados a visitas`.
- **Populated-migration correction:** The regression was first run against two historical events on revision 0026 and failed because migration 0027's backfill UPDATE hit the existing append-only trigger. The migration now drops that trigger only for the backfill, restores protection after schema alteration, and retains independent roots for every old event. The regression verifies preserved event IDs, independent roots, event/visit mutation triggers, and refusal to downgrade populated data. RED: migration upgrade failed with `member_check_ins are append-only`; GREEN: the focused populated migration test passed.
- **Correction verification:** Exact required command -> 35 passed, 17 warnings in 64.25s; exact-path `git diff --check` passed. The downgrade refusal preserved both rows and the 0027 schema head. PostgreSQL migration/runtime validation was unavailable because the opt-in database is not configured; the PostgreSQL DDL branch is not runtime-proven.
- **Correction commit:** `2d626f8` — `fix(check-in): restaurar protección tras migrar visitas`.
- **Orphan-root downgrade safeguard:** Added a separate regression that creates a visit root with an empty event table. RED: downgrade unexpectedly dropped the root; GREEN: downgrade now refuses and preserves the root and 0027 head. Exact required command -> 36 passed, 18 warnings in 58.65s; scoped `git diff --check` passed. PostgreSQL runtime remains unavailable.
- **Orphan-root fix commit:** `9910886` — `fix(check-in): proteger raíces al revertir migración`.
- **Offline queue/sync and reconnect-time entitlement revalidation remain pending; BK-029 remains Partial.**
- **Next step:** Synchronize the full Engram task mirror; PostgreSQL row-lock concurrency remains unverified without its opt-in database.
