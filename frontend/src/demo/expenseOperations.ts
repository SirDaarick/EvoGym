import type { DemoState, ExpenseRecord, Money } from '../domain/models';
import type { Transaction } from './operations';

export interface ExpenseRequest {
  id: string;
  concept: string;
  payeeName: string;
  amountMinor: Money;
}

export type ExpenseResult =
  | { status: 'recorded'; expense: ExpenseRecord }
  | { status: 'error'; message: string };

export function registerExpense(
  state: DemoState,
  request: ExpenseRequest
): Transaction<ExpenseResult> {
  const fail = (message: string): Transaction<ExpenseResult> => ({
    state,
    result: { status: 'error', message },
  });

  if (!request.concept?.trim()) {
    return fail('Escribe el concepto del gasto.');
  }

  if (!request.payeeName?.trim()) {
    return fail('Escribe el nombre del proveedor o responsable.');
  }

  if (!Number.isSafeInteger(request.amountMinor) || request.amountMinor <= 0) {
    return fail('El monto del gasto debe ser mayor a $0.00.');
  }

  const openShift = state.shifts.find(s => s.id === state.currentShiftId && s.status === 'open');
  if (!openShift) {
    return fail('Abre un turno antes de registrar un gasto de caja.');
  }

  const recordedAt = new Date().toISOString();
  const expense: ExpenseRecord = {
    id: request.id,
    concept: request.concept.trim(),
    payeeName: request.payeeName.trim(),
    amountMinor: request.amountMinor,
    shiftId: state.currentShiftId,
    recordedAt,
  };

  return {
    state: {
      ...state,
      revision: state.revision + 1,
      expenses: [...(state.expenses ?? []), expense],
    },
    result: {
      status: 'recorded',
      expense,
    },
  };
}
