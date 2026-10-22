import type { DemoState } from '../domain/models';
import type { Transaction } from './operations';

export type OperationResult = { status: 'ok' } | { status: 'error'; message: string };
export function activeShift(state: DemoState) {
  return state.shifts.find(shift => shift.id === state.currentShiftId && shift.status === 'open');
}
export function stockBreakdown(state: DemoState, productId: string) {
  const product = state.products.find(item => item.id === productId);
  const movements = state.stockMovements.filter(item => item.productId === productId);
  const quantity = (kind: 'restock' | 'sale' | 'waste') => movements.filter(item => item.kind === kind).reduce((sum, item) => sum + item.quantity, 0);
  const opening = product?.openingQuantity ?? 0;
  const restocked = quantity('restock');
  const sold = quantity('sale');
  const waste = quantity('waste');
  return { opening, restocked, sold, waste, expected: opening + restocked - sold - waste };
}
export function expectedStock(state: DemoState, productId: string) {
  return stockBreakdown(state, productId).expected;
}
export function currentShiftStockBreakdown(state: DemoState, productId: string) {
  const movements = state.stockMovements.filter(item => item.productId === productId && item.shiftId === state.currentShiftId);
  const quantity = (kind: 'restock' | 'sale' | 'waste') => movements.filter(item => item.kind === kind).reduce((sum, item) => sum + item.quantity, 0);
  const restocked = quantity('restock');
  const sold = quantity('sale');
  const waste = quantity('waste');
  const expected = expectedStock(state, productId);
  // Carry prior activity as an expected opening balance, not as visible historical movement totals.
  const opening = expected - restocked + sold + waste;
  return { opening, restocked, sold, waste, expected };
}
export function recordMovement(state: DemoState, request: { id: string; productId: string; kind: 'restock' | 'waste'; quantity: number; reason?: string }): Transaction<OperationResult> {
  const fail = (message: string): Transaction<OperationResult> => ({ state, result: { status: 'error', message } });
  const existing = state.stockMovements.find(item => item.id === request.id);
  if (existing) return existing.productId === request.productId && existing.kind === request.kind && existing.quantity === request.quantity
    ? { state, result: { status: 'ok' } } : fail('La referencia pertenece a otro movimiento.');
  if (!activeShift(state)) return fail('Abre un turno antes de registrar movimientos.');
  if (!request.id || !state.products.some(item => item.id === request.productId) || !['restock', 'waste'].includes(request.kind)) return fail('Producto o movimiento no disponible.');
  if (!Number.isSafeInteger(request.quantity) || request.quantity <= 0) return fail('La cantidad debe ser un entero positivo.');
  if (request.kind === 'waste' && request.quantity > expectedStock(state, request.productId)) return fail('La merma supera la existencia esperada.');
  if (!Number.isSafeInteger(expectedStock(state, request.productId) + request.quantity)) return fail('La cantidad excede el límite permitido.');
  return { state: { ...state, revision: state.revision + 1, stockMovements: [...state.stockMovements,
    { ...request, shiftId: state.currentShiftId, recordedAt: new Date().toISOString() }] }, result: { status: 'ok' } };
}
export function recordCount(state: DemoState, request: { id: string; productId: string; quantity: number }): Transaction<OperationResult> {
  const fail = (message: string): Transaction<OperationResult> => ({ state, result: { status: 'error', message } });
  const existing = state.counts.find(item => item.id === request.id);
  if (existing) return existing.productId === request.productId && existing.quantity === request.quantity
    ? { state, result: { status: 'ok' } } : fail('La referencia pertenece a otro conteo.');
  if (!activeShift(state) || !state.products.some(item => item.id === request.productId)) return fail('Se requiere producto y turno abierto.');
  if (!request.id || !Number.isSafeInteger(request.quantity) || request.quantity < 0) return fail('El conteo debe ser un entero igual o mayor que cero.');
  const expectedAtCount = expectedStock(state, request.productId);
  return { state: { ...state, revision: state.revision + 1, counts: [...state.counts,
    { ...request, shiftId: state.currentShiftId, expectedAtCount, variance: request.quantity - expectedAtCount, recordedAt: new Date().toISOString() }] }, result: { status: 'ok' } };
}
