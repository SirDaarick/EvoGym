# Dynamic SSOT Expense Report and Export (Reporte y Exportación de Gastos)

Owner-facing financial reporting screen integrating reactive Single Source of Truth (SSOT) fixed OPEX ($164,000 MXN/month default fixed OPEX, 9-member dynamic staff payroll schedule, and $8,200 MXN/day break-even target) alongside shift variable expenses, live fixed costs adjustment modal, TanStack Charts cost block comparison, TanStack Table itemization, and dedicated printable PDF export.

## Quick path

1. Run focused unit and integration test suite: `npx vitest run src/demo/fixedCostsStore.test.ts src/demo/expenseReportSelector.test.ts src/features/owner/ExpenseReport.test.tsx`
2. Open `/owner/expenses` and test toggling subviews between "Gastos Variables y Caja Chica" and "Estructura Fija y Nómina".
3. Click "Ajustar costos fijos" to edit monthly commitments (Renta, Agua, Luz, Internet, Basura) and verify immediate KPI reactivity.
4. Click "Gestionar equipo y sueldos →" to navigate directly to `/owner/staff`.
5. Click "Exportar reporte (PDF)" to trigger `window.print()` and verify document print isolation.

## Details

| Topic | Decision |
|---|---|
| Single Source of Truth (SSOT) Staff | Staff payroll dynamically sums active staff salaries from `staffStore.ts` (9 Excel employees: Emigdio $14k, Sheila $10k, Mikel $10k, Charly $10k, Tadeo $10k, Silvia $8k, Alan $8k, Maho $6k, Iñaky $4k = $80,000 MXN/mes). Admin profile retained as OWNER ($0 payroll line). |
| Dynamic Fixed Costs Store | Reactive store in `src/demo/fixedCostsStore.ts` with `getFixedCosts()`, `saveFixedCosts()`, `subscribeFixedCosts()`, `useFixedCosts()`, and `resetFixedCosts()`. Persists to `localStorage` / `sessionStorage` with memory fallback. Defaults: Renta ($66,000), Agua ($9,000), Luz ($8,000), Internet ($800), Basura ($200). |
| Dynamic Selector Integration | `computeFixedCostsSummary` and `getExpenseReport` connect `fixedCostsStore` and `staffStore`. Total fixed monthly OPEX ($164,000 default), daily break-even ($8,200/día), per-shift break-even ($4,100/turno), and weekly break-even ($41,000/semana) recalculate immediately upon changes. |
| Fixed Costs Modal Adjustment | Clean, accessible dialog in "Estructura Fija y Nómina" allowing live edits to Renta, Agua, Luz, Internet, and Basura with positive numeric validation and immediate re-render across Bento KPIs, chart, and cards. |
| Staff Management Cross-Link | Direct action button linking to `/owner/staff` ("Gestionar equipo y sueldos →") so owners can seamlessly update compensation or personnel. |
| Excel Variable Categories | Categorization into `Consumibles`, `Limpieza`, `Mantenimiento: Piso`, `Mantenimiento: Peso`, `Mantenimiento: Cardio`, `Mantenimiento: Box`, `Servicios`, and `General`. |
| Domain Boundary | Pure selector strictly processes `state.expenses` for variable outflows. Never mixes receptionist float funds (`state.extras`), inventory waste, or stock restocks. |
| Time Anchoring & Proration | Periods `'week'`, `'month'`, `'all'`, and `'custom'` are anchored to `state.demoClock` (America/Mexico_City). Fixed costs are prorated to compute total committed budget per period. |
| Bento KPIs | 1. Punto de equilibrio: $8,200 MXN/día (Fijo mensual: $164,000 MXN). 2. Gastos variables del período (Caja chica / compras). 3. Total comprometido (Fijo prorrateado + Variables). |
| Visual Organizer (TanStack Charts) | Bar chart comparing major cost blocks: Nómina, Renta, Servicios, Variables/Caja chica. |
| Two Tabbed Sub-views | **Pestaña 1**: Gastos Variables y Caja Chica (Period selector, quick search, category pills `Todas`, `Consumibles`, `Limpieza`, `Mantenimiento`, `Servicios`, sortable TanStack Table). **Pestaña 2**: Estructura Fija y Nómina (Action toolbar with modal edit and staff link, cards for Renta, Servicios breakdown, Nómina; dynamic payroll table). |
| Printable PDF Export | Dedicated "Exportar reporte (PDF)" button triggering `window.print()` with `@media print` rules displaying official logo, title, break-even target, fixed structure, payroll schedule, and variable audit table while hiding shell chrome. |

## Acceptance Checklist

- [x] Unit tests for `fixedCostsStore` defined in `src/demo/fixedCostsStore.test.ts` and passing (5 tests).
- [x] Initial staff updated in `src/features/staff/staffStore.ts` to include the 9 real gym employees from Excel while keeping Admin as OWNER.
- [x] Dynamic fixed costs store implemented in `src/demo/fixedCostsStore.ts` with reactive subscriptions and storage persistence.
- [x] Selector `src/demo/expenseReportSelector.ts` connects `fixedCostsStore` and `staffStore` via `computeFixedCostsSummary`.
- [x] Break-even daily ($8,200/día), per-shift ($4,100/turno), and monthly OPEX ($164,000/mes) update automatically whenever fixed costs or staff salaries change.
- [x] Selector tests in `src/demo/expenseReportSelector.test.ts` passing (17 tests).
- [x] "Ajustar costos fijos" button and modal dialog with form validation implemented in `src/features/owner/ExpenseReport.tsx`.
- [x] "Gestionar equipo y sueldos →" navigation button to `/owner/staff` implemented in `ExpenseReport.tsx`.
- [x] Immediate re-render across Bento KPIs, chart, and cards when fixed costs or staff profiles update.
- [x] Integration tests in `src/features/owner/ExpenseReport.test.tsx` passing (14 tests).
- [x] Full focused test suite runs clean without failures (36 passed across 3 test files).

## Verification Evidence

```text
 RUN  v5.0.3 C:/Users/edani/OneDrive/Documents/Proyectos/Daidev/EvoGym

 ✓ src/demo/fixedCostsStore.test.ts (5 tests) 9ms
 ✓ src/demo/expenseReportSelector.test.ts (17 tests) 67ms
 ✓ src/features/owner/ExpenseReport.test.tsx (14 tests) 4658ms

 Test Files  3 passed (3)
      Tests  36 passed (36)
   Duration  10.99s
```

## Next step

Ready for owner operational review and deployment into the production release.
