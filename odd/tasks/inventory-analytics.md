# Manage Products and Analyze Inventory (Gestión y Análisis de Inventario)

Owner-facing inventory and catalog management suite integrating business KPIs, rotation alerts, top sellers analytics via TanStack Charts (switchable between units and revenue), product catalog table via TanStack Table with multi-facet filters, and accessible modals for creating products, editing pricing/cost, and toggling active/inactive status while strictly preserving historical audit trails.

## Quick path

1. Run focused unit and integration test suite: `npx vitest run src/demo/inventoryAnalyticsSelector.test.ts src/features/owner/InventoryAnalytics.test.tsx`
2. Open `/owner/inventory` as OWNER to inspect the inventory dashboard.
3. Toggle between "Por unidades" and "Por ingresos" in the Top Sellers chart visualizer.
4. Filter catalog table via pills: `Todos`, `Activos`, `Bajo stock`, `Sin ventas`, `Inactivos`.
5. Click "Nuevo producto" to register a product with opening stock, price, and unit cost.
6. Click "Editar" on any row to adjust sale price or cost minor without altering movement history.
7. Click "Desactivar" / "Activar" to toggle catalog availability while preserving historical sales.

## Details

| Topic | Decision |
|---|---|
| Role-Based Routing | In `src/features/inventory/Inventory.tsx`, when `role === 'OWNER'`, `<InventoryAnalytics />` is rendered. Receptionists retain standard operational inventory intake. |
| Pure Domain Selector | `src/demo/inventoryAnalyticsSelector.ts` provides `getInventoryAnalytics(state, period, referenceDate)` calculating active product counts, catalog sales valuation, units sold, revenue, gross profit, low stock count (<= 5 units), and zero sales count. |
| Top Sellers Rankings | Distinct rankings for units sold and revenue generated (`byUnits` and `byRevenue`), ensuring high-volume low-ticket items and low-volume high-ticket items are analyzed properly. |
| Immutable Pure Operations | Pure transaction functions `createProduct`, `updateProduct`, and `toggleProductActive` increment state revision and never erase or mutate historical movements or sales records. |
| Initial Stock Movement | Registering a new product with `openingQuantity > 0` appends an initial `'restock'` movement in `state.stockMovements` to maintain complete auditability. |
| TanStack Charts Visualizer | Interactive `@tanstack/charts` bar chart visualizing Top 5 Selling Products with toggleable metric state (Units sold vs. Revenue MXN). |
| TanStack Table Management | Accessible `@tanstack/react-table` catalog table supporting column sorting, text search, and category/status filter pills (`Todos`, `Activos`, `Bajo stock`, `Sin ventas`, `Inactivos`). |
| Accessible Modals | WAI-ARIA compliant modal dialogs with keyboard trap (`Escape` dismiss, focus management) for "Nuevo producto", "Editar producto", and "Activar/Desactivar". |
| EGC Design Tokens | Full compliance with `Design.md` light and dark theme palettes (`#FC6C06` brand orange, claymorphism shadows, high-contrast borders). |

## Checklist

- [x] Extend `Product` model with `category?: string`, `costMinor?: Money`, `active?: boolean` in `src/domain/models.ts`.
- [x] Define test suite in `src/demo/inventoryAnalyticsSelector.test.ts` for selector and domain operations (9 unit tests).
- [x] Implement `src/demo/inventoryAnalyticsSelector.ts` to satisfy all selector and mutation requirements.
- [x] Create `src/features/owner/InventoryAnalytics.tsx` and `src/features/owner/InventoryAnalytics.css`.
- [x] Connect Owner route in `src/features/inventory/Inventory.tsx` (`role === 'OWNER'` renders `InventoryAnalytics`).
- [x] Implement integration tests in `src/features/owner/InventoryAnalytics.test.tsx` (9 integration tests).
- [x] Run full focused test suite and verify 100% passing tests (18 tests passed).

## Verification Evidence

```text
 RUN  v5.0.3 C:/Users/edani/OneDrive/Documents/Proyectos/Daidev/EvoGym

 ✓ src/demo/inventoryAnalyticsSelector.test.ts (9 tests) 9ms
 ✓ src/features/owner/InventoryAnalytics.test.tsx (9 tests) 3059ms
   ✓ InventoryAnalytics owner screen (9)
     ✓ renders header, title, and "Nuevo producto" button 309ms
     ✓ displays the 3 Bento KPI cards with accurate catalog metrics 45ms
     ✓ renders visual organizer with chart container and metric toggle buttons 120ms
     ✓ renders catalog table with seed products and filter pills 65ms
     ✓ filters table by search query 180ms
     ✓ opens and closes "Nuevo producto" modal with form validation 1071ms
     ✓ opens edit modal and updates product details 685ms
     ✓ opens confirmation modal and deactivates a product 344ms
     ✓ renders InventoryAnalytics when role is OWNER in Inventory component 230ms

 Test Files  2 passed (2)
      Tests  18 passed (18)
   Start at  01:20:17
   Duration  7.80s (import 36%, tests 34%, environment 22%, setup 4%, transform 3%)
```

## Next step

Ready for deployment and operational walkthrough by the gym owner.
