import type { DemoState, LedgerEvent } from '../domain/models';

export type ShiftActivityFamily = 'membership' | 'product' | 'visit' | 'supplement' | 'glove' | 'locker';
export interface ShiftActivityRow {
  id: string;
  family: ShiftActivityFamily | 'expense' | 'extra' | 'stock' | 'count';
  description: string;
  actor?: string;
  reference?: string;
  method?: string;
  status: 'confirmed' | 'pending' | 'recorded';
  amountMinor?: number;
  cashImpactMinor?: number;
  quantity?: number;
  recordedAt: string;
  isOvertime?: boolean;
}
export interface ShiftInventoryRow {
  id: string;
  movement: 'Reposición' | 'Merma' | 'Conteo físico';
  product: string;
  quantity: string;
  recordedAt: string;
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const byShift = <T extends { shiftId: string }>(items: T[] | undefined, shiftId: string) => (items ?? []).filter(item => item.shiftId === shiftId);

export function shiftDashboard(state: DemoState, shiftId: string) {
  const shift = state.shifts.find(item => item.id === shiftId);
  if (!shift) return null;

  const events = state.ledger.filter(item => item.shiftId === shiftId);
  const sales = byShift(state.sales, shiftId);
  const supplements = byShift(state.supplementSales, shiftId);
  const gloves = byShift(state.gloveRentals, shiftId);
  const lockers = byShift(state.lockerRentals, shiftId);
  const membership = byShift(state.payments, shiftId);
  const salesById = new Map(sales.map(item => [`sale:${item.id}`, item]));
  const supplementById = new Map(supplements.map(item => [`supplement:${item.id}`, item]));
  const gloveById = new Map(gloves.map(item => [`glove:${item.id}`, item]));
  const lockerById = new Map(lockers.map(item => [`locker:${item.id}`, item]));
  const paymentById = new Map(membership.map(item => [`membership:${item.id}`, item]));
  const familyForEvent = (event: LedgerEvent): ShiftActivityFamily => event.kind === 'membership' ? 'membership' : event.kind === 'visit' ? 'visit'
    : event.id.startsWith('sale-event-') ? 'product'
      : event.id.startsWith('sup-event-') ? 'supplement'
      : event.id.startsWith('glove-event-') ? 'glove'
        : event.id.startsWith('locker-event-') ? 'locker'
          : supplementById.has(`supplement:${event.paymentId}`) ? 'supplement'
            : gloveById.has(`glove:${event.paymentId}`) ? 'glove'
              : lockerById.has(`locker:${event.paymentId}`) ? 'locker' : 'product';
  const rows: ShiftActivityRow[] = events.map((event: LedgerEvent) => {
    const memberName = event.memberId ? state.members.find(member => member.id === event.memberId)?.name : undefined;
    const family = familyForEvent(event);
    const source = family === 'membership' ? paymentById.get(`membership:${event.paymentId}`)
      : family === 'supplement' ? supplementById.get(`supplement:${event.paymentId}`)
        : family === 'glove' ? gloveById.get(`glove:${event.paymentId}`)
          : family === 'locker' ? lockerById.get(`locker:${event.paymentId}`) : salesById.get(`sale:${event.paymentId}`);
    const sourceDescription = source && 'description' in source ? source.description : undefined;
    const planName = source && 'planName' in source ? source.planName : undefined;
    const specializedName = source && 'name' in source ? source.name : undefined;
    const sourceMemberName = source && 'memberName' in source ? source.memberName ?? undefined : undefined;
    const baseDescription = sourceDescription ?? specializedName ?? (family === 'membership' ? (planName ?? 'Membresía') : family === 'visit' ? 'Visita'
      : family === 'glove' ? 'Renta de guante' : family === 'locker' ? 'Asignación de casillero' : 'Producto');
    const isRefund = event.amountMinor < 0 || event.id.startsWith('refund-');
    const description = isRefund ? `Devolución: ${baseDescription}` : baseDescription;
    const isOvertime = Boolean(
      source &&
      typeof source === 'object' &&
      (('isOvertime' in source && source.isOvertime) || ('is_overtime' in source && source.is_overtime))
    );
    return { id: `ledger:${event.id}`, family, description, actor: memberName ?? sourceMemberName, reference: event.paymentId,
      method: event.method, status: 'confirmed', amountMinor: event.amountMinor, cashImpactMinor: event.method === 'cash' ? event.amountMinor : 0, recordedAt: event.recordedAt, isOvertime };
  });
  const productName = (productId: string) => state.products.find(item => item.id === productId)?.name ?? 'Producto';
  const inventoryRows: ShiftInventoryRow[] = [
    ...byShift(state.stockMovements, shiftId).filter(item => item.kind !== 'sale').map(item => ({
      id: `stock:${item.id}`, movement: item.kind === 'restock' ? 'Reposición' as const : 'Merma' as const,
      product: productName(item.productId),
      quantity: item.reason ? `${item.quantity} unidades (${item.reason})` : `${item.quantity} unidades`,
      recordedAt: item.recordedAt,
    })),
    ...byShift(state.counts, shiftId).map(item => ({ id: `count:${item.id}`, movement: 'Conteo físico' as const,
      product: productName(item.productId), quantity: `${item.quantity} unidades · esperado ${item.expectedAtCount} · diferencia ${item.variance}`,
      recordedAt: item.recordedAt })),
  ].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));

  for (const sale of sales) if (sale.status === 'pending') rows.push({ id: `sale:${sale.id}`, family: sale.kind,
    description: sale.description, reference: sale.id, status: 'pending', method: sale.method,
    amountMinor: sale.amountMinor, cashImpactMinor: 0, quantity: sale.quantity, recordedAt: sale.recordedAt });
  for (const payment of membership) if (payment.status === 'pending') rows.push({ id: `payment:${payment.id}`, family: 'membership',
    description: payment.planName, actor: state.members.find(member => member.id === payment.memberId)?.name, reference: payment.id,
    status: 'pending', method: payment.method, amountMinor: payment.amountMinor, cashImpactMinor: 0, recordedAt: payment.recordedAt });
  for (const item of supplements) if (item.status === 'pending') rows.push({ id: `supplement:${item.id}`, family: 'supplement', description: item.name,
    actor: item.memberName ?? undefined, reference: item.id, status: 'pending', method: item.method, amountMinor: item.amountMinor, cashImpactMinor: 0, quantity: item.scoops, recordedAt: item.recordedAt });
  for (const item of gloves) if (item.status === 'pending') rows.push({ id: `glove:${item.id}`, family: 'glove', description: 'Renta de guante', actor: item.memberName,
    reference: item.id, status: 'pending', method: item.method, amountMinor: item.priceMinor, cashImpactMinor: 0, recordedAt: item.rentedAt });
  for (const item of lockers) if (item.status === 'pending') rows.push({ id: `locker:${item.id}`, family: 'locker', description: 'Asignación de casillero', actor: item.memberName,
    reference: item.id, status: 'pending', method: item.method, amountMinor: item.priceMinor, cashImpactMinor: 0, recordedAt: item.rentedAt });
  for (const item of byShift(state.expenses, shiftId)) rows.push({ id: `expense:${item.id}`, family: 'expense', description: item.concept, actor: item.payeeName,
    reference: item.id, status: 'recorded', amountMinor: -item.amountMinor, cashImpactMinor: -item.amountMinor, recordedAt: item.recordedAt });
  for (const item of byShift(state.extras, shiftId)) rows.push({ id: `extra:${item.id}`, family: 'extra', description: item.concept, actor: item.staffName,
    reference: item.id, status: 'recorded', amountMinor: item.amountMinor, cashImpactMinor: item.amountMinor, recordedAt: item.recordedAt });

  const activities = (['membership', 'product', 'visit', 'supplement', 'glove', 'locker'] as const).map(family => {
    const familyEvents = events.filter(event => familyForEvent(event) === family);
    const sourceByPayment = new Map<string, string>();
    if (family === 'membership') membership.forEach(item => sourceByPayment.set(`membership:${item.id}`, item.id));
    if (family === 'product' || family === 'visit') sales.filter(item => item.kind === family).forEach(item => sourceByPayment.set(`${family}:${item.id}`, item.cartId ? `${family}:cart:${item.cartId}` : `${family}:${item.id}`));
    if (family === 'supplement') supplements.forEach(item => sourceByPayment.set(`supplement:${item.id}`, `supplement:cart:${item.cartId ?? item.id}`));
    if (family === 'glove') gloves.forEach(item => sourceByPayment.set(`glove:${item.id}`, `glove:${item.id}`));
    if (family === 'locker') lockers.forEach(item => sourceByPayment.set(`locker:${item.id}`, `locker:${item.id}`));
    const operationIds = new Set(familyEvents.map(event => sourceByPayment.get(`${family}:${event.paymentId}`) ?? `${family}:${event.paymentId}`));
    return { family, count: operationIds.size, amountMinor: sum(familyEvents.map(event => event.amountMinor)) };
  });
  const cashMinor = sum(events.filter(event => event.method === 'cash').map(event => event.amountMinor));
  const confirmedMinor = sum(events.map(event => event.amountMinor));
  const expenseMinor = sum(byShift(state.expenses, shiftId).map(item => item.amountMinor));
  const extraMinor = sum(byShift(state.extras, shiftId).map(item => item.amountMinor));
  const expenseCount = byShift(state.expenses, shiftId).length;
  const expectedCashMinor = shift.openingCashMinor + cashMinor + extraMinor - expenseMinor;
  const pendingTransferMinor = sum([
    ...membership.filter(item => item.status === 'pending' && item.method === 'transfer').map(item => item.amountMinor),
    ...sales.filter(item => item.status === 'pending' && item.method === 'transfer').map(item => item.amountMinor),
    ...supplements.filter(item => item.status === 'pending' && item.method === 'transfer').map(item => item.amountMinor),
    ...gloves.filter(item => item.status === 'pending' && item.method === 'transfer').map(item => item.priceMinor),
    ...lockers.filter(item => item.status === 'pending' && item.method === 'transfer').map(item => item.priceMinor),
  ]);
  const cardMinor = sum(events.filter(event => event.method === 'card').map(event => event.amountMinor));
  const paymentMethods = (['cash', 'card'] as const).map(method => {
    const methodEvents = events.filter(event => event.method === method);
    const operations = new Set(methodEvents.map(event => {
      const family = familyForEvent(event);
      const source = family === 'membership' ? `membership:${event.paymentId}`
        : family === 'supplement' ? `supplement:${event.paymentId}` : family === 'glove' ? `glove:${event.paymentId}`
          : family === 'locker' ? `locker:${event.paymentId}` : `${family}:${event.paymentId}`;
      const item = family === 'membership' ? paymentById.get(source)
        : family === 'supplement' ? supplementById.get(source) : family === 'glove' ? gloveById.get(source)
          : family === 'locker' ? lockerById.get(source) : salesById.get(`sale:${event.paymentId}`);
      const operation = item && 'cartId' in item && item.cartId ? `${family}:cart:${item.cartId}` : source;
      return `${method}:${operation}`;
    }));
    return { method, count: operations.size, amountMinor: sum(methodEvents.map(event => event.amountMinor)) };
  }).filter(item => item.count > 0);
  return { shift, rows: rows.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)), activities, cashMinor, confirmedMinor,
    cardMinor, paymentMethods, inventoryRows, pendingTransferMinor, expenseMinor, expenseCount, extraMinor, netMinor: confirmedMinor + extraMinor - expenseMinor, expectedCashMinor };
}
