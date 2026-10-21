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
- **Approved replay and visit-deduplication policy:** (a) an exact replay of the same event with the same idempotency key returns its original result and creates no second event; (b) a distinct event for the same member within five minutes of the first valid access counts as the same visit and points to that visit, while preserving its own auditable duplicate event. The fixed window starts with the first valid access and duplicate attempts do not extend it. This policy is documented but not implemented by the online S1 code.
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

- [x] Reconcile the decision ledger, implementation board, and phase card with the approved five-minute offline clock rule and the isolated helper's actual scope.
- [x] Keep BK-029 Partial; distinguish online exact request idempotency from unimplemented online five-minute visit dedupe, and keep BK-031/BK-064 offline integration and reconnect-time revalidation pending.
- Acceptance: all four authorized documents state the same approved threshold/clock-origin semantics and do not imply queue, persistence, backend ingestion, or full integration.
- Route: delegated direct, documentation-only bounded work unit.
- Authorized scope: `odd/tasks/backend-implementation.md`, `docs/backend-plan/02-business-rules-and-decisions.md`, `docs/backend-plan/04-implementation-phases.md`, and this task record.
- Checks: structural readback of all changed sections; `git diff --check`.
- Runtime/tests: N/A; documentation only, no executable behavior changed.
- Rollback boundary: revert only this documentation reconciliation commit.

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
- No offline queue/sync behavior or five-minute visit dedupe was implemented. The user approved preserving device-captured and server-received times, using capture time for the five-minute window, retaining/flagging (not discarding) events with apparently incorrect device clocks, and a five-minute clock-skew threshold. BK-031/BK-064 integration, queue/sync, and reconnect-time entitlement revalidation remain open. The isolated classifier compares the raw timestamp against a server UTC plus monotonic-elapsed estimate only when both monotonic readings are known to share the same origin; unknown/lost origin is unverified and requires review. No timestamp correction is performed.
- Commit identity: report the final work-unit hash in delivery and Engram close evidence; a commit cannot embed its own hash in its tree without changing that hash.

## Relevant files

- `api/app/memberships/eligibility.py` - authoritative membership access evaluation.
- `api/app/api/members.py` - existing authenticated Admin/receptionist principal convention.
- `api/app/api/staff_attendance.py` and `api/app/db/models/staff_attendance.py` - related append-only event patterns; not reused as member attendance.
- `docs/backend-plan/08-local-first-and-sync.md` - future offline contract and unresolved distinction between request replay and close-time visit dedupe.

- Verification: structural readback confirmed the four authorized documents align; `git diff --check` passed. Tests N/A because no executable behavior changed.
- Outcome: BK-029 remains Partial; only documentation was reconciled.
