# Parallel work-package plan

## Objective

Create a human- and agent-ready, dependency-aware plan for the next backend/frontend work packages P1–P12. The plan will let a person take one bounded package with its context, exact future edit surface, acceptance evidence, dependencies, rollback boundary, and handoff brief. This task documents work only; it does not authorize any package implementation.

## Problem and why

The post-audit reconciliation provides a verified source baseline, but existing phase cards are broader than parallel work units and several tasks span API, frontend, migration, policy, and verification boundaries. A package plan must assign one primary owner per unfinished ledger row, name cross-package contributors separately, respect confirmed decisions, and identify which work is locally ready versus policy-, target-, or permission-gated. This avoids duplicated ownership and “backend first” sequencing that hides real dependencies.

## Baseline and authority

- Branch: `codex/backend-foundation`.
- Documentation baseline: `a80e05f20d90fc0f65cc712ae1e502430330f25a`, tree `b775df59ecfe656d5c38bdf1b61c60fca8c7c9da`.
- Runtime evidence baseline: `3996c62acfeac8c7f367032a61bf95f331ccf1b8`, tree `7d44e28bbbaf9ed0db54d732a3821f1a16604427`; see `docs/backend-audit/post-audit-reconciliation.md`. Keep the older R5 receipt historical.
- The master ledger has 76 main tasks: 18 Done, 18 Partial, 40 Not started. BK-042-S1 is a separate completed subtask. P0 reconciliation is already complete. Correct stale statements only if the later documentation task explicitly authorizes them; do not reopen the audit or assign completed tasks as unfinished.
- D-032 is confirmed: branch roster profiles are independent, with no global linking/deduplication/cross-branch overlap check. Same-profile overlap checks remain. Do not ask the owner to repeat this decision.
- Receipt-driven development is clone-local off. Do not start/toggle review mode. Pre-existing private workbooks/notebook and `output/`/`tmp/` are user-owned and out of scope.

## Authorization and constraints

| Allowed in this documentation feature | Not authorized |
|---|---|
| Create this tracker and the named package-planning documents; record observed evidence and unresolved gates. | Implement P1–P12; edit runtime code, tests, migrations, configuration, or dependencies. |
| Keep the two audit-doc changes navigation-only. The human authorized the local commit sequence below on the current branch. | Inspect private data/workbooks, `.env`, credentials, or production data. |
| Describe safe local commands for future package owners without claiming they ran here. | Contact remotes/providers, use PostgreSQL, hosted CI, install packages, deploy, create PRs, or push. The local documentation commit sequence is authorized; it does not grant package implementation or external-system permission. |

No source, test, migration, or private workspace change is part of acceptance. Failed, skipped, unavailable, or gated evidence remains explicitly pending; it must not expand this documentation scope into implementation.

## Documentation surfaces

- Master: `docs/work-packages/README.md`.
- Packages: accepted cards exist for D1 (`P1-identity-and-transport.md`, `P2-member-read-contracts.md`, `P6-staff-schedules-and-attendance.md`, `P11-postgresql-and-quality-proof.md`), D2 (`P3-membership-payments-and-access.md`, `P4-shifts-and-cash.md`, `P5-published-catalog.md`, `P7-local-first-and-sync.md`), and D3 (`P8-commercial-operations.md`, `P9-external-payments.md`, `P10-notifications-reporting-and-gimi.md`, `P12-import-and-release-readiness.md`). Their local commit receipts are below.
- Existing navigation-only edits: `docs/backend-audit/roadmap.md` and `docs/backend-audit/README.md`; preserve their two-link-only scope.

## Primary ownership map to preserve

Assign exactly one primary package owner to each of the 58 unfinished main rows. Cross-package contributions do not transfer ledger ownership.

