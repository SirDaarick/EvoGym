import { describe, expect, it } from 'vitest';
import type { DemoState, Product, Sale } from '../domain/models';
import {
  createProduct,
  getInventoryAnalytics,
  toggleProductActive,
  updateProduct,
  type InventoryPeriod,
} from './inventoryAnalyticsSelector';

function createMockState(overrides?: Partial<DemoState>): DemoState {
  const products: Product[] = [
    {
      id: 'prod-water',
      name: 'Agua Natural 1L',
      category: 'Bebidas',
      priceMinor: 2000, // $20.00
      costMinor: 800,   // $8.00
      openingQuantity: 10,
      active: true,
      illustrative: true,
    },
    {
      id: 'prod-protein-shake',
      name: 'Batido Proteico',
      category: 'Suplementos',
      priceMinor: 5000, // $50.00
      costMinor: 2500,  // $25.00
      openingQuantity: 4, // low stock <= 5
      active: true,
      illustrative: true,
    },
    {
      id: 'prod-bar',
      name: 'Barra Energética',
      category: 'Snacks',
      priceMinor: 3500, // $35.00
      costMinor: 1500,  // $15.00
      openingQuantity: 20,
      active: true,
      illustrative: true,
    },
    {
      id: 'prod-towel',
      name: 'Toalla Deportiva EvoGym',
      category: 'Accesorios',
      priceMinor: 15000, // $150.00
      costMinor: 8000,   // $80.00
      openingQuantity: 2, // low stock <= 5, 0 sales
      active: true,
      illustrative: true,
    },
    {
      id: 'prod-discontinued',
      name: 'Bebida Antigua',
      category: 'Bebidas',
      priceMinor: 1000,
      costMinor: 500,
      openingQuantity: 0,
      active: false, // inactive
      illustrative: true,
    },
  ];

  const sales: Sale[] = [
    // 10 waters sold on 2026-10-08 -> 10 units, $200.00 MXN
    {
      id: 'sale-1',
      kind: 'product',
      productId: 'prod-water',
      description: 'Agua Natural 1L',
      quantity: 10,
      unitPriceMinor: 2000,
      amountMinor: 20000,
      method: 'cash',
      status: 'confirmed',
      shiftId: 'shift-1',
      recordedAt: '2026-10-08T10:00:00-06:00',
    },
    // 5 shakes sold on 2026-10-08 -> 5 units, $250.00 MXN (higher revenue than water, lower units)
    {
      id: 'sale-2',
      kind: 'product',
      productId: 'prod-protein-shake',
      description: 'Batido Proteico',
      quantity: 5,
      unitPriceMinor: 5000,
      amountMinor: 25000,
      method: 'card',
      status: 'confirmed',
      shiftId: 'shift-1',
      recordedAt: '2026-10-08T11:00:00-06:00',
    },
    // 2 bars sold on 2026-10-05 (3 days earlier, within week)
    {
      id: 'sale-3',
      kind: 'product',
      productId: 'prod-bar',
      description: 'Barra Energética',
      quantity: 2,
      unitPriceMinor: 3500,
      amountMinor: 7000,
      method: 'cash',
      status: 'confirmed',
      shiftId: 'shift-old',
      recordedAt: '2026-10-05T09:00:00-06:00',
    },
    // 1 old sale 40 days ago (outside month)
    {
      id: 'sale-old',
      kind: 'product',
      productId: 'prod-bar',
      description: 'Barra Energética',
      quantity: 4,
      unitPriceMinor: 3500,
      amountMinor: 14000,
      method: 'cash',
      status: 'confirmed',
      shiftId: 'shift-ancient',
      recordedAt: '2026-08-20T09:00:00-06:00',
    },
    // Pending sale (should not be counted in analytics)
    {
      id: 'sale-pending',
      kind: 'product',
      productId: 'prod-water',
      description: 'Agua Natural 1L',
      quantity: 2,
      unitPriceMinor: 2000,
      amountMinor: 4000,
      method: 'transfer',
      status: 'pending',
      shiftId: 'shift-1',
      recordedAt: '2026-10-08T11:30:00-06:00',
    },
    // Visit sale (should not be counted in product analytics)
    {
      id: 'sale-visit',
      kind: 'visit',
      description: 'Visita Gym',
      quantity: 1,
      unitPriceMinor: 5000,
      amountMinor: 5000,
      method: 'cash',
      status: 'confirmed',
      shiftId: 'shift-1',
      recordedAt: '2026-10-08T12:00:00-06:00',
    },
  ];

  return {
    demoClock: '2026-10-08T12:00:00-06:00',
    attendancePolicy: { allowExpiryDay: true, allowRepeatVisits: true },
    attendance: [],
    members: [],
    revision: 1,
    currentShiftId: 'shift-1',
    payments: [],
    ledger: [],
    shifts: [
      {
        id: 'shift-1',
        window: '06:00–14:00',
        openedAt: '2026-10-08T06:00:00-06:00',
        status: 'open',
        openingCashMinor: 50000,
      },
    ],
    products,
    stockMovements: [
      // Water: opening 10, sold 10 -> currentStock 0 (low stock <= 5)
      {
        id: 'mov-1',
        productId: 'prod-water',
        shiftId: 'shift-1',
        kind: 'sale',
        quantity: 10,
        recordedAt: '2026-10-08T10:00:00-06:00',
      },
      // Shake: opening 4, restock 6, sold 5 -> currentStock 5 (low stock <= 5)
      {
        id: 'mov-2',
        productId: 'prod-protein-shake',
        shiftId: 'shift-1',
        kind: 'restock',
        quantity: 6,
        recordedAt: '2026-10-08T08:00:00-06:00',
      },
      {
        id: 'mov-3',
        productId: 'prod-protein-shake',
        shiftId: 'shift-1',
        kind: 'sale',
        quantity: 5,
        recordedAt: '2026-10-08T11:00:00-06:00',
      },
      // Bar: opening 20, sold 2, old sold 4 -> currentStock 14 (not low stock)
      {
        id: 'mov-4',
        productId: 'prod-bar',
        shiftId: 'shift-old',
        kind: 'sale',
        quantity: 2,
        recordedAt: '2026-10-05T09:00:00-06:00',
      },
      {
        id: 'mov-5',
        productId: 'prod-bar',
        shiftId: 'shift-ancient',
        kind: 'sale',
        quantity: 4,
        recordedAt: '2026-08-20T09:00:00-06:00',
      },
      // Towel: opening 2, no movements -> currentStock 2 (low stock <= 5, 0 sales)
    ],
    counts: [],
    sales,
    ...overrides,
  };
}

