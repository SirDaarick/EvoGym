import type { DemoState, PaymentMethod, Sale, VisitArea } from '../domain/models';
import type { Transaction } from './operations';
import { activeShift, expectedStock } from './inventoryOperations';

export type SaleRequest = { id: string; quantity: number; method: PaymentMethod } &
  ({ kind: 'product'; productId: string } | { kind: 'visit'; area: VisitArea });
export type SaleResult = { status: 'confirmed' | 'pending'; sale: Sale } | { status: 'error'; message: string };
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