| Package | Primary scope |
|---|---|
| P1 | BK-010/011/012/058 — identity, transport, Admin recovery/session boundary |
| P2 | FE05 member-read contracts; no exclusive BK row |
| P3 | BK-023–030 — orders, payments, debt, membership/access and member check-in/sample flows |
| P4 | BK-021/022/035 — shift opening/closing evidence and cash reconciliation |
| P5 | BK-019 — member/catalog UI integration; name P2/P3 read and purchase contributions |
| P6 | BK-031/040 — staff schedule/attendance residuals (STAFF-1 only as a residual, STAFF-2, STAFF-3) |
| P7 | BK-014 and BK-062–074 — complete local-first integration and offline substrate sequence |
| P8 | BK-032/033/034/036/037/038/039/041 — stock/POS/supplement, rentals, returns/refunds, and expenses; split into bounded sublanes |
| P9 | BK-053–057 — provider payment adapters and Gimi renewal-link join; explicitly share BK-057’s Gimi permission/delivery dependency with P10 |
| P10 | BK-042–047 — reporting, Gimi permissions/domain-safe actions, and notification outbox/delivery |
| P11 | Cross-package PostgreSQL/quality proof only; no primary import BK row |
| P12 | BK-048–052/075/076 — import, operations, backup/restore and release readiness |

The plan must show completed BK-059/060 as prerequisites/evidence, not unfinished P1 scope; keep BK-042-S1 separate and done. BK-014 belongs to P7 even though its online read-contract contribution comes from P2. BK-029/030 belong to P3, not staff package P6. P11 does not own import implementation. BK-057 is a P9/P10 integration join but has one primary owner only.

## Required contents and acceptance

Every package card must provide objective, in/out scope, primary rows and contributing packages, exact existing source/test paths and narrowly proposed new paths, current-vs-proposed boundary, prerequisites/DAG edges, readiness class, business decisions/external permissions, data/security classification, acceptance and negative/fault scenarios, verification commands with safe synthetic-only environment, rollback/recovery boundary, shared-file conflicts, and a copy-paste handoff brief. Call out which outcomes are local proof versus PostgreSQL/hosted/provider/production proof.

The master guide must show the acyclic dependency graph, first-wave lanes (P1, P2 contract design, P6 local staff work, P11 local proof preparation only where independently safe), blockers that apply to only one slice, cross-package contracts, shared integration-file ownership, and a human-readable assignment protocol. Avoid a vague “backend first” chain or implying all four first-wave lanes are fully unblocked.

Shared files requiring a named integrator/serialized ownership include `api/app/main.py`, `api/app/db/models/__init__.py`, `api/migrations/versions/*`, frontend route registration, lockfiles, CI workflows, and the authoritative BK ledger. No package card may use a broad repository-root edit surface.

## Documentation tasks

All tasks are documentation deliverables; none checks off runtime P1–P12 work. Route was delegated direct for each multi-file analysis/documentation unit. Passive-doc TDD exception: no meaningful application RED/GREEN applies. Structural readback, exact task-count/ownership audit, dependency-cycle/readiness review, local Markdown links/anchors, proposed-vs-existing path labeling, safe-command review, and `git diff --check` were observed; independent Luna verification and parent content review are complete. Application tests/builds were not applicable and were not run. Local delivery is tracked separately from content acceptance.

- [x] **PKG-D1 — Coordination guide and P1/P2/P6/P11 cards.** **Route:** delegated direct; trigger: multi-file planning synthesis. **Accept:** clear first-wave DAG, bounded package cards, accurate residual scope and proof gates. Content is committed in groups 1, 2, and 7; exact identities and line counts are in the receipt table below. No implementation claim.
- [x] **PKG-D2 — P3/P4/P5/P7 cards.** **Route:** delegated direct; trigger: cross-domain contracts and multi-file planning. **Accept:** separate member/payment, shift, catalog, and offline sequences; explicit primary-owner/contributor split and no duplicate financial authority. Content is committed in groups 3 and 4; exact identities and line counts are in the receipt table below.
- [x] **PKG-D3 — P8/P9/P10/P12 cards.** **Route:** delegated direct; trigger: multiple domain/service lanes and external gates. **Accept:** stock/POS/supplement, rental, refund, expense, payment, outbox, reporting, Gimi, import, and release scopes are independently assignable with policy/permission boundaries. Content is committed in groups 5 and 6; exact identities and line counts are in the receipt table below.
- [x] **PKG-D4 — Coverage, readiness DAG, shared-file conflicts, paste-ready briefs, navigation and final readback.** **Route:** delegated direct; trigger: cross-document consistency and navigation edits. **Accept:** every unfinished main BK row has exactly one primary owner; none of the 18 Done rows or BK-042-S1 is assigned as unfinished; all 12 cards expose row-specific future path allowlists; contract registry and edge table resolve and are acyclic; crosswalks, gates and first-wave readiness are explicit; navigation changes are limited to approved links. Content and final validation are accepted; group 8 is observed and group 9 records the final receipt.

