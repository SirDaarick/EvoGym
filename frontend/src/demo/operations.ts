import type { DemoState, MembershipPayment, PaymentMethod } from '../domain/models';
import { plans } from './plans';

export interface PaymentRequest { id: string; memberId: string; planId: string; method: PaymentMethod }
export type PaymentResult = { status: 'paid' | 'pending'; payment: MembershipPayment } | { status: 'error'; message: string };
export interface Transaction<T> { state: DemoState; result: T }

export function collectMembership(state: DemoState, request: PaymentRequest): Transaction<PaymentResult> {
  const fail = (message: string): Transaction<PaymentResult> => ({ state, result: { status: 'error', message } });
  const existing = state.payments.find(payment => payment.id === request.id);
  if (existing) {
    if (existing.memberId !== request.memberId || existing.planId !== request.planId || existing.method !== request.method) return fail('La referencia ya pertenece a otra operación.');
    return { state, result: { status: existing.status, payment: existing } };
  }
  const member = state.members.find(item => item.id === request.memberId);
  const plan = plans.find(item => item.id === request.planId);
  if (!request.id || !member || !plan || plan.kind !== 'membership') return fail('Socio o plan no disponible. Revisa los datos.');
  if (plan.restriction) return fail(plan.restriction);
  if (!['cash', 'card', 'transfer'].includes(request.method)) return fail('Método no disponible.');
  if (!state.shifts.some(shift => shift.id === state.currentShiftId && shift.status === 'open')) return fail('Abre un turno antes de registrar el cobro.');
  const status = request.method === 'transfer' ? 'pending' : 'paid';
  const payment: MembershipPayment = { ...request, planName: plan.name, amountMinor: plan.amountMinor, status,
    recordedAt: new Date().toISOString(), shiftId: state.currentShiftId, effectiveDates: null };
  const ledger = status === 'paid' ? [...state.ledger, { id: `event-${request.id}`, paymentId: request.id,
    memberId: member.id, shiftId: state.currentShiftId, kind: 'membership' as const,
    amountMinor: plan.amountMinor, method: request.method as 'cash' | 'card', recordedAt: payment.recordedAt }] : state.ledger;
  return { state: { ...state, revision: state.revision + 1, payments: [...state.payments, payment], ledger,
    members: status === 'paid' ? state.members.map(item => item.id === member.id ? { ...item, lastPaymentId: payment.id } : item) : state.members },
    result: { status, payment } };
}

export function confirmedCollections(state: DemoState, shiftId: string) {
  return state.ledger.filter(event => event.shiftId === shiftId).reduce((total, event) => total + event.amountMinor, 0);
}

export function addMember(state: DemoState, id: string, name: string, phone: string): Transaction<{ id?: string; error?: string }> {
  if (!name.trim()) return { state, result: { error: 'Escribe el nombre del socio.' } };
  if (state.members.some(member => member.id === id)) return { state, result: { error: 'La referencia ya existe.' } };
  return { state: { ...state, revision: state.revision + 1, members: [...state.members,
    { id, name: name.trim(), phone: phone.trim(), creditMinor: 0, membership: null, joinedOn: state.demoClock.slice(0, 10) }] }, result: { id } };
}
