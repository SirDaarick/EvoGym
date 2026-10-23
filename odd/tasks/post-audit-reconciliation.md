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
- **Verification status:** no tests or builds have been run at this baseline. Prior R5 Owner/Members outcomes remain historical; current outcomes are unknown until REC-2.

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

- [x] **REC-1 — Reconcile ledger, policy, and audit-current wording.** Updated only the parent-approved documentation surfaces above: corrected task counts/status wording, aligned D-032 with the explicit independent-profile decision, and distinguished the source baseline from the historical R5 receipt in a dated reconciliation report. Preserved historical results and labeled unverified current behavior as unknown. **Route:** delegated direct; trigger: coordinated multi-document evidence reconciliation. **Acceptance:** every changed claim has a current path/commit or historical receipt; no business rule is invented; exact edit paths were parent-approved before writing. **Evidence:** parent review approved the corrections; structural checks below passed; REC-1 local commit identity is to be recorded after this task's commit.
- [ ] **REC-2 — Collect current local verification evidence.** Run the parent-approved current API suite, focused historical Owner/Members frontend tests, frontend typecheck/build, optional full frontend suite, and a database-free Alembic graph check using local runtimes and synthetic fixtures only. **Route:** delegated verification; trigger: execution of test/build commands. **Acceptance:** record exact commands, observed counts/timings/failures/skips and candidate identity; no PostgreSQL/hosted CI is used; distinguish application test evidence from production proof.

## Verification and delivery

- Passive documentation has no meaningful deterministic RED/GREEN; use structural readback, Markdown local-link checks, `git diff --check` on exact approved paths, and a fresh task-count recomputation.
- REC-2 application checks remain pending; do not infer their outcomes from prior receipts.
- Forecast for the later documentation reconciliation and report: approximately 180–300 authored additions/deletions, generated files excluded. Delivery strategy: `ask-on-risk`; if the forecast exceeds 400, stop before commit and ask the parent/user to resolve the chain strategy rather than trimming evidence.
- Each task closes with a local Conventional Commit only after explicit parent review/approval of its exact staged paths. Never stage the whole repository; no attribution trailers. REC-1 commit is explicitly authorized; any later staging/commit requires parent approval. No push, PR, or publication is authorized.

## Progress and next step

**REC-1 documentation edits have parent approval and are structurally verified; the authorized local work-unit commit is the remaining REC-1 action. REC-2 remains unchecked; its verifier results are pending publication here.** The report and linked records distinguish historical R5 proof from the fixed source baseline. No current application result is inferred. Reconciliation checks found one unrelated pre-existing documentation limitation: `odd/tasks/backend-implementation.md:895` references commit `0441da9f4bdc2fd30c5bbea3ff5586f84e0c17dd`, which is absent from this repository's object database; it was not introduced or rewritten here. The commit references introduced or corrected by REC-1 resolve. The next step after the REC-1 commit is parent mirroring/readback, then REC-2 evidence reconciliation.

## Relevant files

- `odd/tasks/backend-implementation.md` — master BK status ledger and task counts.
- `docs/backend-plan/02-business-rules-and-decisions.md` — D-032 staff schedule/overlap policy.
- `odd/tasks/bk-040-staff-labor-attendance.md` and `odd/tasks/bk030-031-backend-flows.md` — staff attendance and schedule implementation evidence.
- `odd/tasks/backend-audit-remediation.md` — historical R5 verification receipt and follow-up evidence.
- `docs/backend-audit/frontend-contract-gaps.md` and `docs/backend-audit/roadmap.md` — audit-era frontend status and phased work map.