describe('inventoryAnalyticsSelector', () => {
  describe('getInventoryAnalytics', () => {
    it('computes correct KPIs for active products, catalog value, units sold, revenue, low stock and zero sales', () => {
      const state = createMockState();
      const analytics = getInventoryAnalytics(state, 'all');

      // Total products: 5, Active products: 4 (prod-discontinued is inactive)
      expect(analytics.kpis.activeProductsCount).toBe(4);
      expect(analytics.kpis.totalProductsCount).toBe(5);

      // Low stock active products (currentStock <= 5):
      // prod-water: 0
      // prod-protein-shake: 5
      // prod-towel: 2
      // prod-bar: 14 (not low stock)
      // (prod-discontinued is inactive, excluded from active low stock)
      expect(analytics.kpis.lowStockCount).toBe(3);

      // Zero sales active products in 'all':
      // prod-towel: 0 sales
      expect(analytics.kpis.zeroSalesCount).toBe(1);

      // Sales in 'all':
      // water: 10 units, $200.00
      // shake: 5 units, $250.00
      // bar: 2 + 4 = 6 units, $70.00 + $140.00 = $210.00
      // Total units: 10 + 5 + 6 = 21
      expect(analytics.kpis.totalUnitsSold).toBe(21);
      // Total revenue: 20000 + 25000 + 7000 + 14000 = 66000 ($660.00 MXN)
      expect(analytics.kpis.totalRevenueMinor).toBe(66000);
      expect(analytics.kpis.totalRevenueFormatted).toBe('$660.00');

      // Catalog value of active products based on current stock:
      // prod-water: 0 * 2000 = 0
      // prod-protein-shake: 5 * 5000 = 25000
      // prod-bar: 14 * 3500 = 49000
      // prod-towel: 2 * 15000 = 30000
      // Total catalog retail value: 25000 + 49000 + 30000 = 104000 ($1,040.00 MXN)
      expect(analytics.kpis.catalogValueMinor).toBe(104000);
      expect(analytics.kpis.catalogValueFormatted).toBe('$1,040.00');
    });

    it('filters metrics by period correctly (today vs week vs month vs all)', () => {
      const state = createMockState();

      // Today (2026-10-08): only sale-1 (10 waters, $200) and sale-2 (5 shakes, $250)
      const todayAnalytics = getInventoryAnalytics(state, 'today');
      expect(todayAnalytics.kpis.totalUnitsSold).toBe(15);
      expect(todayAnalytics.kpis.totalRevenueMinor).toBe(45000); // $450.00 MXN
      // In today, bar has 0 sales and towel has 0 sales -> 2 active products with 0 sales
      expect(todayAnalytics.kpis.zeroSalesCount).toBe(2);

      // Week (last 7 days): includes today + sale-3 (2 bars, $70) -> 17 units, $520.00
      const weekAnalytics = getInventoryAnalytics(state, 'week');
      expect(weekAnalytics.kpis.totalUnitsSold).toBe(17);
      expect(weekAnalytics.kpis.totalRevenueMinor).toBe(52000);
      expect(weekAnalytics.kpis.zeroSalesCount).toBe(1); // only towel has 0 sales in the week

      // Month (last 30 days): includes week sales, but excludes sale-old (40 days ago)
      const monthAnalytics = getInventoryAnalytics(state, 'month');
      expect(monthAnalytics.kpis.totalUnitsSold).toBe(17);
      expect(monthAnalytics.kpis.totalRevenueMinor).toBe(52000);
    });

    it('keeps top sellers rankings distinct between units sold and revenue', () => {
      const state = createMockState();
      const analytics = getInventoryAnalytics(state, 'today');

      // Today sales:
      // prod-water: 10 units, 20000 minor ($200.00)
      // prod-protein-shake: 5 units, 25000 minor ($250.00)

      // Ranking by units: prod-water #1 (10 units), prod-protein-shake #2 (5 units)
      expect(analytics.topSellersRankings.byUnits[0].productId).toBe('prod-water');
      expect(analytics.topSellersRankings.byUnits[0].unitsSold).toBe(10);
      expect(analytics.topSellersRankings.byUnits[1].productId).toBe('prod-protein-shake');
      expect(analytics.topSellersRankings.byUnits[1].unitsSold).toBe(5);

      // Ranking by revenue: prod-protein-shake #1 ($250.00), prod-water #2 ($200.00)
      expect(analytics.topSellersRankings.byRevenue[0].productId).toBe('prod-protein-shake');
      expect(analytics.topSellersRankings.byRevenue[0].revenueMinor).toBe(25000);
      expect(analytics.topSellersRankings.byRevenue[1].productId).toBe('prod-water');
      expect(analytics.topSellersRankings.byRevenue[1].revenueMinor).toBe(20000);
    });

    it('generates complete product rows for TanStack Table with correct fields', () => {
      const state = createMockState();
      const analytics = getInventoryAnalytics(state, 'today');

      const rows = analytics.productRows;
      expect(rows).toHaveLength(5);

      const waterRow = rows.find(r => r.id === 'prod-water');
      expect(waterRow).toBeDefined();
      expect(waterRow?.name).toBe('Agua Natural 1L');
      expect(waterRow?.category).toBe('Bebidas');
      expect(waterRow?.currentStock).toBe(0);
      expect(waterRow?.priceMinor).toBe(2000);
      expect(waterRow?.costMinor).toBe(800);
      expect(waterRow?.unitsSold).toBe(10);
      expect(waterRow?.revenueMinor).toBe(20000);
      expect(waterRow?.active).toBe(true);
      expect(waterRow?.isLowStock).toBe(true);

      const discontinuedRow = rows.find(r => r.id === 'prod-discontinued');
      expect(discontinuedRow?.active).toBe(false);
    });
  });

  describe('Pure Operations', () => {
    describe('createProduct', () => {
      it('adds a new product and creates an initial stock movement when openingQuantity > 0', () => {
        const state = createMockState();
        const transaction = createProduct(state, {
          name: 'Electrolit Uva',
          category: 'Bebidas',
          priceMinor: 3800,
          costMinor: 2200,
          openingQuantity: 15,
        });

        expect(transaction.result.status).toBe('ok');
        if (transaction.result.status !== 'ok') return;

        const newProd = transaction.result.product;
        expect(newProd.name).toBe('Electrolit Uva');
        expect(newProd.category).toBe('Bebidas');
        expect(newProd.priceMinor).toBe(3800);
        expect(newProd.costMinor).toBe(2200);
        expect(newProd.active).toBe(true);

        // State immutability & revision
        expect(transaction.state.revision).toBe(state.revision + 1);
        expect(transaction.state.products).toHaveLength(state.products.length + 1);

        // Movement created
        const movement = transaction.state.stockMovements.find(m => m.productId === newProd.id);
        expect(movement).toBeDefined();
        expect(movement?.kind).toBe('restock');
        expect(movement?.quantity).toBe(15);
        expect(movement?.shiftId).toBe(state.currentShiftId);

        // Analytics reflects the new product with initial stock 15
        const analytics = getInventoryAnalytics(transaction.state, 'all');
        const row = analytics.productRows.find(r => r.id === newProd.id);
        expect(row?.currentStock).toBe(15);
        expect(row?.isLowStock).toBe(false);
      });

      it('rejects invalid inputs with descriptive error messages', () => {
        const state = createMockState();

        // Empty name
        const resEmptyName = createProduct(state, {
          name: '   ',
          priceMinor: 2000,
          openingQuantity: 5,
        });
        expect(resEmptyName.result.status).toBe('error');
        expect(resEmptyName.state).toBe(state);

        // Negative price
        const resNegPrice = createProduct(state, {
          name: 'Producto Test',
          priceMinor: -100,
          openingQuantity: 5,
        });
        expect(resNegPrice.result.status).toBe('error');

        // Negative opening quantity
        const resNegQty = createProduct(state, {
          name: 'Producto Test',
          priceMinor: 1000,
          openingQuantity: -5,
        });
        expect(resNegQty.result.status).toBe('error');
      });
    });

    describe('updateProduct', () => {
      it('updates price, cost, name, and category without modifying movement history', () => {
        const state = createMockState();
        const initialMovementsCount = state.stockMovements.length;

        const transaction = updateProduct(state, 'prod-water', {
          name: 'Agua Ciel 1.5L',
          category: 'Hidratación',
          priceMinor: 2500,
          costMinor: 1000,
        });

        expect(transaction.result.status).toBe('ok');
        if (transaction.result.status !== 'ok') return;

        expect(transaction.result.product.name).toBe('Agua Ciel 1.5L');
        expect(transaction.result.product.category).toBe('Hidratación');
        expect(transaction.result.product.priceMinor).toBe(2500);
        expect(transaction.result.product.costMinor).toBe(1000);

        // History preserved
        expect(transaction.state.stockMovements).toHaveLength(initialMovementsCount);
        expect(transaction.state.revision).toBe(state.revision + 1);
      });

      it('returns error when product is not found', () => {
        const state = createMockState();
        const transaction = updateProduct(state, 'non-existent-id', {
          name: 'Test',
        });

        expect(transaction.result.status).toBe('error');
      });
    });

    describe('toggleProductActive', () => {
      it('toggles product active status and preserves historical sales and movements', () => {
        const state = createMockState();
        const initialSalesCount = state.sales.length;
        const initialMovementsCount = state.stockMovements.length;

        // Deactivate prod-water (currently active)
        const deactivateTx = toggleProductActive(state, 'prod-water');
        expect(deactivateTx.result.status).toBe('ok');
        if (deactivateTx.result.status !== 'ok') return;
        expect(deactivateTx.result.product.active).toBe(false);

        // History strictly preserved
        expect(deactivateTx.state.sales).toHaveLength(initialSalesCount);
        expect(deactivateTx.state.stockMovements).toHaveLength(initialMovementsCount);

        // Reactivate
        const reactivateTx = toggleProductActive(deactivateTx.state, 'prod-water');
        expect(reactivateTx.result.status).toBe('ok');
        if (reactivateTx.result.status !== 'ok') return;
        expect(reactivateTx.result.product.active).toBe(true);
      });
    });
  });
});
