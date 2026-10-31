export type Role = 'OWNER' | 'RECEPTION';
export type Money = number; // Integer MXN centavos; format only at presentation boundaries.

export interface Member {
  id: string;
  name: string;
  phone: string;
  email?: string;
  creditMinor: Money;
  membership: { planName: string; startsOn: string; endsOn: string } | null;
  demoScenario?: 'active' | 'expired' | 'expiry-today' | 'unknown';
  lastPaymentId?: string;
  joinedOn?: string;
}

export type PaymentMethod = 'cash' | 'card' | 'transfer';
export type PlanService = 'gym' | 'box' | 'box-kids';
export interface PlanComposition {
  services: PlanService[];
  serviceStatus: 'confirmed' | 'pending';
  period: { value: number; unit: 'day' | 'week' | 'month' | 'year' | 'session'; expiryRule: 'calendar' | 'pending' };
  conditions: { eligibility: 'general' | 'student' | 'kids' | 'legacy' | 'custom'; notes: string };
}
export interface PurchasedPlanSnapshot {
  planId: string;
  revision: number;
  name: string;
  amountMinor: Money;
  referenceAmountMinor?: Money;
  applicability: string;
  restriction?: string;
  composition?: PlanComposition;
}
export interface MembershipPayment {
  id: string;
  memberId: string;
  planId: string;
  planName: string;
  amountMinor: Money;
  planSnapshot?: PurchasedPlanSnapshot;
  method: PaymentMethod;
  status: 'paid' | 'pending';
  recordedAt: string;
  shiftId: string;
  effectiveDates: null;
  refundedAt?: string;
  refundReason?: string;
}
export interface MemberNote {
  id: string; memberId: string; body: string; authorId: string; authorName: string; createdAt: string;
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
export interface CashDenominationCount { valueMinor: Money; quantity: number; }
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
  cashDenominations?: CashDenominationCount[];
  openingCashDenominations?: CashDenominationCount[];
  responsibleStaffId?: string;
  responsibleStaffName?: string;
  closingNotes?: string;
}
export interface Product {
  id: string;
  name: string;
  priceMinor: Money;
  openingQuantity: number;
  illustrative?: boolean;
  category?: string;
  costMinor?: Money;
  active?: boolean;
}
export interface StockMovement {
  id: string;
  productId: string;
  shiftId: string;
  kind: 'restock' | 'sale' | 'waste';
  quantity: number;
  reason?: string;
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
  cartId?: string;
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
  memberId?: string | null;
  memberName?: string | null;
  refundedAt?: string;
  refundReason?: string;
  isOvertime?: boolean;
  is_overtime?: boolean;
}

export interface DemoState {
  demoClock: string;
  attendancePolicy: { allowExpiryDay: boolean; allowRepeatVisits: boolean };
  attendance: AttendanceVisit[];
  members: Member[];
  revision: number;
  currentShiftId: string;
  payments: MembershipPayment[];
  memberNotes?: MemberNote[];
  ledger: LedgerEvent[];
  shifts: Shift[];
  products: Product[];
  stockMovements: StockMovement[];
  counts: PhysicalCount[];
  sales: Sale[];
  gloves?: GloveItem[];
  gloveRentals?: GloveRentalRecord[];
  lockers?: LockerItem[];
  lockerRentals?: LockerRentalRecord[];
  supplements?: SupplementProduct[];
  supplementSales?: SupplementSale[];
  expenses?: ExpenseRecord[];
  extras?: ExtraRecord[];
  staffAttendance?: StaffAttendanceRecord[];
}

export interface GloveItem {
  id: string; // e.g. 'glove-01'
  code: string; // e.g. '#01'
  color: string; // e.g. 'Rojo'
  ounces: number; // e.g. 12
  priceMinor: Money; // e.g. 2500 ($25.00 MXN)
  status: 'available' | 'rented';
  assignedMemberId?: string | null;
  assignedMemberName?: string | null;
  assignedAt?: string | null;
  paymentMethod?: PaymentMethod | null;
  paymentStatus?: 'paid' | 'pending' | null;
  rentalId?: string | null;
}

export interface GloveRentalRecord {
  id: string;
  gloveId: string;
  memberId: string;
  memberName: string;
  shiftId: string;
  priceMinor: Money;
  method: PaymentMethod;
  status: 'paid' | 'pending';
  rentedAt: string;
  returnedAt?: string | null;
}

export type LockerStatus = 'available' | 'assigned' | 'employee' | 'evicted' | 'out_of_service';

export interface LockerItem {
  id: string; // e.g. 'locker-01'
  number: number; // 1 to 42
  code: string; // e.g. '#01'
  status: LockerStatus;
  monthlyPriceMinor: Money;
  assignedMemberId?: string | null;
  assignedMemberName?: string | null;
  assignedAt?: string | null;
  expiresAt?: string | null;
  paymentMethod?: PaymentMethod | null;
  paymentStatus?: 'paid' | 'pending' | null;
  rentalId?: string | null;
}

export interface LockerRentalRecord {
  id: string;
  lockerId: string;
  memberId: string;
  memberName: string;
  shiftId: string;
  priceMinor: Money;
  method: PaymentMethod;
  status: 'paid' | 'pending';
  rentedAt: string;
  expiresAt: string;
  releasedAt?: string | null;
}

export interface SupplementProduct {
  id: string;
  name: string;
  flavor?: string;
  scoopPriceMinor: Money;
  availableScoops: number;
}

export interface SupplementSale {
  id: string;
  cartId?: string;
  supplementId: string;
  name: string;
  scoops: number;
  unitPriceMinor: Money;
  amountMinor: Money;
  memberId?: string | null;
  memberName?: string | null;
  method: PaymentMethod;
  status: 'confirmed' | 'pending';
  shiftId: string;
  recordedAt: string;
  refundedAt?: string;
  refundReason?: string;
}

export interface ExpenseRecord {
  id: string;
  concept: string;
  payeeName: string;
  amountMinor: Money;
  shiftId: string;
  recordedAt: string;
}

export interface ExtraRecord {
  id: string;
  concept: string;
  staffName: string;
  amountMinor: Money;
  shiftId: string;
  recordedAt: string;
}

export interface AttendanceVisit {
  id: string;
  memberId: string;
  observedCheckIn: string;
  observedCheckOut: string | null;
  autoClosedAt: string | null;
  illustrativeSeed?: true;
}

export interface StaffAttendanceRecord {
  id: string;
  staffId: string;
  staffName: string;
  roleOrDepartment?: string;
  clockInAt: string;
  clock_in_at?: string;
  clockOutAt?: string | null;
  clock_out_at?: string | null;
  recordedBy: string;
  recorded_by?: string;
  notes?: string;
  shiftId?: string;
}

