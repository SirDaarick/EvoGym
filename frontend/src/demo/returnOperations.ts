import type {
  DemoState,
  GloveItem,
  GloveRentalRecord,
  LedgerEvent,
  LockerItem,
  LockerRentalRecord,
  MembershipPayment,
  PaymentMethod,
  Sale,
  StockMovement,
  SupplementProduct,
  SupplementSale,
} from '../domain/models';
import { activeShift, type OperationResult } from './inventoryOperations';
import type { Transaction } from './operations';
import { localDateKey } from './ownerOperations';

export type ReturnTargetType = 'product' | 'supplement' | 'membership' | 'locker' | 'glove';

export interface EligibleReturnItem {
  id: string;
  type: ReturnTargetType;
  title: string;
  detail: string;
  amountMinor: number;
  originalMethod: PaymentMethod;
  recordedAt: string;
}

export interface ReturnRequest {
  id: string;
  targetType: ReturnTargetType;
  targetId: string;
  memberId: string;
  reason: string;
  refundMethod?: 'cash' | 'card';
}

export type ReturnOperationResult =
  | { status: 'ok'; message: string; refundedAmountMinor: number }
  | { status: 'error'; message: string };

export function isSameDay(dateStrA: string, dateStrB: string): boolean {
  try {
    return localDateKey(dateStrA) === localDateKey(dateStrB);
  } catch {
    return false;
  }
}

export function getEligibleReturnsForMember(state: DemoState, memberId: string): EligibleReturnItem[] {
  const items: EligibleReturnItem[] = [];
  const refDate = state.demoClock || new Date().toISOString();

  // 1. Products sold today to this member
  for (const sale of state.sales ?? []) {
    if (
      sale.memberId === memberId &&
      sale.kind === 'product' &&
      sale.status === 'confirmed' &&
      !sale.refundedAt &&
      isSameDay(sale.recordedAt, refDate)
    ) {
      items.push({
        id: sale.id,
        type: 'product',
        title: sale.description,
        detail: `${sale.quantity} ${sale.quantity === 1 ? 'unidad' : 'unidades'} · Venta del día`,
        amountMinor: sale.amountMinor,
        originalMethod: sale.method,
        recordedAt: sale.recordedAt,
      });
    }
  }

  // 2. Supplements sold today to this member
  for (const sup of state.supplementSales ?? []) {
    if (
      sup.memberId === memberId &&
      sup.status === 'confirmed' &&
      !sup.refundedAt &&
      isSameDay(sup.recordedAt, refDate)
    ) {
      items.push({
        id: sup.id,
        type: 'supplement',
        title: `Suplemento: ${sup.name}`,
        detail: `${sup.scoops} ${sup.scoops === 1 ? 'porción' : 'porciones'} · Venta del día`,
        amountMinor: sup.amountMinor,
        originalMethod: sup.method,
        recordedAt: sup.recordedAt,
      });
    }
  }

  // 3. Active Membership
  const member = state.members.find(m => m.id === memberId);
  if (member?.membership) {
    // Find active membership payment
    const activePayment = [...(state.payments ?? [])]
      .filter(p => p.memberId === memberId && p.status === 'paid' && !p.refundedAt)
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];

    if (activePayment) {
      items.push({
        id: activePayment.id,
        type: 'membership',
        title: `Membresía: ${member.membership.planName}`,
        detail: `Vigencia: ${member.membership.startsOn} al ${member.membership.endsOn}`,
        amountMinor: activePayment.amountMinor,
        originalMethod: activePayment.method,
        recordedAt: activePayment.recordedAt,
      });
    }
  }

  // 4. Active Lockers
  for (const locker of state.lockers ?? []) {
    if (locker.assignedMemberId === memberId && locker.status === 'assigned') {
      const activeRental = [...(state.lockerRentals ?? [])]
        .filter(r => r.lockerId === locker.id && r.memberId === memberId && !r.releasedAt)
        .sort((a, b) => b.rentedAt.localeCompare(a.rentedAt))[0];

      items.push({
        id: locker.id,
        type: 'locker',
        title: `Casillero ${locker.code}`,
        detail: `Asignado desde ${locker.assignedAt ? locker.assignedAt.slice(0, 10) : 'hoy'} · Vence ${locker.expiresAt ? locker.expiresAt.slice(0, 10) : 'próximamente'}`,
        amountMinor: activeRental ? activeRental.priceMinor : locker.monthlyPriceMinor,
        originalMethod: activeRental ? activeRental.method : 'cash',
        recordedAt: activeRental ? activeRental.rentedAt : (locker.assignedAt || refDate),
      });
    }
  }

  // 5. Active Gloves
  for (const glove of state.gloves ?? []) {
    if (glove.assignedMemberId === memberId && glove.status === 'rented') {
      const activeRental = [...(state.gloveRentals ?? [])]
        .filter(r => r.gloveId === glove.id && r.memberId === memberId && !r.returnedAt)
        .sort((a, b) => b.rentedAt.localeCompare(a.rentedAt))[0];

      items.push({
        id: glove.id,
        type: 'glove',
        title: `Renta de Guantes ${glove.code} (${glove.color}, ${glove.ounces}oz)`,
        detail: `Renta activa desde ${glove.assignedAt ? glove.assignedAt.slice(0, 10) : 'hoy'}`,
        amountMinor: activeRental ? activeRental.priceMinor : glove.priceMinor,
        originalMethod: activeRental ? activeRental.method : 'cash',
        recordedAt: activeRental ? activeRental.rentedAt : (glove.assignedAt || refDate),
      });
    }
  }

  return items;
}

