# Post-audit baseline reconciliation

**As of 2026-10-22 (America/Mexico_City):** the audit's clean R5 receipt is historical, not a test result for the source baseline documented here. This report reconciles the evidence boundary and the documentation status; it does not certify the application or authorize runtime changes.

## Current source baseline

| Item | Evidence |
|---|---|
| Branch / source baseline | `codex/backend-foundation` / `3996c62acfeac8c7f367032a61bf95f331ccf1b8` (`chore(tooling): configure VS Code workspace and isolated notebook exploration environment`) |
| Source baseline tree | `7d44e28bbbaf9ed0db54d732a3821f1a16604427` |
| Worktree at baseline | Tracked files clean at the source baseline; pre-existing untracked user work remains out of scope and untouched. Later documentation commits do not change this runtime reference. |
| Review mode | Receipt-driven development off by clone-local choice. No review was started or toggled. |
| Current application verification | Pending REC-2; no current-HEAD suite/build result is claimed here. |

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
| FE04 | Backend error and member-input fixes have historical focused proofs; current frontend error/retry behavior still needs current-baseline verification. |
| FE05 | Member lookup and expanded profile UI exist; reloadable read/history/entitlement contracts and API-backed detail integration remain incomplete or unverified. |
| FE06 | Repayment, voucher review, and pending-money API exist; finance visuals do not prove live payment/history integration. |
| FE07 | Shift APIs coexist with demo-driven open/close UI. Current live shift-flow integration remains unverified. |
| FE08 | Online membership/sample access APIs exist; checkout's sample-entitlement path remains an integration gap. |
| FE09 | Weekly backend schedules are implemented. The committed `StaffAttendanceView` still reads `useDemo()` and demo operations; occurrence-linked live attendance and offline sync remain pending. |
| FE10 | POS/returns UI was expanded, but product sale/stock/refund backend transactions remain incomplete. |
| FE11 | Immutable plan publication API exists; the newer editor does not by itself prove a live API adapter. |
| FE12 | Local-first queue/sync, provider payments, reporting, notifications, and Gimi remain cross-stack work. |

Do not infer that a screen, local demo flow, compilation, or successful build makes an API-backed production workflow complete. The current source tests are still pending.

## Historical R5 receipt — preserved, not reinterpreted

R5 is `f1153da6ef5718a64cd8480a69f107699ac4ebea`, tree `766529c26777de83338d394ac70c39c152a41107`; its clean migration head was `0029_class_sample_check_ins`. The receipt recorded:

| R5 check | Historical observed result |
|---|---|
| API full suite | 335 passed, 17 PostgreSQL skips, 18 warnings (371.75s) |
| Frontend full suite | 2 failed, 471 passed in 63 files (381.87s); no full retry |
| Frontend typecheck / build | Passed (7.37s / 38.79s; Vite 2.75s) |
| Migration graph / other checks | Alembic head `0029_class_sample_check_ins`; `pip check` passed; workflow YAML/AST and scoped whitespace passed |
| Historical focused failures | Owner keyboard focus failed at both R5 and baseline; Members full-run timeout did not reproduce in the focused comparison. Current causes/results remain unknown. |

The earlier dirty snapshot (367 API passes/17 skips and 578 frontend passes) is separate historical evidence and does not replace the R5 clean receipt or establish current HEAD behavior. No PostgreSQL runtime, hosted CI, browser E2E, deployment, or production proof is claimed.

## Current verification ledger

| Check at current HEAD | Status |
|---|---|
| Full API suite with local synthetic fixtures | Pending delegated REC-2 verification |
| Focused historical Owner/Members frontend tests | Pending delegated REC-2 verification |
| Frontend typecheck and build | Pending delegated REC-2 verification |
| Optional full frontend suite | Pending delegated REC-2 verification |
| Alembic graph | Read-only parent/explorer observation: `0030_staff_schedules (head)`; re-collect in REC-2 for its exact receipt |
| PostgreSQL, hosted CI, external services | Not authorized and not run |

Any failed, skipped, unavailable, or unrun check must be recorded as such. These checks characterize this local baseline only; they do not prove functionality, database behavior, or production readiness.

## Scope and next step

This is documentation-only reconciliation under [`post-audit-reconciliation.md`](../../odd/tasks/post-audit-reconciliation.md). Preserve R5 counts and failure history; do not implement P1–P12, inspect private workbooks/notebooks or credentials, use a database target, or alter unrelated files. The parent has reviewed and authorized a local work-unit commit for the exact REC-1 documentation surfaces; any later staging or commit requires explicit parent approval. Remote operations remain unauthorized. The next step is the separately delegated REC-2 local verification, followed by parent review of its recorded evidence.
