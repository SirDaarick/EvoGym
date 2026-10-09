# Reception daily operations — owner discussion demo

## Objective
Build an interactive, local EvoGym prototype so the owner can discuss reception workflows through the interface rather than a long document.

## Scope and constraints
- Implement only local demonstration behavior; no authentication, backend, real access authorization, production scheduler, remote publication, or merge.
- Admin and Reception profile cards enter directly without credentials. Preserve OWNER as the internal role and existing deep links.
- Show provisional choices and question IDs near their workflows; avoid a wall of questions.
- Expired illustrative memberships require renewal; grace remains deferred. Expiry-day access and repeat daily visits remain provisional, adjustable demo choices.
- Missing checkout closes at 22:00, keeps attendance, and has unknown duration. Never turn automatic closure into an observed departure.
- Product images, denomination catalog, membership eligibility and timezone are explicitly illustrative when unconfirmed.
- Preserve atomic stock/ledger behavior, pending-transfer semantics, stale close review guards, notebook/Excel notices, legacy cash records and existing Owner/inventory screens.
- Existing untracked .atl/ and odd/tasks/stitch-ui-prototype.md are outside this feature; do not stage them.

## Authorization and delivery
- User authorized implementation and approved a separate feature branch with small work-unit changes, no publishing or merge.
- Branch: codex/reception-daily-operations.
- Base: c5fe08e3490b5eb05e38988fd95f17503c1480db.
- Delivery strategy: ask-on-risk; resolved chain strategy: feature-branch-chain. Local commits define future review slices; no PRs authorized.
- Forecast: 500–700 authored additions+deletions from SDD, subject to revision after real implementation. 400 lines is a slicing heuristic, not a code-quality limit.
- RDD: on (global), verified outside sandbox. Parent runs native due assessment after each committed work unit and follows provider-issued transitions/consent. Never change review mode.
- Last reviewed boundary: c5fe08e3490b5eb05e38988fd95f17503c1480db.

## Tasks
- [x] T01 Profile entry, Reception Home route, compact contextual owner questions.
- [x] T02 Denomination-assisted cash close, safe totals, stale review and legacy compatibility.
- [ ] T03 Global member lookup and explicit illustrative membership scenarios.
- [ ] T04 Product grid and one atomic multi-item cart transaction with honest feedback.
- [ ] T05 Attendance sessions, orange calendar, unknown-duration auto-close and demo controls.
- [ ] T06 Cross-flow verification, responsive/keyboard checks and concise demo notes.

## Routing
All tasks: delegated direct. Trigger: multi-file non-trivial writes and preparation for writing. One writer at a time, exact allowed surfaces per task. Independent verification follows native RDD state and risk assessment; no parallel writers.

## Acceptance and checks
- Deterministic behavior changes use observed RED → GREEN → REFACTOR with Vitest, matching existing tests and UI language (Spanish).
- Each work unit includes its tests and necessary docs, with a Conventional Commit and no AI attribution.
- Run task-specific tests and npm run typecheck per unit; npm test, npm run typecheck and npm run build at feature closure.
- Browser proof: profile → Home → cart sale → member entry/exit → close shift; keyboard and narrow viewport. Do not infer browser reachability from a Vite ready message.
- Demo policy defaults are visibly tentative, not approved business rules. No realistic duration is invented for missing checkout.

## Progress and proof
T01 implemented: root Admin/Reception profile selection without credentials, Home with fixture product overview and existing Sales link, and reusable collapsed contextual questions. Cart, global search and attendance remain future units. No browser/build proof yet.

T01 test-first evidence: `npm test -- src/app/App.test.tsx src/features/reception/ReceptionHome.test.tsx src/features/demo/OwnerQuestions.test.tsx` initially failed (3 App tests; 2 missing-module suites). After implementation and a precise text-query correction it passed: 3 files, 10 tests. Refactor/readback retained existing shared-role routing and reusable disclosure; no additional abstraction needed. `npm run typecheck` and `git diff --check` passed. Runtime harness: RTL profile → Home → change profile → Admin; full browser proof pending T06.

T02 implemented a visibly illustrative Q-10 denomination catalog, exclusive manual/count modes, safe integer centavo totals, validated cloned close snapshots and legacy total-only rendering. Empty count fields explicitly mean zero. Count changes require re-review; changed financial revision still refuses stale confirmation. `npm test -- src/demo/cashDenominations.test.ts src/features/shifts/ShiftFlow.test.tsx src/features/sales/operations.test.ts`: RED exit 1 (3 UI failures and one missing-module suite), GREEN exit 0 (3 files / 20 tests); `npm run typecheck` and `git diff --check` passed. Refactor/readback centralized quantity/total validation; targeted RTL close, invalid input, edit, stale revision and legacy paths passed. Browser/full checks remain pending T06.

| Task | Route | Commit | Checks | Native review assessment |
|---|---|---|---|---|
| T01 | delegated | a7eafdd44e57e68b0cb4ddffbf6970d495b32ff1 | 10 focused tests, typecheck, diff check passed | medium, 232 changed lines, under_budget; no START |
| T02 | delegated | SHA recorded after commit | 20 focused tests, typecheck, diff check passed | parent assessment pending |
| T03 | delegated | pending | pending | pending |
| T04 | delegated | pending | pending | pending |
| T05 | delegated | pending | pending | pending |
| T06 | delegated | pending | pending | pending |

## Recovery
Engram mirror: odd/reception-daily-operations/tasks. SDD dependencies: proposal25, questions45, spec47, design49, tasks51. Reconcile this file and full mirror before resuming. Keep failed/skipped/pending checks explicit.

## Next step
Parent assesses T02 before T03. Last reviewed boundary remains the original base; T01 is under_budget. T02 rollback removes denomination helper/count UI/optional snapshots and its tests/styles, preserving manual close and all T01 work.
