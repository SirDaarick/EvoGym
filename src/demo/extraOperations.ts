import type { DemoState, ExtraRecord, Money } from '../domain/models';
import type { Transaction } from './operations';

export interface ExtraRequest {
  id: string;
  concept: string;
  staffName: string;
  amountMinor: Money;
}

export type ExtraResult =
  | { status: 'recorded'; extra: ExtraRecord }
  | { status: 'error'; message: string };

export function registerExtra(
  state: DemoState,
  request: ExtraRequest
): Transaction<ExtraResult> {
  const fail = (message: string): Transaction<ExtraResult> => ({
    state,
    result: { status: 'error', message },
  });

  if (!request.concept?.trim()) {
    return fail('Escribe el concepto del extra.');
  }

  if (!request.staffName?.trim()) {
    return fail('Escribe el nombre de la recepcionista o responsable.');
  }

  if (!Number.isSafeInteger(request.amountMinor) || request.amountMinor <= 0) {
    return fail('El monto del extra debe ser mayor a $0.00.');
  }

  const openShift = state.shifts.find(s => s.id === state.currentShiftId && s.status === 'open');
  if (!openShift) {
    return fail('Abre un turno antes de registrar un extra de cambio.');
  }

  const recordedAt = new Date().toISOString();
  const extra: ExtraRecord = {
    id: request.id,
    concept: request.concept.trim(),
    staffName: request.staffName.trim(),
    amountMinor: request.amountMinor,
    shiftId: state.currentShiftId,
    recordedAt,
  };

  return {
    state: {
      ...state,
      revision: state.revision + 1,
      extras: [...(state.extras ?? []), extra],
    },
    result: {
      status: 'recorded',
      extra,
    },
  };
}
