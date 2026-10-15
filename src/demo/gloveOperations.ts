import type { DemoState, GloveItem, GloveRentalRecord, LedgerEvent, PaymentMethod } from '../domain/models';
import type { Transaction } from './operations';

export interface GloveRentalRequest {
  id: string;
  gloveId: string;
  memberId: string;
  method: PaymentMethod;
}

export type GloveRentalResult =
  | { status: 'paid' | 'pending'; glove: GloveItem; rental: GloveRentalRecord }
  | { status: 'returned'; glove: GloveItem; rental?: GloveRentalRecord }
  | { status: 'error'; message: string };

export function rentGlove(
  state: DemoState,
  request: GloveRentalRequest
): Transaction<GloveRentalResult> {
  const fail = (message: string): Transaction<GloveRentalResult> => ({
    state,
    result: { status: 'error', message },
  });

  if (!request.id?.trim()) {
    return fail('Referencia de renta no válida.');
  }

  const openShift = state.shifts.find(s => s.id === state.currentShiftId && s.status === 'open');
  if (!openShift) {
    return fail('Abre un turno antes de registrar una renta.');
  }

  const rentals = state.gloveRentals ?? [];
  const existingRental = rentals.find(r => r.id === request.id);
  if (existingRental) {
    const glove = (state.gloves ?? []).find(g => g.id === existingRental.gloveId);
    if (glove && existingRental.memberId === request.memberId && existingRental.method === request.method) {
      return { state, result: { status: existingRental.status, glove, rental: existingRental } };
    }
    return fail('La referencia ya pertenece a otra operación.');
  }

  const gloves = state.gloves ?? [];
  const glove = gloves.find(g => g.id === request.gloveId);
  if (!glove) {
    return fail('Guante no encontrado.');
  }
  if (glove.status !== 'available') {
    return fail('El guante no está disponible para renta.');
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

  const rental: GloveRentalRecord = {
    id: request.id,
    gloveId: glove.id,
    memberId: member.id,
    memberName: member.name,
    shiftId: state.currentShiftId,
    priceMinor: glove.priceMinor,
    method: request.method,
    status,
    rentedAt,
    returnedAt: null,
  };

  const updatedGlove: GloveItem = {
    ...glove,
    status: 'rented',
    assignedMemberId: member.id,
    assignedMemberName: member.name,
    assignedAt: rentedAt,
    paymentMethod: request.method,
    paymentStatus: status,
  };

  const ledgerEvents: LedgerEvent[] = status === 'paid' ? [
    {
      id: `glove-event-${request.id}`,
      paymentId: request.id,
      memberId: member.id,
      shiftId: state.currentShiftId,
      kind: 'product',
      amountMinor: glove.priceMinor,
      method: request.method as 'cash' | 'card',
      recordedAt: rentedAt,
    },
  ] : [];

  const updatedGloves = gloves.map(g => (g.id === glove.id ? updatedGlove : g));
  const updatedRentals = [...rentals, rental];

  return {
    state: {
      ...state,
      revision: state.revision + 1,
      gloves: updatedGloves,
      gloveRentals: updatedRentals,
      ledger: [...state.ledger, ...ledgerEvents],
    },
    result: {
      status,
      glove: updatedGlove,
      rental,
    },
  };
}

export function returnGlove(
  state: DemoState,
  gloveId: string
): Transaction<GloveRentalResult> {
  const fail = (message: string): Transaction<GloveRentalResult> => ({
    state,
    result: { status: 'error', message },
  });

  const gloves = state.gloves ?? [];
  const glove = gloves.find(g => g.id === gloveId);
  if (!glove) {
    return fail('Guante no encontrado.');
  }
  if (glove.status !== 'rented') {
    return fail('El guante no se encuentra rentado.');
  }

  const rentals = state.gloveRentals ?? [];
  const activeRental = rentals.find(r => r.gloveId === gloveId && !r.returnedAt);
  const returnedAt = new Date().toISOString();
  let updatedRental: GloveRentalRecord | undefined;

  const updatedRentals = rentals.map(r => {
    if (r.id === activeRental?.id) {
      updatedRental = { ...r, returnedAt };
      return updatedRental;
    }
    return r;
  });

  const updatedGlove: GloveItem = {
    ...glove,
    status: 'available',
    assignedMemberId: null,
    assignedMemberName: null,
    assignedAt: null,
    paymentMethod: null,
    paymentStatus: null,
  };

  const updatedGloves = gloves.map(g => (g.id === glove.id ? updatedGlove : g));

  return {
    state: {
      ...state,
      revision: state.revision + 1,
      gloves: updatedGloves,
      gloveRentals: updatedRentals,
    },
    result: {
      status: 'returned',
      glove: updatedGlove,
      rental: updatedRental,
    },
  };
}
