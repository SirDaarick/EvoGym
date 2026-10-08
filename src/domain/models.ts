export type Role = 'OWNER' | 'RECEPTION';
export type Money = number; // Integer MXN centavos; format only at presentation boundaries.

export interface Member {
  id: string;
  name: string;
  phone: string;
  creditMinor: Money;
  membership: { planName: string; startsOn: string; endsOn: string } | null;
  lastPaymentId?: string;
}

export type PaymentMethod = 'cash' | 'card' | 'transfer';
export interface MembershipPayment {
  id: string;
  memberId: string;
  planId: string;
  planName: string;
  amountMinor: Money;
  method: PaymentMethod;
  status: 'paid' | 'pending';
  recordedAt: string;
  shiftId: string;
  effectiveDates: null;
}
export interface LedgerEvent {
  id: string;
  paymentId: string;
  memberId: string;
  shiftId: string;
  kind: 'membership';
  amountMinor: Money;
  method: 'cash' | 'card';
  recordedAt: string;
}

export interface DemoState {
  members: Member[];
  revision: number;
  currentShiftId: string;
  payments: MembershipPayment[];
  ledger: LedgerEvent[];
}
