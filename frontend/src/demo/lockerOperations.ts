import type { DemoState, LedgerEvent, LockerItem, LockerRentalRecord, LockerStatus, PaymentMethod } from '../domain/models';
import type { Transaction } from './operations';

export interface LockerAssignRequest {
  id: string;
  lockerId: string;
  memberId: string;
  method: PaymentMethod;
}

export type LockerOperationResult =
  | { status: 'paid' | 'pending'; locker: LockerItem; rental: LockerRentalRecord }
  | { status: 'released' | 'evicted' | 'updated'; locker: LockerItem; rental?: LockerRentalRecord }
  | { status: 'error'; message: string };

/**
 * Calculates 1 calendar month expiry, clamping to the last day of next month if day overflows.
 */
export function calculateNextMonthExpiry(fromDate: Date = new Date()): string {
  const year = fromDate.getFullYear();
  const month = fromDate.getMonth();
  const day = fromDate.getDate();
  const hours = fromDate.getHours();
  const minutes = fromDate.getMinutes();
  const seconds = fromDate.getSeconds();

  const nextMonth = month + 1;
  const targetYear = year + Math.floor(nextMonth / 12);
  const targetMonth = nextMonth % 12;

  // Find last day of target month
  const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);

  const expiry = new Date(targetYear, targetMonth, clampedDay, hours, minutes, seconds);
  return expiry.toISOString();
}

export function assignLocker(
  state: DemoState,
  request: LockerAssignRequest
): Transaction<LockerOperationResult> {
  const fail = (message: string): Transaction<LockerOperationResult> => ({
    state,
    result: { status: 'error', message },
  });

  if (!request.id?.trim()) {
    return fail('Referencia no válida.');
  }

  const openShift = state.shifts.find(s => s.id === state.currentShiftId && s.status === 'open');
  if (!openShift) {
    return fail('Abre un turno antes de asignar un casillero.');
  }

  const lockers = state.lockers ?? [];
  const locker = lockers.find(l => l.id === request.lockerId);
  if (!locker) {
    return fail('Casillero no encontrado.');
  }

  if (locker.status === 'out_of_service') {
    return fail('El casillero se encuentra fuera de servicio.');
  }

  if (locker.status === 'assigned' || locker.status === 'employee') {
    return fail('El casillero ya está asignado.');
  }

  const member = state.members.find(m => m.id === request.memberId);
  if (!member) {
    return fail('Socio no encontrado.');
  }

  if (!['cash', 'card', 'transfer'].includes(request.method)) {
    return fail('Método de pago no disponible.');
  }

  const status: 'paid' | 'pending' = request.method === 'transfer' ? 'pending' : 'paid';
  const rentedAt = new Date().toISOString();
  const expiresAt = calculateNextMonthExpiry(new Date());

  const rental: LockerRentalRecord = {
    id: request.id,
    lockerId: locker.id,
    memberId: member.id,
    memberName: member.name,
    shiftId: state.currentShiftId,
    priceMinor: locker.monthlyPriceMinor,
    method: request.method,
    status,
    rentedAt,
    expiresAt,
    releasedAt: null,
  };

  const updatedLocker: LockerItem = {
    ...locker,
    status: 'assigned',
    assignedMemberId: member.id,
    assignedMemberName: member.name,
    assignedAt: rentedAt,
    expiresAt,
    paymentMethod: request.method,
    paymentStatus: status,
  };

  const ledgerEvents: LedgerEvent[] = status === 'paid' ? [
    {
      id: `locker-event-${request.id}`,
      paymentId: request.id,
      memberId: member.id,
      shiftId: state.currentShiftId,
      kind: 'product',
      amountMinor: locker.monthlyPriceMinor,
      method: request.method as 'cash' | 'card',
      recordedAt: rentedAt,
    },
  ] : [];

  const updatedLockers = lockers.map(l => (l.id === locker.id ? updatedLocker : l));
  const updatedRentals = [...(state.lockerRentals ?? []), rental];

  return {
    state: {
      ...state,
      revision: state.revision + 1,
      lockers: updatedLockers,
      lockerRentals: updatedRentals,
      ledger: [...state.ledger, ...ledgerEvents],
    },
    result: {
      status,
      locker: updatedLocker,
      rental,
    },
  };
}

