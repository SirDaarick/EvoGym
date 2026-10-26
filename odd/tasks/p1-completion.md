# P1 — Completion and evidence tracker

## Outcome and current status

Reconcile approved P1 identity/session behavior against implementation and recorded local proof without converting local verification into package signoff. **P1 implementation and local verification are complete; package acceptance is not.** No active code findings remain from reviews. First-PIN-change and phone-entry browser flows passed earlier; final Admin approval-flow browser retest is unavailable because CUA reported zero apps/browsers. Provider/production/OS ACL/scheduling evidence is unavailable or unauthorized, and named owner/consumer acceptance remains open where applicable. The complete 23-case matrix is [`docs/work-packages/contracts/P1.1-principal-session.md`](../../docs/work-packages/contracts/P1.1-principal-session.md).

## Authorization and constraints

- The user explicitly authorized integration of the remaining P1 work. Parent derives exact edit surfaces; do not repeat stale per-path approval loops. This does not authorize policy invention, external execution, credentials, production/deployed systems, or scope expansion.
- No source changes, tests/builds/installs, remote operations, real environment files/credentials, edits to other worktrees, cleanup, staging, or commits in this reconciliation. RDD remains off. No commits are expected under the user's explicit prohibition.
- Preserve synthetic-only proof. Do not claim real owner bootstrap, employee/business-session acceptance, deployment ACLs, provider delivery, or production propagation.
- Historical commands below are evidence recorded by the workers, not commands rerun during this reconciliation. Use fresh scratch paths if later verification is authorized.

## Stable milestone checklist

| ID | Outcome | Status and boundary |
|---|---|---|
| P1C-01A | Admin auth client | Done: in-memory access token, cookie refresh, single-flight renewal, safe errors, no write replay. |
| P1C-01B | Admin session provider | Done: restore, expiry renewal, approval, logout/expiry and lifecycle race handling. |
| P1C-01C | Foundation checks | Done at local unit/component boundary; see historical frontend tests/typechecks below. |
| P1C-01D | Durable logout | Done: category-bound cookie logout/revocation; independent bounded PostgreSQL refresh/logout order proof. |
| P1C-01E/F | Mounted `/admin` entry | Done locally: `/admin` is outside DemoProvider and keeps demo routes separate; independent component/root correction review passed. Real browser/server remains pending. |
| P1C-02L1–L3 | Employee-account/profile link | Done: explicit nullable FK, Admin-only directory/link, legacy rows stay unlinked, no grants changed; independent 0032→0033 PostgreSQL migration and bounded competing-link proof. |
| P1C-02U1–U3 | PIN-management/first-change UI | Done at local API/component boundary: explicit account/profile linking, one-time in-memory PIN display, public first-change route outside DemoProvider. Independent stale-context P2 correction closed; browser/server remains pending. |
| P1C-03I/R | Employee purpose, lifetime, station, deactivation, phone pairing/revocation | Implemented and locally verified; atomic phone/session replacement and lost-phone pending-code invalidation are covered. Independent 0034→0035 migration/revocation/downgrade proof and PostgreSQL unlink-vs-validation preserving Reception/Admin passed. Pairing suites: 44 backend / 66 frontend tests and both TS projects. Phone-entry browser flow passed. Legacy demo screen session consumption is P2–P6, not a P1 criterion. |
| P1C-04 | Lockout alerts | Implemented: global employee-management-only list/ack, first acknowledgement wins, no email. Final full backend and 17 PostgreSQL-specific tests passed; independent legacy/constraint/two-ack and retained-history checks passed. A resolved P1 finding priority is not P1 package signoff. |
| P1C-05I | Owner/Admin roles and bundles | Implemented: singleton owner, scoped bundles/assignments, live authorization, Owner UI, non-public bootstrap CLI. Independent 0033→0034 migration, concurrent bootstrap (one owner), and revocation lock-order proof recorded. CLI was not used for a real owner; owner/consumer acceptance and production bootstrap remain pending. |
| P1C-06I | Operational security logs | Implemented and locally verified with typed allowlist, separate managed namespace, and 90-day dry-run/apply retention. Append/store-open/retention share a stable OS lock with bounded fail-closed timeout and crash-released handles. Independent Windows two-process race test and 73-domain-test regression passed (1 symlink-capability skip); POSIX source review only. Deployment ACL, cross-host semantics, scheduling and production propagation remain unverified. |
| P1C-07I/R | Cross-boundary proof/reconciliation and final residual clauses | Local tests cover expired PIN denial/Admin reissue, refresh-reuse audit/no-email, and phone idle touch without absolute-expiry extension. Full local backend/frontend and migration checks passed. First-PIN-change and phone-entry browser flows passed. Final Admin approval-flow browser retest unavailable (CUA: no apps/browsers); package acceptance remains open. |

