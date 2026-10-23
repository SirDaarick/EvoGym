# Post-audit baseline reconciliation

## Objective

Reconcile the audit-era documentation with the repository's current source baseline, then collect safe local verification evidence without implementing runtime fixes or claiming unverified behavior. The historical audit remains intact; new evidence must identify the exact candidate it describes.

## Problem and why

The R5 source receipt is tied to `f1153da6ef5718a64cd8480a69f107699ac4ebea`, but the branch later gained staff schedule, finance, catalog, reception, member/staff UI, and tooling commits. Audit summaries still call R5 current, backend task counts have drifted, and D-032's cross-branch overlap wording conflicts with the user's explicit decision that distinct branch roster profiles remain independent. A dated reconciliation avoids confusing historical proof with the current baseline or changing business policy by implication.

## Baseline and authority

- **Current source baseline:** `3996c62acfeac8c7f367032a61bf95f331ccf1b8` (`chore(tooling): configure VS Code workspace and isolated notebook exploration environment`), tree `7d44e28bbbaf9ed0db54d732a3821f1a16604427`, branch `codex/backend-foundation`.
- **Historical R5 receipt:** `f1153da6ef5718a64cd8480a69f107699ac4ebea`, tree `766529c26777de83338d394ac70c39c152a41107`. Preserve its API/frontend counts and limitations as historical evidence; do not restate them as HEAD results.
- **Observed repository state:** tracked worktree clean at the baseline; pre-existing untracked workbooks, notebook, `output/`, and `tmp/` are user-owned/out of scope. Do not read, stage, alter, or clean them.
- **Review mode:** receipt-driven development is off by clone-local choice. Do not start a review or change the switch.
- **Business authority:** the user's decision recorded in Engram observation 1099 treats profiles in different branches as independent; do not deduplicate them or apply cross-branch overlap checks. Same-profile schedule checks remain scoped to their defined branch/profile.
- **Ledger evidence:** the current table contains 76 main BK tasks (18 Done, 18 Partial, 40 Not started), plus a separate completed BK-042-S1 subtask row. Recompute from the ledger before finalizing any count.
- **Verification status:** REC-2 delegated checks exercised this source baseline; current local results are recorded below and in the reconciliation report. R5 remains a separate historical receipt.

## Scope and constraints

This is documentation reconciliation and safe local baseline verification only. It does not authorize functional fixes, any P1–P12 implementation, a live or hosted database, PostgreSQL, CI, external services, remote operations, credential inspection, personal-data access, installation, or cleanup of existing work. Test data must be synthetic and local. Keep skipped, failed, unavailable, or unrun checks as explicit facts; they do not authorize scope expansion.

### Approved REC-1 documentation surfaces

The parent approved these exact surfaces for REC-1:

- `odd/tasks/post-audit-reconciliation.md`
- `odd/tasks/backend-implementation.md`
- `docs/backend-plan/02-business-rules-and-decisions.md`
- `odd/tasks/backend-audit-remediation.md`
- `odd/tasks/backend-audit-documentation.md`
- `docs/backend-audit/README.md`
- `docs/backend-audit/frontend-contract-gaps.md`
- `docs/backend-audit/roadmap.md`
- `docs/backend-audit/post-audit-reconciliation.md` (new report)

Keep the change set limited to claims that are actually stale. Preserve audit receipts and unrelated product backlogs; do not rewrite historical evidence or mark frontend integration complete based only on newer demo/UI work.

## Tasks and acceptance

