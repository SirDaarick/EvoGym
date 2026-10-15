import type { CashDenominationCount, DemoState, ShiftWindow } from '../domain/models';
import { cashCountTotal } from './cashDenominations';
import type { Transaction } from './operations';
import { activeShift, type OperationResult } from './inventoryOperations';
import { shiftDashboard } from './shiftDashboard';

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
export function openShift(state: DemoState, request: { id: string; window: ShiftWindow; openingCashMinor: number }): Transaction<OperationResult> {
  const fail = (message: string): Transaction<OperationResult> => ({ state, result: { status: 'error', message } });
  if (state.shifts.some(item => item.status === 'open')) return fail('Ya existe un turno abierto.');
  if (!request.id || state.shifts.some(item => item.id === request.id)) return fail('Referencia de turno no disponible.');
  if (!['06:00–14:00', '14:00–22:00'].includes(request.window) || !Number.isSafeInteger(request.openingCashMinor) || request.openingCashMinor < 0) return fail('Revisa horario y fondo inicial.');
  return { state: { ...state, revision: state.revision + 1, currentShiftId: request.id,
    shifts: [...state.shifts, { ...request, status: 'open', openedAt: new Date().toISOString() }] }, result: { status: 'ok' } };
}
