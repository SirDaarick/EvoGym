import type { DemoState, PaymentMethod, Sale, VisitArea } from '../domain/models';
import type { Transaction } from './operations';
import { activeShift, expectedStock } from './inventoryOperations';

export type SaleRequest = { id: string; quantity: number; method: PaymentMethod } &
  ({ kind: 'product'; productId: string } | { kind: 'visit'; area: VisitArea });
export type SaleResult = { status: 'confirmed' | 'pending'; sale: Sale } | { status: 'error'; message: string };
export interface CartRequest { id: string; method: PaymentMethod; lines: { productId: string; quantity: number }[]; }
export type CartResult = { status: 'confirmed' | 'pending'; sales: Sale[] } | { status: 'error'; message: string };

export function cartQuote(state: DemoState, lines: CartRequest['lines']) {
  if (!lines.length) return null;
  const quantities = new Map<string, number>();
  for (const line of lines) {
    const quantity = (quantities.get(line.productId) ?? 0) + line.quantity;
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0 || !Number.isSafeInteger(quantity)) return null;
    quantities.set(line.productId, quantity);
  }
  const quoted = [];
  let totalMinor = 0;
  for (const [productId, quantity] of [...quantities.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const quote = saleQuote(state, { id: '', method: 'cash', kind: 'product', productId, quantity });
    if (!quote || !Number.isSafeInteger(totalMinor + quote.amountMinor)) return null;
    totalMinor += quote.amountMinor;
    quoted.push({ productId, quantity, ...quote });
  }
  return { lines: quoted, totalMinor };
}

export function registerCart(state: DemoState, request: CartRequest): Transaction<CartResult> {
  const fail = (message: string): Transaction<CartResult> => ({ state, result: { status: 'error', message } });
  const quote = cartQuote(state, request.lines);
  if (!request.id.trim() || !quote || !['cash', 'card', 'transfer'].includes(request.method)) return fail('Revisa productos, cantidades y método de cobro.');
  const existing = state.sales.filter(sale => sale.cartId === request.id);
  if (existing.length) {
    const matches = existing.length === quote.lines.length && quote.lines.every(line => existing.some(sale =>
      sale.productId === line.productId && sale.quantity === line.quantity && sale.method === request.method));
    return matches ? { state, result: { status: existing[0].status, sales: existing } } : fail('La referencia pertenece a otra compra.');
  }
  if (!activeShift(state)) return fail('Abre un turno antes de registrar una venta.');
  if (quote.lines.some(line => !Number.isSafeInteger(expectedStock(state, line.productId)) || line.quantity > expectedStock(state, line.productId))) return fail('Existencia insuficiente para esta compra.');
  const status = request.method === 'transfer' ? 'pending' : 'confirmed';
  const recordedAt = new Date().toISOString();
  const sales: Sale[] = quote.lines.map((line, index) => ({ ...line, id: `${request.id}:line:${index}`, cartId: request.id,
    kind: 'product', method: request.method, status, shiftId: state.currentShiftId, recordedAt }));
  if (state.sales.some(sale => sale.id === request.id) || sales.some(sale => state.sales.some(item => item.id === sale.id)
    || state.ledger.some(item => item.id === `sale-event-${sale.id}`) || state.stockMovements.some(item => item.id === `sale-stock-${sale.id}`))) return fail('Referencia de compra no disponible.');
  // One immutable transition: never register individual lines sequentially.
  const ledger = status === 'confirmed' ? sales.map(sale => ({ id: `sale-event-${sale.id}`, paymentId: sale.id,
    shiftId: sale.shiftId, kind: 'product' as const, amountMinor: sale.amountMinor, method: request.method as 'cash' | 'card', recordedAt })) : [];
  const movements = status === 'confirmed' ? sales.map(sale => ({ id: `sale-stock-${sale.id}`, productId: sale.productId!,
    shiftId: sale.shiftId, kind: 'sale' as const, quantity: sale.quantity, recordedAt })) : [];
  return { state: { ...state, revision: state.revision + 1, sales: [...state.sales, ...sales],
    ledger: [...state.ledger, ...ledger], stockMovements: [...state.stockMovements, ...movements] }, result: { status, sales } };
}
export const visitAreas = { GYM: 'Gym', BOX: 'Box', COMBO: 'Gym + Box' };
export function visitPrice(area: VisitArea) { return area === 'COMBO' ? 10000 : 5000; }
export function saleQuote(state: DemoState, request: SaleRequest) {
  if (!Number.isSafeInteger(request.quantity) || request.quantity <= 0) return null;
  if (request.kind === 'visit') {
    if (!['GYM', 'BOX', 'COMBO'].includes(request.area)) return null;
    const unitPriceMinor = visitPrice(request.area);
    const amountMinor = unitPriceMinor * request.quantity;
    return Number.isSafeInteger(amountMinor) ? { description: `Visita ${visitAreas[request.area]}`, unitPriceMinor, amountMinor } : null;
  }
  const product = state.products.find(item => item.id === request.productId);
  if (!product || !Number.isSafeInteger(product.priceMinor) || product.priceMinor < 0) return null;
  const amountMinor = product.priceMinor * request.quantity;
  return Number.isSafeInteger(amountMinor) ? { description: product.name, unitPriceMinor: product.priceMinor, amountMinor } : null;
}
export function registerSale(state: DemoState, request: SaleRequest): Transaction<SaleResult> {
  const fail = (message: string): Transaction<SaleResult> => ({ state, result: { status: 'error', message } });
  const existing = state.sales.find(item => item.id === request.id);
  if (existing) {
    const matches = existing.kind === request.kind && existing.quantity === request.quantity && existing.method === request.method &&
      (request.kind === 'product' ? existing.productId === request.productId : existing.area === request.area);
    return matches ? { state, result: { status: existing.status, sale: existing } } : fail('La referencia pertenece a otra venta.');
  }
  if (!activeShift(state)) return fail('Abre un turno antes de registrar una venta.');
  const quote = saleQuote(state, request);
  if (!request.id || !quote || !['cash', 'card', 'transfer'].includes(request.method)) return fail('Revisa artículo, área, cantidad y método.');
  if (request.kind === 'product' && request.quantity > expectedStock(state, request.productId)) return fail('Existencia insuficiente para esta venta.');
  const status = request.method === 'transfer' ? 'pending' : 'confirmed';
  const sale: Sale = { ...request, ...quote, status, shiftId: state.currentShiftId, recordedAt: new Date().toISOString() };
  const ledger = status === 'confirmed' ? [...state.ledger, { id: `sale-event-${request.id}`, paymentId: request.id,
    shiftId: sale.shiftId, kind: sale.kind, amountMinor: sale.amountMinor, method: request.method as 'cash' | 'card', recordedAt: sale.recordedAt }] : state.ledger;
  const stockMovements = status === 'confirmed' && request.kind === 'product'
    ? [...state.stockMovements, { id: `sale-stock-${request.id}`, productId: request.productId, shiftId: sale.shiftId,
      kind: 'sale' as const, quantity: request.quantity, recordedAt: sale.recordedAt }] : state.stockMovements;
  return { state: { ...state, revision: state.revision + 1, sales: [...state.sales, sale], ledger, stockMovements }, result: { status, sale } };
}