- [x] **REC-1 — Reconcile ledger, policy, and audit-current wording.** Updated only the parent-approved documentation surfaces above: corrected task counts/status wording, aligned D-032 with the explicit independent-profile decision, and distinguished the source baseline from the historical R5 receipt in a dated reconciliation report. Preserved historical results and labeled unverified current behavior as unknown. **Route:** delegated direct; trigger: coordinated multi-document evidence reconciliation. **Acceptance:** every changed claim has a current path/commit or historical receipt; no business rule is invented; exact edit paths were parent-approved before writing. **Evidence:** parent review and structural checks passed; committed locally as `c97a190fb0fd548070c5fd60a8cd969ec36a703f`, tree `813b2ab668ed194b47bf2e8d896ea566adabe16a`.
- [x] **REC-2 — Record current local verification evidence.** A separate verifier ran the approved API suite with synthetic file-backed SQLite fixtures, focused historical Owner/Members tests, frontend typecheck/build/full suite, dependency consistency, and a database-free Alembic graph check. **Route:** delegated verification; trigger: execution of test/build commands. **Acceptance:** record exact commands, observed counts/timings/failures/skips and source-baseline identity; no PostgreSQL/hosted CI is used; distinguish application test evidence from production proof. Evidence and limitations are recorded in the report; parent and independent review found two documentation-only API-snippet issues, both corrected and targeted-validated. Parent approved the exact REC-2 commit surfaces; post-commit receipt metadata is captured below.

## Verification and delivery

- Passive documentation has no meaningful deterministic RED/GREEN; use structural readback, Markdown local-link checks, `git diff --check` on exact approved paths, and a fresh task-count recomputation.
- REC-2 runtime evidence is collected from source baseline `3996c62acfeac8c7f367032a61bf95f331ccf1b8` (tree `7d44e28bbbaf9ed0db54d732a3821f1a16604427`). The docs-only REC-1 commit is HEAD `c97a190fb0fd548070c5fd60a8cd969ec36a703f` (tree `813b2ab668ed194b47bf2e8d896ea566adabe16a`); source bytes were not changed by REC-1 or verification. Parent/independent structural review checked nine documents and resolved 93 local Markdown links. After the API snippet correction, scoped `git diff --check` passed, all 93 local links still resolve, and trailing-whitespace count is zero. Parent's targeted validation confirmed zero PowerShell parse errors, settings URL acceptance for `sqlite+pysqlite`, and a temp-contained `QueuePool` no-connect smoke; no database file or network connection was used.
- REC-1 observed 199 authored additions/deletions. REC-2 documentation work is 114 authored additions/deletions; cumulative before the final receipt metadata is 313, generated files excluded. Delivery strategy: `ask-on-risk`; the parent approved the exact REC-2 work-unit commit and one follow-up receipt commit. No additional metadata chain is authorized; no push, PR, or publication is authorized.
- Each task closes with a local Conventional Commit after explicit parent review/approval of exact staged paths. Never stage the whole repository; no attribution trailers. REC-1 and REC-2 work-unit commits are complete; exact identities are recorded below after commit.

## Progress and next step

**REC-1 is committed locally as `c97a190fb0fd548070c5fd60a8cd969ec36a703f`; REC-2 verification and documentation reconciliation are complete and parent-approved.** The valid isolated API rerun superseded one rejected in-memory-SQLite harness attempt; its harness errors are not application regressions. REC-2 source-baseline results and limits are in the [reconciliation report](../../docs/backend-audit/post-audit-reconciliation.md). Risk assessment was initially unavailable while private/untracked inventory remained in scope; after the parent excluded that inventory, D-032 executable-change assessed medium. RDD remained off; no native review was approved or started and no authority was granted. Preserve the unrelated pre-existing unresolved commit reference at `odd/tasks/backend-implementation.md:895` without inventing a replacement. The next business action is to refine and assign parallel work packages; implementation still requires separate authorization.

## Relevant files

- `odd/tasks/backend-implementation.md` — master BK status ledger and task counts.
- `docs/backend-plan/02-business-rules-and-decisions.md` — D-032 staff schedule/overlap policy.
- `odd/tasks/bk-040-staff-labor-attendance.md` and `odd/tasks/bk030-031-backend-flows.md` — staff attendance and schedule implementation evidence.
- `odd/tasks/backend-audit-remediation.md` — historical R5 verification receipt and follow-up evidence.
- `docs/backend-audit/frontend-contract-gaps.md` and `docs/backend-audit/roadmap.md` — audit-era frontend status and phased work map.
