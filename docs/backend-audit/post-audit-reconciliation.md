# Post-audit baseline reconciliation

**As of 2026-10-22 (America/Mexico_City):** the audit's clean R5 receipt is historical, not a test result for the source baseline documented here. This report reconciles the evidence boundary and the documentation status; it does not certify the application or authorize runtime changes.

## Current source baseline

| Item | Evidence |
|---|---|
| Branch / source baseline | `codex/backend-foundation` / `3996c62acfeac8c7f367032a61bf95f331ccf1b8` (`chore(tooling): configure VS Code workspace and isolated notebook exploration environment`) |
| Source baseline tree | `7d44e28bbbaf9ed0db54d732a3821f1a16604427` |
| Worktree at baseline | Tracked files clean at the source baseline; pre-existing untracked user work remains out of scope and untouched. Later documentation commits do not change this runtime reference. |
| Review mode | Receipt-driven development off by clone-local choice. No review was started or toggled. |
| Documentation candidate | REC-1 docs commit `c97a190fb0fd548070c5fd60a8cd969ec36a703f`, tree `813b2ab668ed194b47bf2e8d896ea566adabe16a`; source bytes remain the tested baseline above. |
| Current source-baseline verification | REC-2 delegated local checks completed; results are below. No claim is made for hosted CI, PostgreSQL runtime, browser E2E, or production. |

The source history after R5 includes `b8c973f` (weekly staff schedules), `2dcecfc` (finance chart/table updates), `e76be10` (composable plan editor), `9cc2767` (reception operations/shift UI), `53867b5` (member management, staff pairing and operational views), and `3996c62` (workspace/tooling). These commits move the source boundary; their presence is not itself a clean test receipt or proof that demo UI is integrated with live APIs.

## Corrected task and policy status

- The master ledger has **76 main BK rows: 18 Done, 18 Partial, and 40 Not started**. The separate completed `BK-042-S1` read-API subtask is additional to those 76. Older 18/17/41 counts remain historical.
- `BK-031` remains Partial: online STAFF-1 weekly schedules, occurrences, exceptions, history-preserving edits, and same-profile overlap checks are implemented. Attendance integration and offline queue/sync/revalidation remain pending.
- `BK-040` remains Partial: branch-scoped roster/positive-mark APIs and BK040-S3 schedule configuration, present/late snapshots, and checkout are implemented. Attendance-to-weekly-occurrence linkage, correction workflow, offline queue/sync, and PostgreSQL runtime proof remain pending. See [`bk-040-staff-labor-attendance.md`](../../odd/tasks/bk-040-staff-labor-attendance.md).
- **D-032 policy:** a roster profile is branch-owned identity. Distinct profiles in different branches are independent, are not globally linked or deduplicated, and are not cross-checked for schedule overlap. Recurrence overlap checks apply to the same roster profile in its branch. This follows the user's recorded decision (Engram observation 1099); it is not a new policy choice.

## Frontend delta against the R5 gap snapshot

The [FE03–FE12 matrix](frontend-contract-gaps.md) preserves the R5 audit's integration boundaries. Later commits expanded UI and demo behavior; they do not automatically close live integration gaps. Current bounded deltas:

| Area | Current evidence and remaining boundary |
|---|---|
| FE03 | Live operational entry coexists with the older OWNER/RECEPTION demo path; explicit live/demo separation and end-to-end proof remain. |
| FE04 | Backend error and member-input fixes have historical focused proofs; the current test suites pass, but live error/retry integration and complete typed transport coverage remain unverified. |
| FE05 | Member lookup and expanded profile UI exist; reloadable read/history/entitlement contracts and API-backed detail integration remain incomplete or unverified. |
| FE06 | Repayment, voucher review, and pending-money API exist; finance visuals do not prove live payment/history integration. |
| FE07 | Shift APIs coexist with demo-driven open/close UI. Current live shift-flow integration remains unverified. |
| FE08 | Online membership/sample access APIs exist; checkout's sample-entitlement path remains an integration gap. |
| FE09 | Weekly backend schedules are implemented. The committed `StaffAttendanceView` still reads `useDemo()` and demo operations; occurrence-linked live attendance and offline sync remain pending. |
| FE10 | POS/returns UI was expanded, but product sale/stock/refund backend transactions remain incomplete. |
| FE11 | Immutable plan publication API exists; the newer editor does not by itself prove a live API adapter. |
| FE12 | Local-first queue/sync, provider payments, reporting, notifications, and Gimi remain cross-stack work. |

Do not infer that a screen, local demo flow, compilation, or successful build makes an API-backed production workflow complete. The source-baseline tests passed as recorded below; they establish local test/build behavior only, not production workflow integration.

## Historical R5 receipt — preserved, not reinterpreted

R5 is `f1153da6ef5718a64cd8480a69f107699ac4ebea`, tree `766529c26777de83338d394ac70c39c152a41107`; its clean migration head was `0029_class_sample_check_ins`. The receipt recorded:

| R5 check | Historical observed result |
|---|---|
| API full suite | 335 passed, 17 PostgreSQL skips, 18 warnings (371.75s) |
| Frontend full suite | 2 failed, 471 passed in 63 files (381.87s); no full retry |
| Frontend typecheck / build | Passed (7.37s / 38.79s; Vite 2.75s) |
| Migration graph / other checks | Alembic head `0029_class_sample_check_ins`; `pip check` passed; workflow YAML/AST and scoped whitespace passed |
| Historical focused failures | Owner keyboard focus failure is recorded at clean R5 and in its baseline comparison; the Members full-run timeout did not reproduce in the R5 focused comparison. REC-2 focused Owner/Members and full frontend suites passed without a source fix; why the historical failures occurred remains unknown. |