### Email-link recovery UI follow-up (local only)

The previously observed `/admin?approval_token=...` link now renders an explicit device-approval page rather than ordinary sign-in. Approval and recovery email tokens are validated and removed from the URL before any Admin session provider is mounted; approval is click-only, uses the configured API origin without credentials or redirects, and never signs in the email-link browser. The Forgot password flow uses enumeration-safe recovery messaging, requires explicit matching new-password confirmation, clears password fields after success, and reports that sessions were revoked. This is client/API-boundary coverage only: no real browser, mail provider, deployment, or owner acceptance is claimed. Focused frontend verification: 11 files / 72 tests passed; both app and node TypeScript projects passed. Scratch Vitest config and TS build info were kept outside the repository.

## Key implementation and proof record

Counts are bounded historical runs, not a claim that all P1 behavior was covered by one suite. Exact task/test names and detailed historical runs are kept in this document's earlier revisions only where summarized below; the contract matrix is the current AC-by-AC view.

| Slice | Recorded result | Important limitation or finding |
|---|---|---|
| P1C-01A–D Admin client/logout | Frontend focused suite 4 files/57 tests and app/node typechecks passed; backend focused logout/session/auth suite 117 passed. PostgreSQL head 0032 exercised HTTP cookie clearing and both refresh-first/logout-first barriers. | No real browser, live email provider, or deployment. Key fixed race: superseding sign-in must not hide a failed logout promise or clear newer auth state. |
| P1C-01E/F Admin mount | Historical 71 tests/5 files and both TypeScript projects passed; independent RootApp follow-up 14 tests passed. | Component/mock-fetch evidence only, not browser/server. Demo `OWNER` remains non-authoritative. |
| P1C-02L account link | Writer and independent SQLite/TestClient runs 33 passed each; PostgreSQL 0032→0033 preserved legacy null links, enforced FK/uniqueness/downgrade guard, and one competing-link schedule returned one success/one conflict. | Account link does not create accounts, change branch grants, or authorize staff account management through ordinary roster permission. |
| P1C-02U PIN UI | Writer frontend 8 files/90 tests and both typechecks; independent follow-up passed page tests, separate stale-context and duplicate-submit checks. Backend recorded 35 focused tests. | Independent P2 found old PIN/context state visible after branch change during a pending request. Fixed with layout reset + generation guard; request is not cancelled/replayed. Actual browser/server pending. |
| P1C-03 employee sessions | Latest writer backend batch 51 passed; targeted independent run 19 passed plus PostgreSQL 0034→0035 migration/revocation-race/downgrade guard and phone-only rollback checks. Frontend 33 tests/5 files and both typechecks recorded. | Three review issues were corrected: station-before-session lock order, `ValueError` for non-future expiry, and fail-closed downgrade preserving Reception data. PostgreSQL/SQLite locking is bounded proof, not exhaustive. `/staff/access` requests PIN for each phone or Reception profile entry but legacy business/demo screens do not consume its session. |
| P1C-04 alerts | Backend 15 alerts/credential tests; frontend 29 tests; independent PG legacy/constraint/two-ack first-winner checks. The downgrade history-loss finding was corrected; retained acknowledgement refusal and pending rollback passed. | Actual browser/server pending. The “P1” label on the corrected issue describes finding priority, not whole-package completion. |
| P1C-05 owner/roles | Backend 82 focused tests; frontend 47 tests/7 files; both TypeScript projects. Independent PostgreSQL 0033→0034 legacy/concurrent-bootstrap exactly one owner and permission-revocation lock-order proof. | Synthetic only; no operator bootstrap/account or owner/consumer acceptance. Do not infer deployment behavior. |
| P1C-06 logs | Before correction, `test_retention_apply_serializes_cross_process_append_before_atomic_replace` reproduced loss. After correction, focused 11 passed / 1 symlink-capability skip; broader auth/observability/settings 73 passed / 1 skip. Windows spawned-process race and lock-timeout checks passed. | No active code finding. POSIX was source-reviewed only; deployment ACL/access, cross-host/shared-storage semantics, scheduling and production propagation remain pending. |

### Representative portable commands

These describe the historical runner shape only; they were not run during this reconciliation. Use the recorded scratch proof log for exact arguments/environment and results.

