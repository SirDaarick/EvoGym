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
- Projection commit: `704856c`. No pushes or PRs created. Planned slices: projection and tests; integrated finance tabs; export/responsive validation.
- Running authored line count: 423 (346 source/tests + 77 tracking).
- Engram mirror topic: `odd/finance-tabs/tasks`.

## Tasks
- [x] F1 — Establish the canonical financial projection and deterministic tests.
  - Route: delegated direct; preparation and non-trivial implementation require a writer.
  - Acceptance: all supported sources reconcile; refunds, pending transfers, extras, opening float exclusion, date boundaries, missing data and zero comparisons are explicit.
  - Checks: new selector tests and existing expense-selector regression tests; observed RED → GREEN where meaningful.
- [x] F2 — Integrate the shared period toolbar and accessible four-tab navigation.
  - Route: delegated direct; multi-file React implementation.
  - Acceptance: existing route works, nav label becomes Finanzas, URL/state preservation and keyboard operation work without changing Resumen or other destinations.
  - Checks: focused shell/navigation/period tests.
- [x] F3 — Implement Balance and Cobros using the shared projection and purposeful charts.
  - Route: delegated direct; multi-file views and visualization.
  - Acceptance: amounts, chart bins and unpaginated filtered rows reconcile; pending money remains separate; exact values are available without hover.
  - Checks: view/filter/chart data tests and browser inspection.
- [x] F4 — Reorganize Gastos and Presupuesto and scope active-tab export.
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
F1–F4 implemented and independently verified. F5 is partial: functional suites and browser layout/keyboard checks are observed; typecheck/build remain blocked by the baseline reception error, and visual PDF, real screen-reader and zoom/reduced-motion interaction checks remain pending. No unrelated repair is authorized by this feature. Read back this file and its full Engram mirror before resuming.

## Work-unit evidence
### F1 — Canonical projection
- New selector and tests: 346 authored source/test lines. This coherent calculation-and-test unit is kept together; the review-size heuristic is not a reason to remove coverage.
- Writer observed RED for missing selector, then targeted regressions for invalid values, negative extras and future dates; GREEN: 2 files / 26 tests.
- Independent verifier confirmed the three scoped corrections; parent spot check: 1 file / 9 tests passed.
- Typecheck still fails only at the documented pre-existing reception `Tone` error.
- Native read-only assessment was high/unassessable because of pre-existing untracked inventory; independent verification used. RDD remains off/unmanaged; no review lifecycle invoked.
- Rollback boundary: the two new finance selector files; no runtime UI connected yet, so browser interaction is N/A for this unit.
- Commit identity: `704856c` — `feat(finance): add reconciled monetary projection`.

### F2–F4 — Integrated tabbed finance views
- GPT-6 Luna writer created readable shell, toolbar, Balance/Cobros/Gastos/Presupuesto views, TanStack Charts definitions and TanStack Table rendering; existing expense route and budget controls retained.
- A partial draft lacking actual TanStack charts/component separation was not accepted; the single active writer completed the agreed requirements before independent review.
- Observed RED for interaction/filter behavior and mixed-sign extras/chart-placement regressions. Final focused suite: 6 files / 47 tests passed. Companion suite: 4 files / 43 tests passed.
- Independent final suite: 58 files / 460 tests passed. Typecheck and build fail only at the documented baseline reception `Tone` mismatch.
- Independent review caught mixed-sign extras gross-flow divergence; KPIs now sum the same signed bins as the chart. Source ranking moved to filtered Cobros; Balance retains the temporal chart only.
- Parent browser check found a mobile CSS specificity regression and a chart occupying only one desktop grid track. Two mechanical scoped CSS corrections were applied and observed: 320px KPIs are one column (241px cards), desktop chart fills its 1469px container.
- Parent spot test after mobile correction: BalanceView test 1/1 passed; final CSS whitespace check passed. No subsequent functional source changes.
- Browser observations: Balance had no root overflow at 320/390/768/1024/1440px; all four tabs had root scroll width equal to client width at 320px. Cobros filter changed totals and rows together; manual keyboard focus/activation worked; light/dark renderings inspected; viewport reset afterward.
- Print markup uses active-tab all-filtered data, not the current pagination page. Automated/static scope checks pass; visual print/PDF rendering remains unverified.
- Rollback boundary: navigation label, ExpenseReport shell/CSS/tests and new owner/finance files; the independent F1 selector can remain.
- UI scope is a cohesive replacement of a large legacy screen and its styles, not a 400-line target; actual size is recorded from staged/committed diff. No whitespace/code compression used to meet a line budget.
- Native read-only risk assessment remains high/unassessable due pre-existing untracked inventory; RDD remains disabled/unmanaged. No native review lifecycle, remote publication or PR.
- Commit identity: pending parent commit.

### F5 — Remaining verification
- [x] Independent focused and full functional suites.
- [x] Parent browser review and scoped CSS corrections; explicit file-only staging.
- [ ] Typecheck and build: blocked by pre-existing `DevolucionesModal.tsx:402` error, outside scope.
- [ ] Visual PDF/print pagination and real screen-reader verification.
- [ ] Full 200%/400% zoom and reduced-motion interaction matrix; CSS support exists, no compliance claim made.
