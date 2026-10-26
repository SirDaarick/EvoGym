# P1.1 — Contract reconciliation

## Objective
Reconcile the existing principal/session policy contract with current implementation and recorded local evidence, without implementing new runtime behavior or granting owner approval.

## Authorization and scope
The user requested continuation after the proposal to reconcile the document against current code and tests. Allowed edits:
- `docs/work-packages/contracts/P1.1-principal-session.md`
- `odd/tasks/p1-1-contract-reconciliation.md` (this recovery document)

Preserve all approved product policies and unrelated dirty work. No runtime/test/CI changes, staging, commits, secret/.env access, databases, providers, hosted checks, old temporary directories or permission changes. P1.5's earlier generic unresolved-retention wording must not override the already approved 90-day security-log policy; document that discrepancy here rather than editing outside scope.

## Plan
Route: delegated direct; one Luna document writer performs evidence mapping and reconciliation. Parent performs structural readback. Passive documentation does not require new test execution or a semantic-review ceremony.
Forecast: 120–260 authored lines, advisory only. Delivery strategy: ask-on-risk; explicit no-commit constraint remains in force. Commit identity: N/A.

## Tasks
- [x] **P11R-01:** Mapped all 23 acceptance cases as stable IDs P11-AC01–P11-AC23 and the six original decisions as DEC-01–DEC-06, with explicit policy/evidence/status boundaries.
- [x] **P11R-02:** Updated contract status to reconciled draft / approval pending, corrected stale observed-behavior claims, separated resolved P1.4 refresh mechanics from deployment proof, and retained the approved policy table without granting signoff.

## Acceptance and checks
- Preserve the full approved policy table, including six-digit PINs, lockout, alert behavior, session lifetimes, sole owner and 90-day developer-only security logs.
- Refresh digest/generation rotation and persisted session revocation resolved by P1.4 are not presented as undecided mechanics; cross-replica guarantees remain bounded.
- P1.2/P1.3/P1.4/P1.5 local recorded proof is accurately linked; recorded execution is not called a fresh test run.
- Employee policies are not marked implemented solely because they are approved; partial/missing source or test proof remains explicit.
- Every remaining item names whether it needs technical evidence, product decision, external integration authorization or owner/consumer signoff.
- No fabricated signers, deployment readiness or all-P1 completion.
- Validate referenced paths/links and `git diff --check`; do not execute runtime tests for this document-only change.

## Progress
Document-only work is complete. P1.1 remains a reconciled draft awaiting named API, business, security/privacy, and P2/P3/P4/P6 consumer review. Employee PIN lifecycle, alert access/review, employee-session lifetimes, complete owner management/bootstrap, and security-log access/retention enforcement remain implementation/evidence gaps. The approved 90-day log retention and required fields are policy, not unresolved policy decisions. P1.4's final isolated 30-test run and bounded PG/HTTP checks are recorded as historical evidence, not rerun here.

## Verification
- Structural review confirmed 23 acceptance rows and six decision rows; cited source/task/test paths were checked against the worktree.
- Matrix status totals: 3 verified-local, 14 partial, 1 partial/static-only, 5 unimplemented/unverified.
- Markdown local links: none added; file/test references use inline code citations.
- `git diff --check`: passed; only Git's existing LF-to-CRLF advisory warnings appeared for unrelated modified source files.
- No runtime tests, build, native review, DB, provider, staging, or commit was run for this passive documentation change.

## Next step
Parent structural readback completed: all 23 cases and six decisions are present, approved policy is preserved, and combined refresh/audit requirements are qualified to avoid overclaiming. Report remaining evidence gaps and required signoffs. No new product decision is needed to deliver this reconciled draft; if progression requires one, ask only the focused owner decision at that time.

