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
  memberId?: string;
  shiftId: string;
  kind: 'membership' | 'product' | 'visit';
  amountMinor: Money;
  method: 'cash' | 'card';
  recordedAt: string;
}

export type ShiftWindow = '06:00–14:00' | '14:00–22:00';
export interface Shift {
  id: string;
  window: ShiftWindow;
  openedAt: string;
  status: 'open' | 'closed';
  openingCashMinor: Money;
  closedAt?: string;
  countedCashMinor?: Money;
  expectedCashAtCloseMinor?: Money;
  cashDifferenceMinor?: Money;
}
export interface Product {
  id: string;
  name: string;
  priceMinor: Money;
  openingQuantity: number;
  illustrative: true;
}
export interface StockMovement {
  id: string;
  productId: string;
  shiftId: string;
  kind: 'restock' | 'sale' | 'waste';
  quantity: number;
  recordedAt: string;
}
export interface PhysicalCount {
  id: string;
  productId: string;
  shiftId: string;
  quantity: number;
  expectedAtCount: number;
  variance: number;
  recordedAt: string;
}
export type VisitArea = 'GYM' | 'BOX' | 'COMBO';
export interface Sale {
  id: string;
  kind: 'product' | 'visit';
  productId?: string;
  area?: VisitArea;
  description: string;
  quantity: number;
  unitPriceMinor: Money;
  amountMinor: Money;
  method: PaymentMethod;
  status: 'confirmed' | 'pending';
  shiftId: string;
  recordedAt: string;
}

export interface DemoState {
  members: Member[];
  revision: number;
  currentShiftId: string;
  payments: MembershipPayment[];
  ledger: LedgerEvent[];
  shifts: Shift[];
  products: Product[];
  stockMovements: StockMovement[];
  counts: PhysicalCount[];
  sales: Sale[];
}