export function processReturn(
  state: DemoState,
  request: ReturnRequest
): Transaction<ReturnOperationResult> {
  const fail = (message: string): Transaction<ReturnOperationResult> => ({
    state,
    result: { status: 'error', message },
  });

  if (!request.id?.trim()) return fail('Referencia de devolución no válida.');
  if (!request.reason?.trim()) return fail('Escribe el motivo o justificación de la devolución.');
  if (!activeShift(state)) return fail('Abre un turno antes de procesar una devolución.');

  const member = state.members.find(m => m.id === request.memberId);
  if (!member) return fail('Socio no encontrado.');

  const now = new Date().toISOString();
  const shiftId = state.currentShiftId;
  const reasonText = request.reason.trim();

  let refundedAmountMinor = 0;
  let paymentMethodToRefund: 'cash' | 'card' = request.refundMethod ?? 'cash';
  let successMessage = '';

  let newSales = [...(state.sales ?? [])];
  let newSupplements = [...(state.supplements ?? [])];
  let newSupplementSales = [...(state.supplementSales ?? [])];
  let newPayments = [...(state.payments ?? [])];
  let newMembers = [...(state.members ?? [])];
  let newLockers = [...(state.lockers ?? [])];
  let newLockerRentals = [...(state.lockerRentals ?? [])];
  let newGloves = [...(state.gloves ?? [])];
  let newGloveRentals = [...(state.gloveRentals ?? [])];
  let newStockMovements = [...(state.stockMovements ?? [])];
  let newLedger = [...(state.ledger ?? [])];

  switch (request.targetType) {
    case 'product': {
      const saleIndex = newSales.findIndex(s => s.id === request.targetId);
      if (saleIndex === -1) return fail('Venta de producto no encontrada.');
      const sale = newSales[saleIndex];
      if (sale.refundedAt) return fail('Esta venta ya fue devuelta.');
      if (sale.kind !== 'product' || !sale.productId) return fail('El ítem no corresponde a un producto devuelto.');

      refundedAmountMinor = sale.amountMinor;
      if (!request.refundMethod) {
        paymentMethodToRefund = sale.method === 'transfer' ? 'cash' : (sale.method as 'cash' | 'card');
      }

      // Mark sale as refunded
      newSales[saleIndex] = {
        ...sale,
        refundedAt: now,
        refundReason: reasonText,
      };

      // Restore stock via restock movement
      const restockMovement: StockMovement = {
        id: `return-stock-${request.id}`,
        productId: sale.productId,
        shiftId,
        kind: 'restock',
        quantity: sale.quantity,
        reason: `Devolución socio ${member.name}: ${reasonText}`,
        recordedAt: now,
      };
      newStockMovements.push(restockMovement);

      // Ledger event (negative)
      const ledgerEvent: LedgerEvent = {
        id: `refund-event-${request.id}`,
        paymentId: sale.id,
        memberId: member.id,
        shiftId,
        kind: 'product',
        amountMinor: -refundedAmountMinor,
        method: paymentMethodToRefund,
        recordedAt: now,
      };
      newLedger.push(ledgerEvent);

      successMessage = `Devolución procesada: ${sale.description} reintegrado al inventario (${sale.quantity} uds).`;
      break;
    }

    case 'supplement': {
      const supIndex = newSupplementSales.findIndex(s => s.id === request.targetId);
      if (supIndex === -1) return fail('Venta de suplemento no encontrada.');
      const supSale = newSupplementSales[supIndex];
      if (supSale.refundedAt) return fail('Esta venta de suplemento ya fue devuelta.');

      refundedAmountMinor = supSale.amountMinor;
      if (!request.refundMethod) {
        paymentMethodToRefund = supSale.method === 'transfer' ? 'cash' : (supSale.method as 'cash' | 'card');
      }

      // Mark sale as refunded
      newSupplementSales[supIndex] = {
        ...supSale,
        refundedAt: now,
        refundReason: reasonText,
      };

      // Restore scoops
      newSupplements = newSupplements.map(s =>
        s.id === supSale.supplementId
          ? { ...s, availableScoops: s.availableScoops + supSale.scoops }
          : s
      );

      // Ledger event (negative)
      const ledgerEvent: LedgerEvent = {
        id: `refund-event-${request.id}`,
        paymentId: supSale.id,
        memberId: member.id,
        shiftId,
        kind: 'product',
        amountMinor: -refundedAmountMinor,
        method: paymentMethodToRefund,
        recordedAt: now,
      };
      newLedger.push(ledgerEvent);

      successMessage = `Devolución procesada: ${supSale.scoops} porción(es) de ${supSale.name} reincorporadas.`;
      break;
    }

    case 'membership': {
      const paymentIndex = newPayments.findIndex(p => p.id === request.targetId);
      if (paymentIndex === -1) return fail('Pago de membresía no encontrado.');
      const payment = newPayments[paymentIndex];
      if (payment.refundedAt) return fail('Este pago de membresía ya fue devuelto.');

      refundedAmountMinor = payment.amountMinor;
      if (!request.refundMethod) {
        paymentMethodToRefund = payment.method === 'transfer' ? 'cash' : (payment.method as 'cash' | 'card');
      }

      // Mark payment as refunded
      newPayments[paymentIndex] = {
        ...payment,
        refundedAt: now,
        refundReason: reasonText,
      };

      // Cancel member membership
      newMembers = newMembers.map(m =>
        m.id === member.id
          ? { ...m, membership: null, demoScenario: 'expired' }
          : m
      );

      // Ledger event (negative)
      const ledgerEvent: LedgerEvent = {
        id: `refund-event-${request.id}`,
        paymentId: payment.id,
        memberId: member.id,
        shiftId,
        kind: 'membership',
        amountMinor: -refundedAmountMinor,
        method: paymentMethodToRefund,
        recordedAt: now,
      };
      newLedger.push(ledgerEvent);

      successMessage = `Devolución de membresía procesada para ${member.name}. Membresía cancelada.`;
      break;
    }

    case 'locker': {
      const lockerIndex = newLockers.findIndex(l => l.id === request.targetId);
      if (lockerIndex === -1) return fail('Casillero no encontrado.');
      const locker = newLockers[lockerIndex];
      if (locker.status !== 'assigned') return fail('El casillero no está asignado.');

      const rentalIndex = newLockerRentals.findIndex(
        r => r.lockerId === locker.id && r.memberId === member.id && !r.releasedAt
      );
      const rental = rentalIndex !== -1 ? newLockerRentals[rentalIndex] : undefined;

      refundedAmountMinor = rental ? rental.priceMinor : locker.monthlyPriceMinor;
      if (!request.refundMethod) {
        paymentMethodToRefund = rental ? (rental.method === 'transfer' ? 'cash' : (rental.method as 'cash' | 'card')) : 'cash';
      }

      // Release locker
      newLockers[lockerIndex] = {
        ...locker,
        status: 'available',
        assignedMemberId: null,
        assignedMemberName: null,
        assignedAt: null,
        expiresAt: null,
        paymentMethod: null,
        paymentStatus: null,
      };

      if (rentalIndex !== -1 && rental) {
        newLockerRentals[rentalIndex] = {
          ...rental,
          releasedAt: now,
        };
      }

      // Ledger event (negative)
      const ledgerEvent: LedgerEvent = {
        id: `refund-event-${request.id}`,
        paymentId: rental?.id ?? locker.id,
        memberId: member.id,
        shiftId,
        kind: 'product',
        amountMinor: -refundedAmountMinor,
        method: paymentMethodToRefund,
        recordedAt: now,
      };
      newLedger.push(ledgerEvent);

      successMessage = `Devolución procesada: Casillero ${locker.code} liberado y disponible.`;
      break;
    }

    case 'glove': {
      const gloveIndex = newGloves.findIndex(g => g.id === request.targetId);
      if (gloveIndex === -1) return fail('Guante no encontrado.');
      const glove = newGloves[gloveIndex];
      if (glove.status !== 'rented') return fail('El guante no se encuentra rentado.');

      const rentalIndex = newGloveRentals.findIndex(
        r => r.gloveId === glove.id && r.memberId === member.id && !r.returnedAt
      );
      const rental = rentalIndex !== -1 ? newGloveRentals[rentalIndex] : undefined;

      refundedAmountMinor = rental ? rental.priceMinor : glove.priceMinor;
      if (!request.refundMethod) {
        paymentMethodToRefund = rental ? (rental.method === 'transfer' ? 'cash' : (rental.method as 'cash' | 'card')) : 'cash';
      }

      // Release glove
      newGloves[gloveIndex] = {
        ...glove,
        status: 'available',
        assignedMemberId: null,
        assignedMemberName: null,
        assignedAt: null,
        paymentMethod: null,
        paymentStatus: null,
      };

      if (rentalIndex !== -1 && rental) {
        newGloveRentals[rentalIndex] = {
          ...rental,
          returnedAt: now,
        };
      }

      // Ledger event (negative)
      const ledgerEvent: LedgerEvent = {
        id: `refund-event-${request.id}`,
        paymentId: rental?.id ?? glove.id,
        memberId: member.id,
        shiftId,
        kind: 'product',
        amountMinor: -refundedAmountMinor,
        method: paymentMethodToRefund,
        recordedAt: now,
      };
      newLedger.push(ledgerEvent);

      successMessage = `Devolución procesada: Guantes ${glove.code} liberados y disponibles.`;
      break;
    }

    default:
      return fail('Tipo de devolución no soportado.');
  }

  return {
    state: {
      ...state,
      revision: state.revision + 1,
      sales: newSales,
      supplements: newSupplements,
      supplementSales: newSupplementSales,
      payments: newPayments,
      members: newMembers,
      lockers: newLockers,
      lockerRentals: newLockerRentals,
      gloves: newGloves,
      gloveRentals: newGloveRentals,
      stockMovements: newStockMovements,
      ledger: newLedger,
    },
    result: {
      status: 'ok',
      message: successMessage,
      refundedAmountMinor,
    },
  };
}
