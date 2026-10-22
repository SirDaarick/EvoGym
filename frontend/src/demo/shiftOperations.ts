import type { CashDenominationCount, DemoState, PhysicalCount, Shift, ShiftWindow, StockMovement } from '../domain/models';
import { cashCountTotal } from './cashDenominations';
import type { Transaction } from './operations';
import { activeShift, expectedStock, type OperationResult } from './inventoryOperations';
import { shiftDashboard } from './shiftDashboard';

export interface OpenShiftRequest {
  id: string;
  window: ShiftWindow;
  openingCashMinor: number;
  cashDenominations?: CashDenominationCount[];
  openingCashDenominations?: CashDenominationCount[];
  responsibleStaffId?: string;
  responsibleStaffName?: string;
  stockAdjustments?: {
    productId: string;
    kind: 'restock' | 'waste';
    quantity: number;
    reason?: string;
  }[];
  counts?: {
    productId: string;
    quantity: number;
  }[];
}

export function shiftSummary(state: DemoState, shiftId: string) {
  const shift = state.shifts.find(item => item.id === shiftId);
  const events = state.ledger.filter(item => item.shiftId === shiftId);
  const rows = (['membership', 'product', 'visit'] as const).map(kind => ({
    kind,
    cash: events.filter(item => item.kind === kind && item.method === 'cash').reduce((sum, item) => sum + item.amountMinor, 0),
    card: events.filter(item => item.kind === kind && item.method === 'card').reduce((sum, item) => sum + item.amountMinor, 0),
    transferPending: kind === 'membership'
      ? state.payments.filter(item => item.shiftId === shiftId && item.status === 'pending').reduce((sum, item) => sum + item.amountMinor, 0)
      : state.sales.filter(item => item.shiftId === shiftId && item.kind === kind && item.status === 'pending').reduce((sum, item) => sum + item.amountMinor, 0),
  }));
  const cashMinor = rows.reduce((sum, row) => sum + row.cash, 0);
  const confirmedMinor = rows.reduce((sum, row) => sum + row.cash + row.card, 0);
  const dashboard = shift ? shiftDashboard(state, shiftId) : null;
  return { rows, cashMinor, confirmedMinor, expectedCashMinor: dashboard?.expectedCashMinor ?? (shift?.openingCashMinor ?? 0) + cashMinor };
}
export function closeShift(state: DemoState, countedCashMinor: number, denominations?: readonly CashDenominationCount[], closingNotes?: string): Transaction<OperationResult> {
  const shift = activeShift(state);
  if (!shift) return { state, result: { status: 'error', message: 'No hay un turno abierto para cerrar.' } };
  if (!Number.isSafeInteger(countedCashMinor) || countedCashMinor < 0) return { state, result: { status: 'error', message: 'Revisa el efectivo contado.' } };
  if (denominations && cashCountTotal(denominations) !== countedCashMinor) return { state, result: { status: 'error', message: 'Revisa las cantidades y el total por denominación.' } };
  const expectedCashAtCloseMinor = shiftSummary(state, shift.id).expectedCashMinor;
  return { state: { ...state, revision: state.revision + 1, shifts: state.shifts.map(item => item.id === shift.id
    ? { ...item, status: 'closed', closedAt: new Date().toISOString(), countedCashMinor, expectedCashAtCloseMinor,
      cashDifferenceMinor: countedCashMinor - expectedCashAtCloseMinor,
      ...(denominations ? { cashDenominations: denominations.map(row => ({ ...row })) } : {}),
      ...(closingNotes?.trim() ? { closingNotes: closingNotes.trim() } : {}) } : item) }, result: { status: 'ok' } };
}
export function openShift(state: DemoState, request: OpenShiftRequest): Transaction<OperationResult> {
  const fail = (message: string): Transaction<OperationResult> => ({ state, result: { status: 'error', message } });
  if (state.shifts.some(item => item.status === 'open')) return fail('Ya existe un turno abierto.');
  if (!request.id || state.shifts.some(item => item.id === request.id)) return fail('Referencia de turno no disponible.');
  if (!['06:00–14:00', '14:00–22:00'].includes(request.window) || !Number.isSafeInteger(request.openingCashMinor) || request.openingCashMinor < 0) return fail('Revisa horario y fondo inicial.');

  const now = new Date().toISOString();
  const createdMovements: StockMovement[] = (request.stockAdjustments ?? []).map((adj, index) => ({
    id: `adj-open-${request.id}-${index}-${crypto.randomUUID().slice(0, 8)}`,
    productId: adj.productId,
    shiftId: request.id,
    kind: adj.kind,
    quantity: adj.quantity,
    reason: adj.reason?.trim() || 'Ajuste inicial al abrir turno',
    recordedAt: now,
  }));

  const createdCounts: PhysicalCount[] = (request.counts ?? []).map((cnt, index) => {
    const exp = expectedStock(state, cnt.productId);
    return {
      id: `cnt-open-${request.id}-${index}-${crypto.randomUUID().slice(0, 8)}`,
      productId: cnt.productId,
      shiftId: request.id,
      quantity: cnt.quantity,
      expectedAtCount: exp,
      variance: cnt.quantity - exp,
      recordedAt: now,
    };
  });

  const denominations = request.openingCashDenominations ?? request.cashDenominations;

  const newShift: Shift = {
    id: request.id,
    window: request.window,
    openingCashMinor: request.openingCashMinor,
    status: 'open',
    openedAt: now,
    ...(denominations ? { openingCashDenominations: denominations, cashDenominations: denominations } : {}),
    ...(request.responsibleStaffId ? { responsibleStaffId: request.responsibleStaffId } : {}),
    ...(request.responsibleStaffName ? { responsibleStaffName: request.responsibleStaffName } : {}),
  };

  return {
    state: {
      ...state,
      revision: state.revision + 1,
      currentShiftId: request.id,
      shifts: [...state.shifts, newShift],
      stockMovements: createdMovements.length ? [...state.stockMovements, ...createdMovements] : state.stockMovements,
      counts: createdCounts.length ? [...state.counts, ...createdCounts] : state.counts,
    },
    result: { status: 'ok' },
  };
}
