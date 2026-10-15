import type { DemoState, Money, Product, Sale, StockMovement } from '../domain/models';
import type { Transaction } from './operations';
import { expectedStock } from './inventoryOperations';

export type InventoryPeriod = 'today' | 'week' | 'month' | 'all' | 'shift';

export interface ProductAnalyticsRow {
  id: string;
  name: string;
  category: string;
  currentStock: number;
  priceMinor: Money;
  priceFormatted: string;
  costMinor: Money;
  costFormatted: string;
  marginMinor: Money;
  marginPercent: number;
  unitsSold: number;
  revenueMinor: Money;
  revenueFormatted: string;
  active: boolean;
  isLowStock: boolean;
  isZeroSales: boolean;
}

export interface TopSellerItem {
  productId: string;
  name: string;
  category: string;
  unitsSold: number;
  revenueMinor: Money;
  revenueFormatted: string;
  percent: number;
}

export interface InventoryAnalyticsKPIs {
  activeProductsCount: number;
  totalProductsCount: number;
  catalogValueMinor: Money;
  catalogValueFormatted: string;
  catalogCostValueMinor: Money;
  catalogCostValueFormatted: string;
  totalUnitsSold: number;
  totalRevenueMinor: Money;
  totalRevenueFormatted: string;
  totalProfitMinor: Money;
  totalProfitFormatted: string;
  lowStockCount: number;
  zeroSalesCount: number;
}

export interface InventoryAnalyticsResult {
  period: InventoryPeriod;
  kpis: InventoryAnalyticsKPIs;
  topSellersRankings: {
    byUnits: TopSellerItem[];
    byRevenue: TopSellerItem[];
  };
  productRows: ProductAnalyticsRow[];
}

export type ProductOperationResult =
  | { status: 'ok'; product: Product }
  | { status: 'error'; message: string };

const currencyFormatter = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(amountMinor: Money): string {
  return currencyFormatter.format(amountMinor / 100);
}

const mexicoCityDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function localDateKey(timestamp: string | Date): string {
  const dateObj = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  if (Number.isNaN(dateObj.getTime())) return '';
  const parts = mexicoCityDateFormatter.formatToParts(dateObj);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function matchesPeriod(
  saleRecordedAt: string,
  saleShiftId: string,
  period: InventoryPeriod,
  refDate: Date,
  currentShiftId: string
): boolean {
  if (period === 'all') return true;
  if (period === 'shift') return saleShiftId === currentShiftId;

  const saleDateKey = localDateKey(saleRecordedAt);
  const refDateStr = localDateKey(refDate);
  if (!saleDateKey || !refDateStr) return false;

  if (period === 'today') {
    return saleDateKey === refDateStr;
  }

  const refMs = Date.parse(`${refDateStr}T00:00:00Z`);
  const saleMs = Date.parse(`${saleDateKey}T00:00:00Z`);
  const diffDays = Math.round((refMs - saleMs) / (24 * 60 * 60 * 1000));

  if (period === 'week') {
    return diffDays >= 0 && diffDays <= 7;
  }

  if (period === 'month') {
    return diffDays >= 0 && diffDays <= 30;
  }

  return true;
}

export function getInventoryAnalytics(
  state: DemoState,
  period: InventoryPeriod = 'all',
  referenceDate?: string | Date
): InventoryAnalyticsResult {
  const refDate = referenceDate
    ? typeof referenceDate === 'string'
      ? new Date(referenceDate)
      : referenceDate
    : state.demoClock
    ? new Date(state.demoClock)
    : new Date();

  // Filter sales within the period
  const relevantSales = state.sales.filter(
    sale =>
      sale.kind === 'product' &&
      sale.status === 'confirmed' &&
      sale.productId &&
      matchesPeriod(sale.recordedAt, sale.shiftId, period, refDate, state.currentShiftId)
  );

  // Precompute sales per product
  const salesByProduct = new Map<string, { unitsSold: number; revenueMinor: Money }>();
  for (const sale of relevantSales) {
    if (!sale.productId) continue;
    const existing = salesByProduct.get(sale.productId) ?? { unitsSold: 0, revenueMinor: 0 };
    existing.unitsSold += sale.quantity;
    existing.revenueMinor += sale.amountMinor;
    salesByProduct.set(sale.productId, existing);
  }

  let totalUnitsSold = 0;
  let totalRevenueMinor = 0;
  let totalCostOfSoldMinor = 0;
  let catalogValueMinor = 0;
  let catalogCostValueMinor = 0;
  let lowStockCount = 0;
  let zeroSalesCount = 0;
  let activeProductsCount = 0;

  const productRows: ProductAnalyticsRow[] = state.products.map(product => {
    const active = product.active !== false;
    if (active) activeProductsCount += 1;

    const currentStock = expectedStock(state, product.id);
    const costMinor = product.costMinor ?? 0;
    const priceMinor = product.priceMinor;
    const marginMinor = priceMinor - costMinor;
    const marginPercent = priceMinor > 0 ? Math.round((marginMinor / priceMinor) * 100) : 0;

    const salesData = salesByProduct.get(product.id) ?? { unitsSold: 0, revenueMinor: 0 };
    const unitsSold = salesData.unitsSold;
    const revenueMinor = salesData.revenueMinor;

    totalUnitsSold += unitsSold;
    totalRevenueMinor += revenueMinor;
    totalCostOfSoldMinor += unitsSold * costMinor;

    if (active) {
      catalogValueMinor += currentStock * priceMinor;
      catalogCostValueMinor += currentStock * costMinor;
      if (currentStock <= 5) lowStockCount += 1;
      if (unitsSold === 0) zeroSalesCount += 1;
    }

    return {
      id: product.id,
      name: product.name,
      category: product.category || 'General',
      currentStock,
      priceMinor,
      priceFormatted: formatMoney(priceMinor),
      costMinor,
      costFormatted: formatMoney(costMinor),
      marginMinor,
      marginPercent,
      unitsSold,
      revenueMinor,
      revenueFormatted: formatMoney(revenueMinor),
      active,
      isLowStock: currentStock <= 5,
      isZeroSales: unitsSold === 0,
    };
  });

  const totalProfitMinor = totalRevenueMinor - totalCostOfSoldMinor;

  const kpis: InventoryAnalyticsKPIs = {
    activeProductsCount,
    totalProductsCount: state.products.length,
    catalogValueMinor,
    catalogValueFormatted: formatMoney(catalogValueMinor),
    catalogCostValueMinor,
    catalogCostValueFormatted: formatMoney(catalogCostValueMinor),
    totalUnitsSold,
    totalRevenueMinor,
    totalRevenueFormatted: formatMoney(totalRevenueMinor),
    totalProfitMinor,
    totalProfitFormatted: formatMoney(totalProfitMinor),
    lowStockCount,
    zeroSalesCount,
  };

  // Top sellers rankings
  // Only products that have units sold, or active products if empty
  const soldProducts = productRows.filter(p => p.unitsSold > 0);

  const byUnits: TopSellerItem[] = [...soldProducts]
    .sort((a, b) => b.unitsSold - a.unitsSold || b.revenueMinor - a.revenueMinor)
    .map(p => ({
      productId: p.id,
      name: p.name,
      category: p.category,
      unitsSold: p.unitsSold,
      revenueMinor: p.revenueMinor,
      revenueFormatted: p.revenueFormatted,
      percent: totalUnitsSold > 0 ? Math.round((p.unitsSold / totalUnitsSold) * 100) : 0,
    }));

  const byRevenue: TopSellerItem[] = [...soldProducts]
    .sort((a, b) => b.revenueMinor - a.revenueMinor || b.unitsSold - a.unitsSold)
    .map(p => ({
      productId: p.id,
      name: p.name,
      category: p.category,
      unitsSold: p.unitsSold,
      revenueMinor: p.revenueMinor,
      revenueFormatted: p.revenueFormatted,
      percent: totalRevenueMinor > 0 ? Math.round((p.revenueMinor / totalRevenueMinor) * 100) : 0,
    }));

  return {
    period,
    kpis,
    topSellersRankings: {
      byUnits,
      byRevenue,
    },
    productRows,
  };
}

export function createProduct(
  state: DemoState,
  data: {
    id?: string;
    name: string;
    category?: string;
    priceMinor: Money;
    costMinor?: Money;
    openingQuantity?: number;
  }
): Transaction<ProductOperationResult> {
  const fail = (message: string): Transaction<ProductOperationResult> => ({
    state,
    result: { status: 'error', message },
  });

  if (!data.name || !data.name.trim()) {
    return fail('Escribe el nombre del producto.');
  }

  if (!Number.isSafeInteger(data.priceMinor) || data.priceMinor < 0) {
    return fail('El precio debe ser un número entero mayor o igual a 0.');
  }

  if (data.costMinor !== undefined && (!Number.isSafeInteger(data.costMinor) || data.costMinor < 0)) {
    return fail('El costo debe ser un número entero mayor o igual a 0.');
  }

  const openingQuantity = data.openingQuantity ?? 0;
  if (!Number.isSafeInteger(openingQuantity) || openingQuantity < 0) {
    return fail('La cantidad debe ser un entero positivo o cero.');
  }

  const generatedId =
    data.id ||
    `prod-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

  if (state.products.some(p => p.id === generatedId)) {
    return fail('Ya existe un producto con esta clave.');
  }

  const newProduct: Product = {
    id: generatedId,
    name: data.name.trim(),
    category: data.category?.trim() || 'General',
    priceMinor: data.priceMinor,
    costMinor: data.costMinor ?? 0,
    openingQuantity: 0,
    active: true,
    illustrative: true,
  };

  const nextProducts = [...state.products, newProduct];
  let nextMovements = state.stockMovements;

  if (openingQuantity > 0) {
    const initialMovement: StockMovement = {
      id: `mov-init-${generatedId}`,
      productId: generatedId,
      shiftId: state.currentShiftId || 'shift-1',
      kind: 'restock',
      quantity: openingQuantity,
      recordedAt: state.demoClock || new Date().toISOString(),
    };
    nextMovements = [...state.stockMovements, initialMovement];
  }

  return {
    state: {
      ...state,
      revision: state.revision + 1,
      products: nextProducts,
      stockMovements: nextMovements,
    },
    result: {
      status: 'ok',
      product: newProduct,
    },
  };
}

export function updateProduct(
  state: DemoState,
  id: string,
  updates: {
    name?: string;
    category?: string;
    priceMinor?: Money;
    costMinor?: Money;
  }
): Transaction<ProductOperationResult> {
  const fail = (message: string): Transaction<ProductOperationResult> => ({
    state,
    result: { status: 'error', message },
  });

  const product = state.products.find(p => p.id === id);
  if (!product) {
    return fail('Producto no encontrado.');
  }

  if (updates.name !== undefined && !updates.name.trim()) {
    return fail('Escribe el nombre del producto.');
  }

  if (
    updates.priceMinor !== undefined &&
    (!Number.isSafeInteger(updates.priceMinor) || updates.priceMinor < 0)
  ) {
    return fail('El precio debe ser un número entero mayor o igual a 0.');
  }

  if (
    updates.costMinor !== undefined &&
    (!Number.isSafeInteger(updates.costMinor) || updates.costMinor < 0)
  ) {
    return fail('El costo debe ser un número entero mayor o igual a 0.');
  }

  const updatedProduct: Product = {
    ...product,
    name: updates.name !== undefined ? updates.name.trim() : product.name,
    category: updates.category !== undefined ? updates.category.trim() : (product.category || 'General'),
    priceMinor: updates.priceMinor !== undefined ? updates.priceMinor : product.priceMinor,
    costMinor: updates.costMinor !== undefined ? updates.costMinor : (product.costMinor ?? 0),
  };

  return {
    state: {
      ...state,
      revision: state.revision + 1,
      products: state.products.map(p => (p.id === id ? updatedProduct : p)),
    },
    result: {
      status: 'ok',
      product: updatedProduct,
    },
  };
}

export function toggleProductActive(
  state: DemoState,
  id: string
): Transaction<ProductOperationResult> {
  const fail = (message: string): Transaction<ProductOperationResult> => ({
    state,
    result: { status: 'error', message },
  });

  const product = state.products.find(p => p.id === id);
  if (!product) {
    return fail('Producto no encontrado.');
  }

  const currentActive = product.active !== false;
  const updatedProduct: Product = {
    ...product,
    active: !currentActive,
  };

  return {
    state: {
      ...state,
      revision: state.revision + 1,
      products: state.products.map(p => (p.id === id ? updatedProduct : p)),
    },
    result: {
      status: 'ok',
      product: updatedProduct,
    },
  };
}
