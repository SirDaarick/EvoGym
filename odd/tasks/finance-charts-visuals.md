# Modernize Finance Visualizations with TanStack Charts

## Objective
Upgrade the visual representation in the Finanzas module (`/owner/expenses`), replacing the monoculture of plain bar charts and text-only breakdowns with purpose-built TanStack Charts:
1. Reconciliation Waterfall chart for period reconciliation in BalanceView.
2. Period Comparison visual (comparing previous vs current period metrics) in BalanceView.
3. Part-to-whole composition donut chart for collections by source family in CollectionsView.
4. Direct data labels on charts (using TanStack Charts `text` mark) and removal of redundant collapsible `<details>` accordions (preserving `sr-only` accessibility).
5. Replacement of stretched-out `<dl>` desgloses in Balance and Budget views with compact, structured 2-column TanStack Tables (`SimpleFinanceTable`).
6. Cohesive styling, keyboard accessibility, dark mode support, and comprehensive unit tests.

## Allowed edit surfaces
frontend/src/features/owner/finance/FinanceCharts.tsx
frontend/src/features/owner/finance/BalanceView.tsx
frontend/src/features/owner/finance/BudgetView.tsx
frontend/src/features/owner/finance/CollectionsView.tsx
frontend/src/features/owner/finance/FinanceTable.tsx
frontend/src/features/owner/ExpenseReport.css
frontend/src/features/owner/finance/BalanceView.test.tsx
frontend/src/features/owner/finance/FinanceTabs.test.tsx
odd/tasks/finance-charts-visuals.md

## Constraints
- Do not touch existing domain models, monetary projection math, or unrelated components.
- Centavos remain integers; formatted using `formatMoney`.
- All charts must support keyboard navigation (`keyboard: true`), aria labels, and responsive layout.
- Maintain existing tests passing and add new assertions for the new visual elements.
- Never add AI attribution or Co-Authored-By to commits.

## Tasks
- [x] V1: Implement `FinanceReconciliationWaterfall` using TanStack Charts `waterfall` + `barY` and integrate into `BalanceView.tsx`.
- [x] V2: Implement `FinancePeriodComparisonChart` comparing previous vs current period (Inflows, Outflows, Balance) and integrate into `BalanceView.tsx`.
- [x] V3: Implement `FinanceSourcesDonutChart` using TanStack Charts `polar` + `radialArc(pie(...))` and integrate into `CollectionsView.tsx`.
- [x] V4: Update `ExpenseReport.css` with responsive layout, legend styles, and dark-theme variables.
- [x] V5: Update unit tests in `BalanceView.test.tsx` and `FinanceTabs.test.tsx` to verify new charts and verify regression suite.
- [x] V6: Add direct data labels (`text` mark) to `FinanceReconciliationWaterfall` and `FinancePeriodComparisonChart` so key values are read on the chart itself.
- [x] V7: Remove redundant `<details>` buttons from `FinanceCharts.tsx`, keeping accessible `<section role="region">` in the DOM with `.finance-sr-only`.
- [x] V8: Implement `SimpleFinanceTable` in `FinanceTable.tsx` using `@tanstack/react-table` with exactly 2 columns (Concepto e Importe).
- [x] V9: Replace stretched `<dl className="finance-breakdown">` in `BalanceView.tsx` and `BudgetView.tsx` with `SimpleFinanceTable`, wrapped in `.finance-constrained-table` so labels and costs are visually close.
- [x] V10: Verify all tests in `src/features/owner` pass.