```powershell
# Backend focused suites (synthetic/test environment; fresh basetemp)
$env:EVOGYM_ENV = 'test'
$env:PYTHONPATH = '<repo>/api'
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD = '1'
& '<repo>/api/.venv/Scripts/python.exe' -u -m pytest -c '<repo>/api/pyproject.toml' <focused-test-paths> -p no:cacheprovider --basetemp '<scratch>/pytest-final' -q

# Frontend focused tests and typechecks
& '<repo>/frontend/node_modules/.bin/vitest.cmd' run <focused-test-paths> --config '<scratch>/vitest.config.ts' --maxWorkers=2
& '<repo>/frontend/node_modules/.bin/tsc.cmd' --project '<repo>/frontend/tsconfig.app.json' --pretty false --incremental --tsBuildInfoFile '<scratch>/app.tsbuildinfo'
& '<repo>/frontend/node_modules/.bin/tsc.cmd' --project '<repo>/frontend/tsconfig.node.json' --pretty false --incremental --tsBuildInfoFile '<scratch>/node.tsbuildinfo'
```

## Remaining requirements and parent actions

1. Keep P1C-07/package acceptance open until an authorized CUA environment can retest the Admin approval flow after its UI fix. Earlier first-PIN-change and phone-entry browser checks passed; the final approval retest is unavailable because CUA reported no apps/browsers.
2. No active security-log code finding remains after the stable OS-lock correction and independent Windows race test. Verify deployment OS ACL/access, scheduling, and cross-host/shared-storage guarantees only when authorized; none is claimed.
3. Legacy demo business-screen session consumption is P2–P6 scope, not an unmet P1 integration requirement. Local tests prove pairing replacement/session behavior, lost-phone pending-code invalidation, expired-PIN reissue, and phone idle touch without extending absolute lifetime.
4. Obtain named API, business, security/privacy and P2/P3/P4/P6 consumer signoff listed in the contract. No production owner bootstrap, provider setup, deployment, or consumer acceptance is inferred.
5. Preserve approved P1.1 policy and all 23 stable IDs. Do not broaden principal shape, cross-org denial codes, data classifications or deployment consistency without the owners' decisions.

## Evidence locators

- AC-by-AC status and remaining signers: `docs/work-packages/contracts/P1.1-principal-session.md`.
- Detailed historical test commands, test-first results, UI correction, PG migration/race notes and source/test paths: P1 task proof records; current concise checkpoint recorded above.
- Relevant current sources/tests include `api/app/auth/`, `api/app/api/admin_role_management.py`, `api/app/api/staff_credentials.py`, `api/app/observability/security.py`, `api/app/observability/expire_operational_logs.py`, `frontend/src/features/auth/StaffAccessPage.tsx`, and `api/tests/test_employee_session_lifecycle.py`.

## Key Learnings

1. Employee authentication at `/staff/access` does not imply the legacy demo business screens enforce that server session.
2. Migration and independent-test success cannot establish real owner, consumer, browser, provider, or deployment acceptance.
3. The managed operational log store uses a stable lockfile and OS process lock; all cooperating appends and retention rewrites serialize, while non-cooperating hosts need deployment-level shared-store guarantees.

## Follow-on P1C-03R/07R local result

The explicitly authorized follow-on writer closed the residual implementation locally without a schema migration. Test-first evidence was observed before behavior changes. Final synthetic-only verification used a fresh scratch cwd and empty frontend env directory:

| Boundary | Result |
|---|---|
| Backend | `test_devices.py`, `test_staff_credentials.py`, `test_admin_auth.py`, and `test_employee_session_lifecycle.py`: 44 passed, 1 Starlette/httpx deprecation warning. |
| Frontend | 9 focused files (staff device API/component, staff access, Admin app/RootApp, email approval/recovery, Admin session provider/client): 66 tests passed. |
| TypeScript | App and node projects both passed with build-info files kept in scratch. |
| Test-first corrections | Expected backend RED showed pairing replacement did not revoke phone sessions and lost-phone unlink left a pending code. An intermediate reissue test also exposed that the fixture's Admin session expired at the seven-day boundary; the test now keeps Admin authorization valid while isolating employee-PIN expiry. Expected frontend RED showed missing pairing/API surfaces; final focused suites passed after correcting test response/selector expectations. |

No PostgreSQL writer race, real browser/server, live device, owner/consumer approval, or production/deployment behavior was run or inferred. P1C-07I and overall P1 remain open.

## Final residual implementation unit

- [x] **P1C-03R:** Implemented and locally tested atomic phone/session replacement; lost-phone unlink revokes only phone sessions and invalidates outstanding codes. Added Admin one-time pairing-code/device controls and employee pairing form with memory-only browser UUID/code. Reception and Admin sessions are preserved. Real browser/device and independent concurrency proof remain pending.
- [x] **P1C-07R:** Local tests prove seven-day initial-PIN denial plus Admin reissue/forced change; refresh-reuse audit event/no new email delivery; and authorized phone activity sliding the idle touch without extending the fixed absolute expiry. Do not invent employee refresh-token rotation. Legacy demo business consumers remain separate P2–P6 integration, not P1 authority.