## Verification and delivery

- The initial **1,000–1,500-line forecast** is historical and superseded. The accepted content snapshot had **2,131 authored lines** (2,125 physical lines across 14 new feature documents plus six navigation-only additions). This is the pre-delivery-metadata baseline; recount actual authored additions/deletions from the resulting local commits. It is not a 400-line cap, and acceptance detail is not to be compressed.

- Delivery strategy: **ask-on-risk**; the human explicitly selected **feature-branch-chain for local documentation commits only** on `codex/backend-foundation`. This is not authorization to create the tracker/child PRs or to push. The selected local documentation chain is authorized and is being executed on this feature branch. Groups 1-8 are observed below; group 9 captures the final tracker receipt. Do not inherit another feature’s strategy.
- The 552-line master guide is a coherent local work unit and exceeds the 400-line advisory; recommend a future PR `size:exception` if it cannot be included without rewriting the validated guide. This recommendation is not approval. Early commit prefixes are link-incomplete because related package cards/master/navigation arrive in later groups; only the complete final snapshot can claim whole-plan link/graph validation. Group sizes are work-unit planning evidence, not proof of independently mergeable PRs.
- Before each group, the index was confirmed empty; only its exact paths were staged and inspected, with scoped `git diff --check` and complete-snapshot Markdown-link and package/task validation before closure. Do not run app suites solely for passive documentation. Existing test receipts are context, not fresh package verification.

### Authorized local commit sequence

The groups below are one bounded slicing pass. Initial counts are historical; actual authored additions plus deletions are recorded in the observed receipt table. Group 9 is the final bounded tracker receipt update; its own commit ID is retained in the parent mirror, not recursively added to itself.

| Order | Conventional commit message | Exact paths | Initial line count |
|---|---|---|---:|
| 1 | `docs(work-packages): add identity and member-read package cards` | `docs/work-packages/P1-identity-and-transport.md`; `docs/work-packages/P2-member-read-contracts.md` | 247 |
| 2 | `docs(work-packages): add staff and quality-proof package cards` | `docs/work-packages/P6-staff-schedules-and-attendance.md`; `docs/work-packages/P11-postgresql-and-quality-proof.md` | 236 |
| 3 | `docs(work-packages): add membership and shift work cards` | `docs/work-packages/P3-membership-payments-and-access.md`; `docs/work-packages/P4-shifts-and-cash.md` | 238 |
| 4 | `docs(work-packages): add catalog and offline work cards` | `docs/work-packages/P5-published-catalog.md`; `docs/work-packages/P7-local-first-and-sync.md` | 232 |
| 5 | `docs(work-packages): add commercial and provider work cards` | `docs/work-packages/P8-commercial-operations.md`; `docs/work-packages/P9-external-payments.md` | 275 |
| 6 | `docs(work-packages): add service and release-readiness cards` | `docs/work-packages/P10-notifications-reporting-and-gimi.md`; `docs/work-packages/P12-import-and-release-readiness.md` | 252 |
| 7 | `docs(work-packages): add coordination guide and dependency graph` | `docs/work-packages/README.md` | 552 |
| 8 | `docs(work-packages): record plan delivery and audit navigation` | `odd/tasks/parallel-work-packages.md`; `docs/backend-audit/README.md`; `docs/backend-audit/roadmap.md` | 99 |
| 9 | `docs(work-packages): capture final plan receipts` | `odd/tasks/parallel-work-packages.md` only | Receipt-only; 19 authored changed lines |

### Observed work-unit receipts

