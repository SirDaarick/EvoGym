# A/B/C integration alignment

## Objective and authorization
Correct and locally merge the existing A identity/access, B member-read/reload and C staff-attendance packages into a verified integration branch. Preserve the existing visual design and original dirty worktrees. Ask the user before adding undefined UI. No remote execution, push, PR, production DB changes or destructive Git operations.

## Delivery
- Branch: codex/abc-integration-alignment; base: 82fc09b7b88be783ec978da2407a32bad48045c3.
- Delivery strategy: exception-ok, explicitly approved by the user on 2026-10-26; one local integration branch with cohesive conventional commits, no AI attribution.
- Forecast: existing A tracked delta 5,205 authored lines, B dirty delta 367, C dirty delta 30 plus existing B/C commits and new fixes. Counts are estimates, not scope permissions.
- RDD: off (clone and global); do not start or enable native review. Ordinary independent verification remains required.
- All substantial tasks use delegated direct: broad mapping, multi-file implementation and test execution exceed the inline evidence budget. One writer at a time.

## Scope and preservation
Capture only intended product source/tests/migrations/contract docs and named task evidence. Exclude private backend spreadsheets/notebooks, output/tmp, work/a-p15 DBs, frontend/UsersedaniAppDataLocalTempevogym-pfi-s01 build artifacts, secrets and .env runtime files. Do not change the original A/B/C or primary worktrees. Use commits/refs in the integration checkout; never reset --hard or blanket git add -A.

## Tasks
- [x] T1 Preserve selected package snapshots and reconcile A/B/C into this integration checkout, recording source SHAs, selected paths, conflicts and preservation checks.
- [ ] T2 Reconcile signed-admin/staff authentication contracts and C migration lineage with meaningful regression tests; classify and fix the twelve current C failures against approved contracts, not by weakening assertions.
- [ ] T3 Wire existing B/C frontend views to actual A session providers and authenticated routes without demo leakage or design changes; restore existing admin itemized debt visibility where supported.
- [ ] T4 Correct merge/closure documentation, safe rollback and executable verification commands to describe observed integrated behavior.
- [ ] T5 Run applicable complete API/frontend/type/build/migration checks and independent review; preserve failed/unavailable proof and perform a parent spot check and browser workflow validation where runtime is available.
- [ ] T6 Complete local integration merge only after verified acceptance; preserve dirty primary files and report branch/commit boundaries and remaining limitations.

## Acceptance and checks
Preserve admin-only credential login, operational profile PIN/temporary PIN forced replacement, remembered device restrictions and logout/unlink semantics. B member query/detail/reload and C roster/attendance must use real authorization and data through the existing design. Demo off must not fall back to fixtures. Migration graph has one head and fresh/upgrade/downgrade checks run only against disposable test databases. New deterministic behavior fixes require observed RED -> GREEN -> REFACTOR where applicable. Existing snapshot capture is not a new behavior and has no meaningful RED test; verify exact content and provenance instead. Tests, typecheck and build use installed runtimes with explicit cwd; no dependency installation or production DB access without separate authorization. Full tests and browser checks must not mutate user data; use isolated synthetic fixtures.

## Progress and evidence
- Initial scope exploration completed by Luna; no original source modifications.
- New integration checkout created safely; primary and A/B/C remain untouched.
- Source refs currently detached; B/C committed history plus dirty deltas must both be included.
- Independent read-only review baseline: API A79 pass, B12 pass, C66 pass/12 fail; frontend A18/B45/C20 pass; actual TS app/node projects pass. These are NOT integrated acceptance evidence.
- T1: selected A/B/C source snapshots are integrated with source HEAD ancestry and dirty deltas; mirror synchronization is being recorded.\n- Next: T2 reconcile A/C migration revision IDs and auth contracts; T3 wire live frontend sessions to member and staff-attendance views.


### T1 snapshot/integration evidence (2026-10-26)
- Route: delegated direct, one writer; no behavior-fix test RED applicable to snapshot capture.
- Source HEADs: A `82fc09b7b88be783ec978da2407a32bad48045c3`; B `f279ec87c2e4c62cb65e7066aff1c47a11454498`; C `67046388d7c46a4c300a305e1a6983585468fed0`.
- Snapshot commits/refs: A `8e9cf7393d149d8a15067e5dbb85b3ea6d107cb7` (`refs/abc-snapshots/a`, 158 selected changed paths); B `de26cd081ca09d8fd54b7d4badac514cd72301b1` (`refs/abc-snapshots/b`, includes B HEAD ancestry and dirty delta); C `12702cfcb7229fe72871c9b281a817372ea69c4a` (`refs/abc-snapshots/c`, includes C HEAD ancestry and dirty delta).
- Integration commits: `8e9cf73` A snapshot; `5761d02` B merge; `c033032` C merge. Final tree differs from base by 185 paths, 23,506 additions + 1,053 deletions = 24,559 authored changed lines (user-authorized size exception).
- Snapshot path scope excluded `frontend/UsersedaniAppDataLocalTempevogym-pfi-s01`, `work/`, and `odd/tasks/archive/`; source worktrees retained their original HEADs and unstaged/untracked state; alternate Git indexes used for snapshot commits.
- Semantic conflict resolutions: `api/app/api/members.py` and `api/app/api/staff_roster.py` retain A's configured signed-admin-session verification and deliberately omit B/C unsigned-admin fallback; `frontend/src/api/receptionApi.ts` keeps A typed/sanitized HTTP/network errors and C's exported shared request helper.
- No Git conflict paths remain. `git diff --check` reports imported Markdown hard-break trailing spaces in P2/P6 documents and one blank-at-EOF in `api/tests/test_member_reads.py`; content preserved for T4 cleanup. No functional suites were run in T1.
- Explicit T2 follow-up: both `api/migrations/versions/0031_admin_session_policy.py` and `api/migrations/versions/0031_staff_occurrence_attendance.py` are present with colliding Alembic revision IDs; migration graph reconciliation and tests remain pending. Snapshot provenance is not proof of runtime correctness or product readiness.