One Luna writer, exact surfaces supplied in its bounded delegation; no schema migration is required. Forecast 200–400 authored lines plus tests, advisory. The final browser recheck is blocked because CUA currently reports no available browser or IAB. The earlier real browser did prove first-PIN change and phone login, and exposed the missing email approval UI, now implemented with focused tests; it did not complete the Owner/Admin flows. Deployment ACLs/provider delivery and named acceptance remain explicitly unverified.

## Full backend regression correction — 2026-10-24

The parent-authorized post-regression correction was limited to SQLite-compatible migration operations, revision names, and legacy test fixtures/assertions for the approved auth contracts. It did not change runtime authorization behavior or weaken role, revocation, or missing-session-factory denial coverage.

| Verification | Result |
|---|---|
| Full backend suite before the final test-double correction | 467 passed, 18 skipped, 1 failed in 1261.37s. The sole failure was `test_employee_session_migration_downgrade_allows_legacy_phone_rows`: its fake Alembic operation object did not model the new `batch_alter_table` downgrade call. |
| Corrected downgrade test double | `test_employee_session_migration_downgrade_allows_legacy_phone_rows`: 1 passed in 1.27s. The full backend suite was not rerun after this final test-only correction; independent verification remains required. |
| Migration and contract smoke suites | `test_migrations.py` plus `test_contract_smoke.py`: 38 passed, 19 warnings in 162.48s. |
| Legacy approved Admin test flows | 21 focused auth/regression cases passed; the fresh migration smoke assertion was then updated to the current head and passed in the combined migration/smoke run above. |

Migration changes: `0032` now adds/drops its named check constraint through SQLite-compatible batch alteration; `0035` applies its employee-session FK/check/columns through batch alteration on upgrade and downgrade. Revisions `0035_employee_session_lifecycle` and `0036_staff_lockout_alert_ack` are within the existing Alembic revision width contract. Updated tests compare against the current `0036` head only after upgrades, preserve the intentional `0030` downgrade checkpoint, and inventory the new auth tables. The shared Admin fixture now performs the existing synthetic email-approval and poll flow rather than fabricating an access token. The staff PIN session test asserts the approved 90-day server policy, while retaining explicit 503 coverage for a missing session factory.

Independent full SQLite verification after the final test-double correction passed 468 tests with 18 skipped and no failures. The PostgreSQL observability rerun, independent review, real browser/server evidence, and owner/consumer acceptance remain pending; P1 remains open.

## PostgreSQL observability fixture correction — 2026-10-24

Independent full SQLite verification completed at 468 passed, 18 skipped, 0 failed. The independent PostgreSQL run initially recorded 16 passed, 17 skipped, and one failure in `test_postgres_audit_commits_with_caller_and_probe_is_bounded`: its historical 0003 checkpoint seeded rows with current ORM models whose schema includes later columns. The fixture now reflects and inserts only columns present at 0003 (with explicit synthetic IDs), retains the 0003-to-head upgrade, and uses current ORM models only after reaching head. Cleanup drops the isolated schema and disposes the admin engine even when setup or historical seeding fails. Audit commit/rollback and bounded readiness-probe assertions are unchanged. This entry's PostgreSQL rerun was pending at the time; the final independent rerun and aggregate results are superseded by the current reconciliation below. Overall P1 package acceptance remains open.

## Final consolidated reconciliation — 2026-10-24

This section supersedes earlier “pending independent review/PG rerun” status notes above; those remain as historical chronology. No active code findings remain. Final independent results: backend **486 total = 468 passed, 18 skipped, 0 failed** (628.97s); the 17 PostgreSQL-specific cases previously skipped in that run were subsequently run on cached local Docker and **all 17 passed** (53.85s; only symlink-capability skip not executed). PostgreSQL proof upgraded from legacy `0031` through `0036_staff_lockout_alert_ack`, preserving five legacy rows and validating six constraints/guards. Frontend **90 files / 671 tests passed**, app/node TypeScript and production Vite build passed before test-only backend fixes. Pairing: 44 backend / 66 frontend tests, both TypeScript projects, and PostgreSQL unlink-vs-validation preserving Reception/Admin. Security-log retention: stable OS lock, independent Windows two-process append-vs-retention race, and 73-domain regression passed (one symlink-capability skip); POSIX source review only.

Browser boundary: first-PIN-change and phone entry passed in an earlier real-browser run. That run exposed missing Admin approval UI; the UI was implemented and focused tests passed. Final Admin approval-flow browser retest was blocked because CUA reported no apps, browsers, or IAB, so it is **unavailable, not passed**. No owner/consumer acceptance, real owner bootstrap, live provider, production deployment, OS ACL, scheduling, or production propagation is claimed. Legacy demo business-session consumption is P2–P6 scope, not an unmet P1 integration requirement. The P1.1 matrix contains the current status for all 23 stable AC IDs.