The earlier dirty snapshot (367 API passes/17 skips and 578 frontend passes) is separate historical evidence and does not replace the R5 clean receipt or establish current HEAD behavior. No PostgreSQL runtime, hosted CI, browser E2E, deployment, or production proof is claimed.

## Current verification ledger

The commands below exercised source baseline `3996c62acfeac8c7f367032a61bf95f331ccf1b8` (tree `7d44e28bbbaf9ed0db54d732a3821f1a16604427`), not later documentation-only commit `c97a190`. No runtime source changed during verification or REC-1. These local results are not a production or PostgreSQL proof.

| Source-baseline check | Observed result |
|---|---|
| Full API suite | From `api`, `.\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider tests`: `367 passed, 17 skipped, 19 warnings`; pytest 422.54s, wall 428.125s. Ran with a fresh file-backed SQLite database and synthetic tests. Warnings comprise one Starlette/httpx deprecation and 18 SQLAlchemy expression-index reflection warnings (`uq_staff_roster_branch_name`: one contract-smoke and 17 migration cases). A preceding invalid in-memory-SQLite attempt produced 318 passed/49 failed/17 skipped because the engine's `SingletonThreadPool` rejects `pool_timeout`/`max_overflow`; those harness errors are not product regressions and are excluded from the valid result. A no-connect `QueuePool` configuration smoke preceded the single corrected full-suite rerun. |
| Focused Owner/Members frontend tests from `frontend` | `npm.cmd test -- --run src/features/members/Members.test.tsx src/features/owner/Owner.test.tsx --maxWorkers=2`; exit 0, 2 files/24 passed, Vitest 127.86s, wall 134.671s. |
| Full frontend suite from `frontend` | `npm.cmd test -- --maxWorkers=2 --reporter=dot`; exit 0, 74 files/578 passed, Vitest 240.60s, wall 242.225s. |
| Frontend typecheck from `frontend` | `npm.cmd run typecheck`; exit 0, wall 5.601s. |
| Frontend production/PWA build from `frontend` | `npm.cmd run build`; exit 0, wall 34.637s. PWA emitted 89 precache entries (1702.24 KiB); Vite emitted its advisory warning for a chunk over 500 kB. |
| API dependency consistency from `api` | `.\.venv\Scripts\python.exe -m pip check`; exit 0, no broken requirements, wall 4.284s. |
| Alembic graph from `api` | `.\.venv\Scripts\python.exe -m alembic heads`; exit 0, `0030_staff_schedules (head)`, wall 2.237s. This graph-only check does not connect to or migrate a database. |
| PostgreSQL, hosted CI, browser E2E, external services, security scan, deployment | Not run; no authorization or production evidence is implied. |

### Safe API harness

For reproduction, start at the repository root in a fresh PowerShell process. The harness uses a new unique temp directory each time, sets `EVOGYM_DATABASE_URL` to a file-backed SQLite database there with the required `sqlite+pysqlite` driver, sets `EVOGYM_ENV=test` and `PYTHONPATH` to the local API root, and removes `EVOGYM_TEST_POSTGRES_URL` from that process. It asserts that `app.main` imports from beneath the API root before testing; native exit codes are checked so an import/test failure stops the snippet, and the original working directory is restored:

```powershell
Push-Location api
try {
    $testDbDir = Join-Path $env:TEMP ("evogym-rec2-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $testDbDir | Out-Null
    $env:PYTHONPATH = (Get-Location).Path
    $env:EVOGYM_ENV = "test"
    $env:EVOGYM_DATABASE_URL = "sqlite+pysqlite:///" + ((Join-Path $testDbDir "api.sqlite") -replace '\\', '/')
    Remove-Item Env:EVOGYM_TEST_POSTGRES_URL -ErrorAction SilentlyContinue

    & .\.venv\Scripts\python.exe -c "import app.main, pathlib; assert pathlib.Path(app.main.__file__).resolve().is_relative_to(pathlib.Path.cwd().resolve())"
    if ($LASTEXITCODE -ne 0) { throw "API import-root assertion failed with exit code $LASTEXITCODE" }

    & .\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider tests
    if ($LASTEXITCODE -ne 0) { throw "API test suite failed with exit code $LASTEXITCODE" }
}
finally {
    Pop-Location
}
```

The invalid in-memory harness was rejected before interpreting its failures as application evidence; no source fix was made for that harness-only issue. The corrected full API suite ran once.

Parent's targeted harness validation then passed: PowerShell parsed the snippet with zero errors, the settings check using `_env_file=None` accepted the required `sqlite+pysqlite` database URL, and a `QueuePool` no-connect smoke passed with a temporary-directory-contained URL. It created no database file and made no network connection. Application suites were not rerun for this documentation correction.

Any failed, skipped, unavailable, or unrun check must be recorded as such. These checks characterize the tested local source baseline only; they do not establish untested workflows, PostgreSQL runtime behavior, or production readiness.

## Scope and next step

This is documentation-only reconciliation under [`post-audit-reconciliation.md`](../../odd/tasks/post-audit-reconciliation.md). Preserve R5 counts and failure history; do not implement P1–P12, inspect private workbooks/notebooks or credentials, use a database target, or alter unrelated files. REC-1 was committed locally as `c97a190fb0fd548070c5fd60a8cd969ec36a703f`; REC-2 records delegated source-baseline verification and the corrected safe-harness validation. The parent authorized the exact REC-2 local work-unit commit and one follow-up task-file receipt commit; no further staging/commit is authorized by this task. Remote operations remain unauthorized. Next business action: refine and assign parallel work packages; implementation remains separately gated by explicit authorization.