export function releaseLocker(
  state: DemoState,
  lockerId: string
): Transaction<LockerOperationResult> {
  const fail = (message: string): Transaction<LockerOperationResult> => ({
    state,
    result: { status: 'error', message },
  });

  const lockers = state.lockers ?? [];
  const locker = lockers.find(l => l.id === lockerId);
  if (!locker) {
    return fail('Casillero no encontrado.');
  }

  const rentals = state.lockerRentals ?? [];
  const activeRental = rentals.find(r => r.lockerId === lockerId && !r.releasedAt);
  const releasedAt = new Date().toISOString();
  let updatedRental: LockerRentalRecord | undefined;

  const updatedRentals = rentals.map(r => {
    if (r.id === activeRental?.id) {
      updatedRental = { ...r, releasedAt };
      return updatedRental;
    }
    return r;
  });

  const updatedLocker: LockerItem = {
    ...locker,
    status: 'available',
    assignedMemberId: null,
    assignedMemberName: null,
    assignedAt: null,
    expiresAt: null,
    paymentMethod: null,
    paymentStatus: null,
  };

  const updatedLockers = lockers.map(l => (l.id === locker.id ? updatedLocker : l));

  return {
    state: {
      ...state,
      revision: state.revision + 1,
      lockers: updatedLockers,
      lockerRentals: updatedRentals,
    },
    result: {
      status: 'released',
      locker: updatedLocker,
      rental: updatedRental,
    },
  };
}

export function evictLocker(
  state: DemoState,
  lockerId: string
): Transaction<LockerOperationResult> {
  const fail = (message: string): Transaction<LockerOperationResult> => ({
    state,
    result: { status: 'error', message },
  });

  const lockers = state.lockers ?? [];
  const locker = lockers.find(l => l.id === lockerId);
  if (!locker) {
    return fail('Casillero no encontrado.');
  }

  const updatedLocker: LockerItem = {
    ...locker,
    status: 'evicted',
    assignedMemberName: locker.assignedMemberName ? `Desalojado (Ex-socio: ${locker.assignedMemberName})` : 'Desalojado',
  };

  const updatedLockers = lockers.map(l => (l.id === locker.id ? updatedLocker : l));

  return {
    state: {
      ...state,
      revision: state.revision + 1,
      lockers: updatedLockers,
    },
    result: {
      status: 'evicted',
      locker: updatedLocker,
    },
  };
}

export function updateLockerStatus(
  state: DemoState,
  lockerId: string,
  newStatus: LockerStatus,
  customName?: string
): Transaction<LockerOperationResult> {
  const fail = (message: string): Transaction<LockerOperationResult> => ({
    state,
    result: { status: 'error', message },
  });

  const lockers = state.lockers ?? [];
  const locker = lockers.find(l => l.id === lockerId);
  if (!locker) {
    return fail('Casillero no encontrado.');
  }

  const updatedLocker: LockerItem = {
    ...locker,
    status: newStatus,
    assignedMemberName:
      newStatus === 'employee'
        ? (customName?.trim() || 'Staff EvoGym')
        : newStatus === 'available'
        ? null
        : locker.assignedMemberName,
    assignedMemberId: newStatus === 'available' ? null : locker.assignedMemberId,
    assignedAt: newStatus === 'available' ? null : locker.assignedAt,
    expiresAt: newStatus === 'available' ? null : locker.expiresAt,
  };

  const updatedLockers = lockers.map(l => (l.id === locker.id ? updatedLocker : l));

  return {
    state: {
      ...state,
      revision: state.revision + 1,
      lockers: updatedLockers,
    },
    result: {
      status: 'updated',
      locker: updatedLocker,
    },
  };
}
