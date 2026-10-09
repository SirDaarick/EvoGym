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
- RDD: OFF (clone_local) after explicit human opt-out; global preference remains ON. Resume ordinary functional checks and independent verification. No native review retries, START, re-enabling or native approval claims.
- Last reviewed boundary: c5fe08e3490b5eb05e38988fd95f17503c1480db.

## Tasks
- [x] T01 Profile entry, Reception Home route, compact contextual owner questions.
- [x] T02 Denomination-assisted cash close, safe totals, stale review and legacy compatibility.
- [x] T03 Global member lookup and explicit illustrative membership scenarios.
- [x] T04 Product grid and one atomic multi-item cart transaction with honest feedback.
- [x] T05 Attendance sessions, orange calendar, unknown-duration auto-close and demo controls.
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
T01 implemented: root Admin/Reception profile selection without credentials, Home with fixture product overview and existing Sales link, and reusable collapsed contextual questions. Cart, global search and attendance remain future units. Parent verified root cards → Reception Home → Shifts in the browser; denomination mode with one $500 bill showed a $500 total. Partial demo remains open in tab 5. Full suite/build and full cross-flow browser proof remain pending.

T01 test-first evidence: `npm test -- src/app/App.test.tsx src/features/reception/ReceptionHome.test.tsx src/features/demo/OwnerQuestions.test.tsx` initially failed (3 App tests; 2 missing-module suites). After implementation and a precise text-query correction it passed: 3 files, 10 tests. Refactor/readback retained existing shared-role routing and reusable disclosure; no additional abstraction needed. `npm run typecheck` and `git diff --check` passed. Runtime harness: RTL profile → Home → change profile → Admin; full browser proof pending T06.

T02 implemented a visibly illustrative Q-10 denomination catalog, exclusive manual/count modes, safe integer centavo totals, validated cloned close snapshots and legacy total-only rendering. Empty count fields explicitly mean zero. Count changes require re-review; changed financial revision still refuses stale confirmation. `npm test -- src/demo/cashDenominations.test.ts src/features/shifts/ShiftFlow.test.tsx src/features/sales/operations.test.ts`: RED exit 1 (3 UI failures and one missing-module suite), GREEN exit 0 (3 files / 20 tests); `npm run typecheck` and `git diff --check` passed. Refactor/readback centralized quantity/total validation; targeted RTL close, invalid input, edit, stale revision and legacy paths passed. Browser/full checks remain pending T06.

T03 adds persistent role-screen combobox lookup with active/inactive/unknown groups, arrow/Enter/Escape operation, reset/route/profile stale-suggestion clearing, and four explicit fictitious scenarios separate from legacy membership dates. Detail shows unknown/demo/provisional status and expired renewal notice, without attendance actions or payment-derived eligibility. Q-01 remains provisional; Q-04/Q-05 remain open. `npm test -- src/demo/memberStatus.test.ts src/features/members/Members.test.tsx src/app/App.test.tsx`: RED exit 1 (5 UI failures plus missing resolver suite), GREEN/readback 3 files / 18 tests passed; `npm run typecheck` and `git diff --check` passed. One test query was scoped to its listbox rather than unrelated native details groups. Refactor/readback reused the pure classifier in search/detail. Full suite/build pending T06.

T04 adds three illustrative product cards with local SVG placeholders, selection and quantity/remove controls, one quoted multi-line cart, explicit payment review and feedback. One pure transaction aggregates products and validates all quantities/prices/stock/IDs before any writes; confirmed success clears the cart, errors/pending preserve it. Pending transfer uses grouped line records tagged with cartId only for the demo (Q-15 open), without ledger/stock effects or confirmation functionality. Q-11/Q-12/Q-14 remain open; current navigation loss is disclosed. Exact `npm test -- src/features/sales/operations.test.ts src/features/reception/ReceptionHome.test.tsx src/features/owner/Owner.test.tsx`: RED 8 failed/12 passed (7 new cart/UI failures plus pre-existing T01 Owner fallback expectation); GREEN/readback 3 files/21 tests passed. Authorized Owner expectation corrected to Home without weakening role restrictions. `npm run typecheck` and `git diff --check` passed. Pure quote logic shared between UI and atomic registration; no sequential registerSale calls. Full suite/build/browser closure pending T06.

T05 implements local demo entry/observed exit, one open visit, separate automatic closure timestamps with unknown duration, controlled clock (advance 30 minutes, 22:00 close, next day), and explicit Q-01/Q-03 provisional toggles. Original/unknown/expired scenarios cannot create new entries; changing eligibility never traps exit. The demo uses proposed America/Mexico_City/UTC-06 for its fixed 2026 scenarios (Q-02 pending); no real clock, persistent scheduler or offline guarantee. Two seeded visits belong only to fictitious Demo Activa and are labeled illustrative. An 84-day orange keyboard-inspectable calendar shows visit counts, measured time and unknown durations separately. Exact `npm test -- src/demo/attendanceOperations.test.ts src/demo/memberStatus.test.ts src/features/attendance/AttendanceCalendar.test.tsx src/features/members/Members.test.tsx`: RED exit 1 (2 missing suites + one UI failure), GREEN/readback 4 files/15 tests passed; `npm run typecheck` and `git diff --check` passed. Refactor/readback shares day/boundary/duration helpers. UTC-local day rollover, prior-day overdue visits, invalid/backward clocks, repeat/expiry toggles, unrestricted exit and reset were checked. Full suite/build/browser closure pending T06.

| Task | Route | Commit | Checks | Native review assessment |
|---|---|---|---|---|
| T01 | delegated | a7eafdd44e57e68b0cb4ddffbf6970d495b32ff1 | 10 focused tests, typecheck, diff check passed | medium, 232 changed lines, under_budget; no START |
| T02 | delegated | d1261e09a17ec7d7fca7d7eee89cd1db1adfab45 | 20 focused tests, typecheck, diff check passed; parent repeated exact focused tests, 20 passed | combined T01+T02 medium, 401 lines; review_due=true, slice_budget_reached; independent review pending |
| T03 | delegated | 4d70ecbc7b66a275dbbf565f15c25b6d6066b731 | 18 focused tests, typecheck, diff check passed | medium/192 lines informational only; RDD disabled/unmanaged |
| T04 | delegated | 3fd2a07900cb70322fc819c6deb19a6f4c3d8628 | 21 focused tests, typecheck, diff check passed | medium/234 lines informational only; RDD disabled/unmanaged |
| T05 | delegated | SHA recorded after commit | 15 focused tests, typecheck, diff check passed | RDD disabled/unmanaged; parent ordinary verification pending |
| T06 | delegated | pending | pending | pending |

## Recovery
Engram mirror: odd/reception-daily-operations/tasks. SDD dependencies: proposal25, questions45, spec47, design49, tasks51. Reconcile this file and full mirror before resuming. Keep failed/skipped/pending checks explicit.

## Next step
Status: resumed after explicit human opt-out of RDD. Historical preflight required an unestablished external collection input shape; no START, freeze, lineage or consent occurred. Parent disabled RDD at clone scope at the human's request; do not retry that review or re-enable. Parent verifies T05 under ordinary checks before T06.

Pre-existing unrelated untracked files were excluded in the successful assessment and remain untouched. Last reviewed boundary stays the original base. T06 remains; no full suite/build ran. Work remains local feature-branch-chain, with no PR, push or merge. T05 rollback removes demo attendance models/fixtures/helpers/calendar/member controls and tests/styles, preserving T01–T04. Production policy approval is not implied.
