import type { DemoState, PaymentMethod, Sale, VisitArea } from '../domain/models';
import type { Transaction } from './operations';
import { getPlanList, snapshotPlan } from './plans';
import { activeShift } from './inventoryOperations';

export interface RegistrationConfirmations {
  cashReceived?: boolean;
  cardCollected?: boolean;
  transferVoucherSeen?: boolean;
  studentVerified?: boolean;
}
export interface NewMemberRegistrationRequest {
  id: string;
  kind: 'membership' | 'visit';
  planId: string;
  method: PaymentMethod;
  name?: string;
  phone?: string;
  email?: string;
  area?: VisitArea;
  confirmations?: RegistrationConfirmations;
}
export type RegistrationResult =
  | { status: 'confirmed' | 'pending'; memberId?: string; sale?: Sale; paymentId?: string; amountMinor: number }
  | { status: 'error'; message: string };

export function registerNewMember(state: DemoState, request: NewMemberRegistrationRequest): Transaction<RegistrationResult> {
  const fail = (message: string): Transaction<RegistrationResult> => ({ state, result: { status: 'error', message } });
  const plan = getPlanList().find(item => item.id === request.planId);
  if (!request.id || !plan || plan.active === false || plan.kind !== (request.kind === 'visit' ? 'visit' : 'membership')) return fail('Tipo o plan no disponible.');
  if (!['cash', 'card', 'transfer'].includes(request.method)) return fail('Método de pago no disponible.');
  const shift = activeShift(state);
  if (!shift) return fail('Abre un turno antes de registrar la operación.');
  if (request.kind === 'visit') {
    const expectedArea = request.planId === 'visit-combo' ? 'COMBO' : 'GYM';
    if (request.area !== expectedArea && !(request.planId === 'visit-single' && request.area === 'BOX')) return fail('El área no corresponde a la tarifa seleccionada.');
    const previous = state.sales.find(sale => sale.id === request.id);
    if (previous) return previous.kind === 'visit' && previous.area === request.area && previous.method === request.method
      ? { state, result: { status: previous.status === 'confirmed' ? 'confirmed' : 'pending', sale: previous, amountMinor: previous.amountMinor } }
      : fail('La referencia ya pertenece a otra operación.');
    const status = request.method === 'transfer' ? 'pending' : 'confirmed';
    const sale: Sale = { id: request.id, kind: 'visit', area: request.area, description: plan.name, quantity: 1,
      unitPriceMinor: plan.amountMinor, amountMinor: plan.amountMinor, method: request.method, status,
      shiftId: shift.id, recordedAt: new Date().toISOString() };
    const ledger = status === 'confirmed' ? [...state.ledger, { id: `sale-event-${request.id}`, paymentId: request.id,
      shiftId: shift.id, kind: 'visit' as const, amountMinor: plan.amountMinor, method: request.method as 'cash' | 'card', recordedAt: sale.recordedAt }] : state.ledger;
    return { state: { ...state, revision: state.revision + 1, sales: [...state.sales, sale], ledger }, result: { status, sale, amountMinor: plan.amountMinor } };
  }

  const name = request.name?.trim();
  if (!name) return fail('Escribe el nombre de la persona.');
  const studentPlan = request.planId.endsWith('-student');
  if (!studentPlan && plan.restriction) return fail(plan.restriction);
  const memberId = `member-${request.id}`;
  const previous = state.payments.find(payment => payment.id === request.id);
  if (previous) return previous.planId === request.planId && previous.method === request.method
    ? { state, result: { status: previous.status === 'paid' ? 'confirmed' : 'pending', memberId: previous.memberId, paymentId: previous.id, amountMinor: previous.amountMinor } }
    : fail('La referencia ya pertenece a otra operación.');
  if (state.members.some(member => member.id === memberId)) return fail('La referencia ya existe.');
  const pending = request.method === 'transfer';
  const member = { id: memberId, name, phone: request.phone?.trim() ?? '', ...(request.email?.trim() ? { email: request.email.trim() } : {}), creditMinor: 0, membership: null, joinedOn: state.demoClock.slice(0, 10) };
  const payment = { id: request.id, memberId, planId: plan.id, planName: plan.name, amountMinor: plan.amountMinor, planSnapshot: snapshotPlan(plan),
    method: request.method, status: pending ? 'pending' as const : 'paid' as const, recordedAt: new Date().toISOString(), shiftId: shift.id, effectiveDates: null };
  const ledger = pending ? state.ledger : [...state.ledger, { id: `event-${request.id}`, paymentId: request.id,
    memberId, shiftId: shift.id, kind: 'membership' as const, amountMinor: plan.amountMinor, method: request.method as 'cash' | 'card', recordedAt: payment.recordedAt }];
  return { state: { ...state, revision: state.revision + 1, members: [...state.members, member], payments: [...state.payments, payment], ledger },
    result: { status: pending ? 'pending' : 'confirmed', memberId, paymentId: payment.id, amountMinor: payment.amountMinor } };
}
