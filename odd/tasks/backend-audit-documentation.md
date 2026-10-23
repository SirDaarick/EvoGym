# Backend audit and recovery documentation

## Objective and baseline

Publish an evidence-based backend audit, frontend contract gap map, and implementation roadmap without changing runtime behavior. The user requested repository/documentation organization and a clear route to a complete backend.

- Audit date: 2026-10-22.
- Branch: `codex/backend-foundation`; initial HEAD: `709466caa545d862c6effc53a9bbaf1a8a28d65f`.
- Evidence describes the existing dirty working tree, not only committed HEAD. Backend schedule and frontend additions include untracked files.
- Preserve every pre-existing tracked/untracked change, private workspace, dataset, and workbook. This writer must not stage/commit or perform database/remote/destructive work. The user subsequently approved parent-controlled local `auto-chain` / `feature-branch-chain` commits; PR/push/publication remain unauthorized.
- Receipt-driven review is explicitly disabled; ordinary structural verification applies.
- Historical finalization caveat: six pre-existing backend/ledger files changed during the original audit, with cause/semantic differences then unestablished; files were left untouched. That 252/17 snapshot is not later remediation or clean-prefix proof. Local R1/R1a–R5 source commits now exist; this audit's D1–D3 documentation identities/proof and three checkboxes remain pending.

## Problem and why

Historical task completion and README claims do not fully describe today's implementation. Passing synthetic tests do not establish live PostgreSQL behavior or full frontend integration. Findings need reproducible evidence, concrete repair steps, dependencies, and regression acceptance criteria before further implementation.

## Authorized scope and rollback boundary

Only these eight documentation paths may change; rollback must remove/revert this unit's edits only, never unrelated existing changes:

1. `README.md`
2. `api/README.md`
3. `docs/backend-plan/README.md`
4. `docs/backend-audit/README.md`
5. `docs/backend-audit/findings.md`
6. `docs/backend-audit/roadmap.md`
7. `docs/backend-audit/frontend-contract-gaps.md`
8. `odd/tasks/backend-audit-documentation.md`

Non-goals: implement fixes; mark historical backend tasks complete; reconcile business-policy decisions without owner input; clean private files; certify production readiness.

## Tasks and acceptance

- [x] **T1 — Backend findings and proof.** Recorded B01–B07/H01–H03 plus E01–E03, verification limitations, foundations worth preserving, and concrete fix/test sequences. Route: delegated direct; trigger: multi-file documentation requiring audit synthesis. Stable IDs, confidence, affected locations and regression checks structurally verified. Documentation acceptance and local proof met: `44e84d0bb9e735310fda6435429fbc8924c1a202` — 61 local links in D2; cumulative 110; zero broken; docs-only.
- [x] **T2 — Frontend contract matrix.** Recorded FE01–FE12, distinguishing live, demo-only, missing, proposed, and worktree-only capabilities. Route: delegated direct; trigger: analysis spanning backend/frontend contracts. Dependencies, ordered steps and acceptance checks verified; demo behavior is not mislabeled as a server bypass. Documentation acceptance and local proof met: `d680a8b2177ff931f1fdeea810cbe8e75f03e445` — 49 committed local links; zero broken; exact docs-only manifest.
- [x] **T3 — Roadmap, navigation, and verification.** Corrected repository/API entry points, preserved the decision register/history, and documented phased completion and the next bounded unit. Route: delegated direct; trigger: coordinated documentation changes. Historical eight-document/116-link and whitespace checks passed. Documentation acceptance and local proof met: `08968c85582297120756ce137ef4ab3a71dfb645` / refreshed README entry points; exact docs-only manifest.

## Verification plan

Passive documentation has no meaningful deterministic RED: no runtime behavior changes are authorized. Structural checks replace test-first behavior checks here.

1. Read back every changed document and resolve every relative Markdown local-file link.
2. Check all required stable backend/frontend IDs and distinguish observed results from hypotheses and policy decisions.
3. Run `git diff --check -- README.md api/README.md docs/backend-plan/README.md docs/backend-audit odd/tasks/backend-audit-documentation.md`.
4. Count authored additions/deletions, confirm this unit is documentation-only, and preserve the initial dirty-tree baseline. Do not rerun application suites for passive docs.

## Delivery and progress

- Forecast: approximately 480 authored lines; observed final scope: 559 authored additions/deletions including this feature document (generated files excluded). The size heuristic is advisory, not a reason to omit evidence or acceptance criteria.
- Delivery decision: user-approved local `auto-chain` / `feature-branch-chain`; D1–D3 documentation followed the six observed R1/R1a–R5 source commits. Their identities/proof and closure were recorded by `cbe4d8a`. No PR/push/publication is authorized. Current HEAD verification is a separate pending baseline, documented in [post-audit reconciliation](../../docs/backend-audit/post-audit-reconciliation.md).
- Source audit handoffs and observed checks are the evidence of record; do not repeat the broad audit.
- Initial and final feature documents were mirrored/read back by the parent under Engram topic `odd/backend-audit-documentation/tasks` (observation 1109).
- Historical structural verification checked eight documents/116 local links, stable IDs and scoped whitespace; all passed. This original documentation-only checkpoint implemented no runtime fixes. Later R1–R5 remediation and dirty full-suite results belong to the separate recovery record, not this earlier audit's proof or any clean committed prefix.
- Next step: preserve this audit's historical unimplemented checkpoint and use [post-audit reconciliation](../../docs/backend-audit/post-audit-reconciliation.md) for the newer HEAD and pending current verification. R5 recorded 2 failed/471 passed in the full frontend run (Owner failure reproduced at baseline; Members timeout not reproduced in the focused comparison), separate from dirty 367/578 passes. No all-green current-suite verdict is inferred.
