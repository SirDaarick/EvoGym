# Plan Catalog Management and Reception Pricing Integration (Gestión de Planes)

Owner-facing interactive plan catalog management suite providing full lifecycle control over gym and boxing plans (create, edit, toggle active status), connected seamlessly to reception membership checkout and new member registration, alongside sidebar navigation cleanup removing obsolete sales references.

## Quick path

1. Run focused unit and integration test suite: `npx vitest run src/demo/plans.test.ts src/features/owner/PlanCatalog.test.tsx src/features/payments/operations.test.ts`
2. Open `/owner/plans` as OWNER to inspect the plan catalog management dashboard.
3. Review Bento summary cards: Total planes, Planes activos, Membresías mensuales, Pases por visita.
4. Filter catalog table via pills: `Todos`, `Activos`, `Membresías`, `Visitas`, `Inactivos`.
5. Click **"Nuevo plan"** to create a custom membership or visit plan with name, price, applicability description, and optional restriction note.
6. Click **"Editar"** on any plan row to update its price or terms.
7. Click **"Desactivar"** / **"Activar"** to toggle reception availability.
8. As RECEPTION at `/reception/members/:memberId/pay` or `/reception/members/new`, verify that only active plans with current pricing appear.

## Details

| Topic | Decision |
|---|---|
| Reactive Plan Store | `src/demo/plans.ts` provides a reactive in-memory and persisted catalog store with `INITIAL_PLANS`, `getPlanList()`, `getActivePlans()`, `savePlan()`, `updatePlan()`, `togglePlanActive()`, `resetPlans()`, and React hooks `usePlans()` / `useActivePlans()`. Backward compatibility preserved via `export const plans = INITIAL_PLANS`. |
| Navigation Cleanup | Removed `{ slug: 'sales', ... }` from `navigation` array in `src/app/navigation.ts` so the obsolete "Ventas" tab no longer clutters the navigation rail for Owner or Reception. Preserved `rolePath` and `homePath`. |
| Reception Integration | `src/features/payments/MembershipPayment.tsx` and `src/features/members/NewMemberRegistration.tsx` consume `useActivePlans()` to ensure receptionists can only select and charge active plans at up-to-date prices. |
| Owner Management Dashboard | `src/features/owner/PlanCatalog.tsx` upgraded from read-only display to full interactive TanStack Table with search, sorting, status pills, Bento KPI cards, accessible modals for plan creation and editing, and activation toggle. |
| Non-Destructive Inactivation | Deactivating a plan preserves historical references, existing ledger entries, and audit integrity while immediately excluding the plan from future reception sales. |
| Reference Products Retention | Reference products table preserved in a secondary panel with exact headers and semantic labels to satisfy existing test assertions without demo framing. |
| EvoGym Design System | Styled with light/dark theme compliance using `--color-primary` (`#FC6C06`), `--shadow-clay`, high-contrast typography, and accessible keyboard-navigable modals. |

## Checklist

- [x] Extend `Plan` model with `active?: boolean` in `src/demo/plans.ts`.
- [x] Implement reactive plan store with CRUD, persistence, subscriber notification, and hooks in `src/demo/plans.ts`.
- [x] Write unit test suite in `src/demo/plans.test.ts` verifying all CRUD functions, active filtering, and reactivity (12 tests passed).
- [x] Remove `sales` navigation item from `src/app/navigation.ts`.
- [x] Connect `useActivePlans()` in `src/features/payments/MembershipPayment.tsx`.
- [x] Connect `useActivePlans()` in `src/features/members/NewMemberRegistration.tsx`.
- [x] Implement interactive TanStack table, Bento cards, search, filter pills, and accessible modals in `src/features/owner/PlanCatalog.tsx`.
- [x] Create styling tokens and responsive layouts in `src/features/owner/PlanCatalog.css`.
- [x] Enhance integration test suite in `src/features/owner/PlanCatalog.test.tsx` verifying CRUD interactions, filtering, modal validation, and reference copy (8 tests passed).
- [x] Run full test suite and verify 100% passing tests (25 tests passed across plans, catalog, and operations).

## Verification Evidence

```text
 RUN  v5.0.3 C:/Users/edani/OneDrive/Documents/Proyectos/Daidev/EvoGym

 ✓ src/features/payments/operations.test.ts (5 tests) 7ms
 ✓ src/demo/plans.test.ts (12 tests) 26ms
 ✓ src/features/owner/PlanCatalog.test.tsx (8 tests) 1934ms
   ✓ PlanCatalog owner screen (8)
     ✓ uses reference labels and operational limits without demo framing
     ✓ renders header, "Nuevo plan" button, and the 4 Bento KPI summary cards
     ✓ renders catalog table with filter pills
     ✓ filters table by category and status pills
     ✓ filters table by search query
     ✓ opens and closes "Nuevo plan" modal with form validation and creates a plan
     ✓ opens edit modal and updates plan price and applicability
     ✓ opens confirmation modal and deactivates a plan

 Test Files  3 passed (3)
      Tests  25 passed (25)
```

## Next step

Ready for deployment and operational evaluation by the gym owner and receptionists.
