# Expand expense reporting into tabbed operational finance

## Objective
Replace the existing Gastos destination with Finanzas and four flat tabs: Balance, Cobros, Gastos, and Presupuesto. Preserve the business-wide Resumen and the existing sidebar destination count.

## Problem and rationale
Existing expense reporting mixes recorded cash outflows with configured costs. Financial analysis needs an explicit, traceable calculation contract and progressive detail rather than additional navigation or decorative indicators.

## Authorized scope
- Preserve `/owner/expenses` and existing lazy route integration.
- Reuse existing React primitives, period controls, money/date helpers, TanStack Table, and TanStack Charts.
- Preserve the existing BentoBox/claymorphism identity and support mobile, keyboard, light/dark themes, and reduced motion.
- Separate confirmed collections, refunds, extras, recorded cash expenses, pending transfers, and budget assumptions.
- Export the active tab and current filters, not hidden panels.
- Use GPT-6 Luna for delegated execution; parent reviews outcomes.

## Constraints
- No unrelated edits, dependency upgrades, skill installations, remote operations, publication, or PR creation.
- Existing user changes in models, returns, shared UI/styles, reception, and other features must remain untouched.
- No formal net-profit, bank-availability, tax, legal-debt, or complete balance-sheet claims.
- Preserve original positive ledger events; refunds belong to their own event date.
- Keep centavos as integers. Do not count ledger and source records twice.
- Do not subtract configured budgets as paid expenses.
- RDD is off by clone-local preference; do not start native reviews or change the switch.

## Recovery and delivery
- Starting branch: `feat/mobile-contextual-panels`.
- Starting HEAD: `580fbdd`.
- Baseline includes 55 dirty paths; do not stage or commit pre-existing work.
- Forecast: approximately 700–1,000 authored changed lines, excluding generated files; advisory estimate, not a code-size cap.
- Delivery strategy: `ask-on-risk`.
- Chain strategy: `feature-branch-chain`, explicitly selected by the user (option 1).
- Feature branch: `codex/finance-tabs`, created from `580fbdd` with existing working changes preserved.
- No commits, pushes, or PRs created yet. Planned slices: projection and tests; integrated finance tabs; export/responsive validation.
- Running authored line count: 0.
- Engram mirror topic: `odd/finance-tabs/tasks`.

## Tasks
- [x] F1 — Establish the canonical financial projection and deterministic tests.
  - Route: delegated direct; preparation and non-trivial implementation require a writer.
  - Acceptance: all supported sources reconcile; refunds, pending transfers, extras, opening float exclusion, date boundaries, missing data and zero comparisons are explicit.
  - Checks: new selector tests and existing expense-selector regression tests; observed RED → GREEN where meaningful.
- [ ] F2 — Integrate the shared period toolbar and accessible four-tab navigation.
  - Route: delegated direct; multi-file React implementation.
  - Acceptance: existing route works, nav label becomes Finanzas, URL/state preservation and keyboard operation work without changing Resumen or other destinations.
  - Checks: focused shell/navigation/period tests.
- [ ] F3 — Implement Balance and Cobros using the shared projection and purposeful charts.
  - Route: delegated direct; multi-file views and visualization.
  - Acceptance: amounts, chart bins and unpaginated filtered rows reconcile; pending money remains separate; exact values are available without hover.
  - Checks: view/filter/chart data tests and browser inspection.
- [ ] F4 — Reorganize Gastos and Presupuesto and scope active-tab export.
  - Route: delegated direct; coordinated existing-feature refactor.
  - Acceptance: existing expense and fixed-cost controls retained; actuals and assumptions separated; no unsupported audit wording; printed content matches active scope.
  - Checks: expense/budget/export regression tests.
- [ ] F5 — Verify responsive UX, accessibility, regressions and delivery boundaries.
  - Route: delegated verification plus parent structural review and one command spot check.
  - Acceptance: mobile layouts, light/dark, keyboard, zoom/reduced motion and print checked; no unrelated user bytes staged; failures and unavailable checks reported honestly.
  - Checks: focused/full tests, typecheck, build, browser matrix and native read-only risk assessment. RDD stays disabled/unmanaged.

## Baseline verification
Observed by delegated GPT-6 Luna worker before source changes:
- `npm --prefix frontend test -- src/demo/expenseReportSelector.test.ts src/features/owner/ExpenseReport.test.tsx src/demo/shiftDashboard.test.ts src/demo/returnOperations.test.ts src/features/owner/Overview.test.tsx src/app/App.test.tsx`: 6 files and 74 tests passed.
- `npm --prefix frontend run typecheck`: failed at `frontend/src/features/reception/DevolucionesModal.tsx:402`; `"info"` is not assignable to shared `Tone`. This is pre-existing and outside the finance edit surface.
- Full suite/build/browser matrix: not run yet.

## Progress and next step
F1 implemented and independently verified. Delegate the integrated finance shell/views (F2–F4) next, preserving the current route and existing fixed-cost controls. Read back this file and its full Engram mirror before resuming.

## Work-unit evidence
### F1 — Canonical projection
- New selector and tests: 346 authored source/test lines. This coherent calculation-and-test unit is kept together; the review-size heuristic is not a reason to remove coverage.
- Writer observed RED for missing selector, then targeted regressions for invalid values, negative extras and future dates; GREEN: 2 files / 26 tests.
- Independent verifier confirmed the three scoped corrections; parent spot check: 1 file / 9 tests passed.
- Typecheck still fails only at the documented pre-existing reception `Tone` error.
- Native read-only assessment was high/unassessable because of pre-existing untracked inventory; independent verification used. RDD remains off/unmanaged; no review lifecycle invoked.
- Rollback boundary: the two new finance selector files; no runtime UI connected yet, so browser interaction is N/A for this unit.
- Commit identity: pending parent commit.