| Group | Task coverage | Commit | Tree | Authored lines (additions + deletions) |
|---:|---|---|---|---:|
| 1 | PKG-D1: P1/P2 cards | `5e83d85285e2fe564acc3e6e6655999210e221ea` | `6193d52a900022d33a8825125a7465a75d093936` | 247 |
| 2 | PKG-D1: P6/P11 cards | `378cf3f1b48745d4f174d2dda033b08f364b4bd8` | `f296af9598b072b8d012252bb4b619c92c6d1af8` | 236 |
| 3 | PKG-D2: P3/P4 cards | `dc27bc127d46291c9afb791addce780ef498d5bb` | `ae49bb92500d89d58fb4636e11d79ec935dfc05c` | 238 |
| 4 | PKG-D2: P5/P7 cards | `bca734a15154506ab4313c29597ef21884f876da` | `7e24e23fe715bb96fabdb98f13a5ca1b1f7dcbb1` | 232 |
| 5 | PKG-D3: P8/P9 cards | `6abc4fa478c6e551c8fda45e5862a84c208a27fd` | `377eac94a48a8ff408eebc359b53d90ceda7521d` | 275 |
| 6 | PKG-D3: P10/P12 cards | `02d13dc3970229860d16104d4176adb757614cc7` | `8084f80a709ee5ff363929c9d280f69b73a934c1` | 252 |
| 7 | PKG-D1: master guide and graph | `9e30760977cd8d47f90da1356fa741ecb89e7f0c` | `b68c20fee932c671ebc9135ee559f951ce958b8f` | 552 |
| 8 | PKG-D4: tracker and navigation links | `88f25550c784a70fbe04c0794c3fedc1b5252eb1` | `78cee2017b67e921356c832b3cc70d93298d0c80` | 132 |

Groups 1-8 total 2,164 authored lines; group 9 adds 19, for 2,183 authored changed lines across all local commits. The group 9 identity remains in the parent mirror to avoid a self-referential receipt.

Groups 1-8 cover the 14 new feature documents and two existing navigation documents exactly once; group 9 updates the tracker only. D1-D4 are checked after their content, navigation and final structural evidence were observed. Group 9 records group 8's identity and final task/check evidence; its own ID is returned to the parent for the mirror. No source/runtime paths are authorized by this sequence.

## Progress and next step

PKG-D1/D2/D3 content groups and the D4 coordination/navigation group are committed and observed in the receipts below. D4 includes all twelve path tables, the clickable package index, FE03–FE12/STAFF/H/E crosswalks, D-013–D-033 gate ownership, contract/acceptance nodes, the acyclic subdelivery graph, first-wave/2–4-person assignment examples and copyable briefs. The tracker/master separate P8.1/P8.2 contract and implementation nodes. The two existing audit-doc edits are navigation-only. All four documentation tasks are content-complete and checked; no package implementation has started or been authorized.

Final structural proof after the approved corrections and navigation commit: independent review resolved four findings and targeted revalidation passed; 99 local Markdown links/anchors resolve; 121 exact existing candidate paths exist and 100 proposed paths remain absent; 58 unfinished BK rows have unique primary owners with no Done rows assigned; all 97 defined graph nodes resolve across 220 prerequisite edges in topological order; scoped `git diff --check` and the untracked-document whitespace scan pass. Parent content review is accepted. The 2,131 authored-line total is the accepted pre-metadata snapshot; the initial 1,000–1,500 forecast is historical. Groups 1–8 total 2,164 authored additions; group 9 records the final delta after it is committed. Source/runtime files were not edited and application suites/builds were not run. RDD is off; the metadata risk assessment was high because of the P3 payments filename, but no native review/approval was started. P1–P12 implementation remains separately unauthorized.

## Relevant files

- `odd/tasks/backend-implementation.md` — authoritative main BK ledger; recompute rather than copying dated counts.
- `docs/backend-plan/02-business-rules-and-decisions.md` — decision register, including confirmed D-032/D-033 and remaining gates.
- `docs/backend-plan/04-implementation-phases.md` — existing task acceptance/dependency cards; some D-032 wording is historical/stale and must not override the confirmed decision.
- `docs/backend-audit/frontend-contract-gaps.md` and `docs/backend-audit/roadmap.md` — frontend integration gaps and current route-to-completion.
- `docs/backend-audit/post-audit-reconciliation.md` — verified source-baseline test evidence and explicit limits.
