import type { DemoState } from '../domain/models';

export function createDemoState(): DemoState {
  return {
    demoClock: '2026-10-08T12:00:00-06:00',
    attendancePolicy: { allowExpiryDay: true, allowRepeatVisits: true },
    attendance: [
      { id: 'mock-attendance-001', memberId: 'demo-001', observedCheckIn: '2026-10-08T08:00:00-06:00', observedCheckOut: null, autoClosedAt: null, illustrativeSeed: true },
      { id: 'mock-attendance-1', memberId: 'demo-active', observedCheckIn: '2026-10-05T12:00:00-06:00', observedCheckOut: '2026-10-05T13:00:00-06:00', autoClosedAt: null, illustrativeSeed: true },
      { id: 'mock-attendance-2', memberId: 'demo-active', observedCheckIn: '2026-10-06T12:00:00-06:00', observedCheckOut: null, autoClosedAt: '2026-10-06T22:00:00-06:00', illustrativeSeed: true },
    ],
    revision: 0,
    currentShiftId: 'demo-shift-01',
    payments: [],
    memberNotes: [{ id: 'sample-note-demo-001', memberId: 'demo-001', body: 'Nota de muestra — Información para mostrar el historial de notas.', authorId: 'recep-1', authorName: 'Valeria M.', createdAt: '2026-10-08T09:00:00-06:00' }],
    ledger: [],
    shifts: [
      { id: 'demo-shift-01', window: '06:00–14:00', openedAt: '2026-10-08T06:00:00-06:00', status: 'open', openingCashMinor: 50000 },
      { id: 'demo-shift-previous', window: '14:00–22:00', openedAt: '2026-10-07T14:00:00-06:00', status: 'closed', openingCashMinor: 30000,
        closedAt: '2026-10-07T22:00:00-06:00', countedCashMinor: 30000, expectedCashAtCloseMinor: 30000, cashDifferenceMinor: 0 },
    ],
    products: [
      { id: 'demo-water', name: 'Agua', priceMinor: 2000, openingQuantity: 12, illustrative: true },
      { id: 'demo-bar', name: 'Barra', priceMinor: 3500, openingQuantity: 8, illustrative: true },
      { id: 'demo-drink', name: 'Bebida', priceMinor: 4000, openingQuantity: 6, illustrative: true },
    ],
    stockMovements: [],
    counts: [],
    sales: [],
    members: [
      { id: 'demo-001', name: 'Mariana López', phone: '5550000001', creditMinor: 0,
        membership: { planName: 'Gym mensual', startsOn: '2026-09-17', endsOn: '2026-10-17' }, joinedOn: '2025-10-15' },
      { id: 'demo-002', name: 'Carlos Rivera', phone: '5550000002', creditMinor: 0, membership: null, joinedOn: '2026-05-10' },
      { id: 'demo-active', name: 'Alex Morgan', phone: '', creditMinor: 0, demoScenario: 'active',
        membership: { planName: 'Gym + Box mensual', startsOn: '2026-10-01', endsOn: '2026-10-31' }, joinedOn: '2026-07-01' },
      { id: 'demo-expired', name: 'Patricia Gómez', phone: '', creditMinor: 0, demoScenario: 'expired',
        membership: { planName: 'Box mensual', startsOn: '2026-09-01', endsOn: '2026-09-30' }, joinedOn: '2026-04-12' },
      { id: 'demo-expiry', name: 'Marco Silva', phone: '', creditMinor: 0, demoScenario: 'expiry-today',
        membership: { planName: 'Gym estudiante', startsOn: '2026-09-09', endsOn: '2026-10-08' }, joinedOn: '2026-08-09' },
      { id: 'demo-unknown', name: 'Julián Cruz', phone: '', creditMinor: 0, demoScenario: 'unknown', membership: null, joinedOn: '2026-09-20' },
      { id: 'demo-007', name: 'Sofía Delgado', phone: '5550000007', creditMinor: 0,
        membership: { planName: 'Gym + Box mensual', startsOn: '2026-09-25', endsOn: '2026-10-25' }, joinedOn: '2025-04-10' },
      { id: 'demo-008', name: 'Fernando Ruiz', phone: '5550000008', creditMinor: 0,
        membership: { planName: 'Box mensual', startsOn: '2026-10-02', endsOn: '2026-11-02' }, joinedOn: '2025-11-20' },
      { id: 'demo-009', name: 'Andrea Morales', phone: '5550000009', creditMinor: 0,
        membership: { planName: 'Gym estudiante', startsOn: '2026-09-12', endsOn: '2026-10-12' }, joinedOn: '2026-08-15' },
      { id: 'demo-010', name: 'Roberto Garza', phone: '5550000010', creditMinor: 0,
        membership: { planName: 'Gym trimestral', startsOn: '2026-08-01', endsOn: '2026-11-01' }, joinedOn: '2025-01-10' },
      { id: 'demo-011', name: 'Valeria Castillo', phone: '5550000011', creditMinor: 0,
        membership: { planName: 'Box kids', startsOn: '2026-09-20', endsOn: '2026-10-20' }, joinedOn: '2026-03-01' },
      { id: 'demo-012', name: 'Diego Hernández', phone: '5550000012', creditMinor: 0,
        membership: { planName: 'Gym mensual', startsOn: '2026-09-28', endsOn: '2026-10-28' }, joinedOn: '2026-09-28' },
    ],
    gloves: [
      { id: 'glove-01', code: '#01', color: 'Rojo', ounces: 12, priceMinor: 2500, status: 'available' },
      { id: 'glove-02', code: '#02', color: 'Negro', ounces: 14, priceMinor: 2500, status: 'rented', assignedMemberId: 'demo-002', assignedMemberName: 'Carlos Rivera', assignedAt: '2026-10-08T08:30:00-06:00', paymentMethod: 'cash', paymentStatus: 'paid' },
      { id: 'glove-03', code: '#03', color: 'Azul', ounces: 10, priceMinor: 2500, status: 'available' },
      { id: 'glove-04', code: '#04', color: 'Blanco', ounces: 16, priceMinor: 3000, status: 'available' },
      { id: 'glove-05', code: '#05', color: 'Rosa', ounces: 12, priceMinor: 2500, status: 'rented', assignedMemberId: 'demo-active', assignedMemberName: 'Alex Morgan', assignedAt: '2026-10-08T09:15:00-06:00', paymentMethod: 'card', paymentStatus: 'paid' },
      { id: 'glove-06', code: '#06', color: 'Verde', ounces: 14, priceMinor: 2500, status: 'available' },
      { id: 'glove-07', code: '#07', color: 'Dorado', ounces: 16, priceMinor: 3000, status: 'available' },
      { id: 'glove-08', code: '#08', color: 'Gris', ounces: 12, priceMinor: 2500, status: 'available' },
      { id: 'glove-09', code: '#09', color: 'Rojo', ounces: 14, priceMinor: 2500, status: 'available' },
      { id: 'glove-10', code: '#10', color: 'Negro', ounces: 12, priceMinor: 2500, status: 'available' },
      { id: 'glove-11', code: '#11', color: 'Azul', ounces: 16, priceMinor: 3000, status: 'available' },
      { id: 'glove-12', code: '#12', color: 'Morado', ounces: 10, priceMinor: 2500, status: 'available' },
    ],
    gloveRentals: [
      { id: 'rental-seed-01', gloveId: 'glove-02', memberId: 'demo-002', memberName: 'Carlos Rivera', shiftId: 'demo-shift-01', priceMinor: 2500, method: 'cash', status: 'paid', rentedAt: '2026-10-08T08:30:00-06:00', returnedAt: null },
      { id: 'rental-seed-02', gloveId: 'glove-05', memberId: 'demo-active', memberName: 'Alex Morgan', shiftId: 'demo-shift-01', priceMinor: 2500, method: 'card', status: 'paid', rentedAt: '2026-10-08T09:15:00-06:00', returnedAt: null },
    ],
    lockers: createSeedLockers(),
    lockerRentals: [
      { id: 'locker-rent-03', lockerId: 'locker-03', memberId: 'demo-002', memberName: 'Carlos Rivera', shiftId: 'demo-shift-01', priceMinor: 15000, method: 'cash', status: 'paid', rentedAt: '2026-10-01T10:00:00-06:00', expiresAt: '2026-11-01T10:00:00-06:00', releasedAt: null },
      { id: 'locker-rent-07', lockerId: 'locker-07', memberId: 'demo-001', memberName: 'Mariana López', shiftId: 'demo-shift-previous', priceMinor: 15000, method: 'card', status: 'paid', rentedAt: '2026-09-20T11:00:00-06:00', expiresAt: '2026-10-20T11:00:00-06:00', releasedAt: null },
      { id: 'locker-rent-12', lockerId: 'locker-12', memberId: 'demo-active', memberName: 'Alex Morgan', shiftId: 'demo-shift-01', priceMinor: 15000, method: 'cash', status: 'paid', rentedAt: '2026-10-05T08:00:00-06:00', expiresAt: '2026-11-05T08:00:00-06:00', releasedAt: null },
    ],
    supplements: [
      { id: 'sup-01', name: 'Proteína Whey', flavor: 'Vainilla', scoopPriceMinor: 3500, availableScoops: 24 },
      { id: 'sup-02', name: 'Proteína Whey', flavor: 'Chocolate', scoopPriceMinor: 3500, availableScoops: 18 },
      { id: 'sup-03', name: 'Creatina Monohidratada', flavor: 'Sin sabor', scoopPriceMinor: 2000, availableScoops: 40 },
      { id: 'sup-04', name: 'Pre-Entreno Nitro', flavor: 'Frutos Rojos', scoopPriceMinor: 3000, availableScoops: 15 },
      { id: 'sup-05', name: 'BCAA Aminoácidos', flavor: 'Limón', scoopPriceMinor: 2500, availableScoops: 30 },
      { id: 'sup-06', name: 'Colágeno Hidrolizado', flavor: 'Naranja', scoopPriceMinor: 2500, availableScoops: 22 },
    ],
    supplementSales: [],
    expenses: [
      { id: 'expense-seed-01', concept: 'Agua purificada para garrafón de recepción', payeeName: 'Agua Cristalina', amountMinor: 7000, shiftId: 'demo-shift-01', recordedAt: '2026-10-08T09:00:00-06:00' },
    ],
    extras: [
      { id: 'extra-seed-01', concept: 'Cambio de billete $500 para cliente', staffName: 'Mariana López', amountMinor: 5000, shiftId: 'demo-shift-01', recordedAt: '2026-10-08T10:15:00-06:00' },
    ],
  };
}

function createSeedLockers() {
  const lockers = [];
  for (let i = 1; i <= 42; i++) {
    const code = `#${String(i).padStart(2, '0')}`;
    const id = `locker-${String(i).padStart(2, '0')}`;
    if (i === 1 || i === 2) {
      lockers.push({
        id,
        number: i,
        code,
        status: 'employee' as const,
        monthlyPriceMinor: 15000,
        assignedMemberName: 'Staff EvoGym',
        assignedAt: '2026-10-01T08:00:00-06:00',
      });
    } else if (i === 3) {
      lockers.push({
        id,
        number: i,
        code,
        status: 'assigned' as const,
        monthlyPriceMinor: 15000,
        assignedMemberId: 'demo-002',
        assignedMemberName: 'Carlos Rivera',
        assignedAt: '2026-10-01T10:00:00-06:00',
        expiresAt: '2026-11-01T10:00:00-06:00',
        paymentMethod: 'cash' as const,
        paymentStatus: 'paid' as const,
      });
    } else if (i === 7) {
      lockers.push({
        id,
        number: i,
        code,
        status: 'assigned' as const,
        monthlyPriceMinor: 15000,
        assignedMemberId: 'demo-001',
        assignedMemberName: 'Mariana López',
        assignedAt: '2026-09-20T11:00:00-06:00',
        expiresAt: '2026-10-20T11:00:00-06:00',
        paymentMethod: 'card' as const,
        paymentStatus: 'paid' as const,
      });
    } else if (i === 12) {
      lockers.push({
        id,
        number: i,
        code,
        status: 'assigned' as const,
        monthlyPriceMinor: 15000,
        assignedMemberId: 'demo-active',
        assignedMemberName: 'Alex Morgan',
        assignedAt: '2026-10-05T08:00:00-06:00',
        expiresAt: '2026-11-05T08:00:00-06:00',
        paymentMethod: 'cash' as const,
        paymentStatus: 'paid' as const,
      });
    } else if (i === 15) {
      lockers.push({
        id,
        number: i,
        code,
        status: 'evicted' as const,
        monthlyPriceMinor: 15000,
        assignedMemberName: 'Desalojado (Sin renovar)',
      });
    } else if (i === 20) {
      lockers.push({
        id,
        number: i,
        code,
        status: 'out_of_service' as const,
        monthlyPriceMinor: 15000,
      });
    } else {
      lockers.push({
        id,
        number: i,
        code,
        status: 'available' as const,
        monthlyPriceMinor: 15000,
      });
    }
  }
  return lockers;
}

export function formatMoney(minor: number) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(minor / 100);
}

export function parseMoney(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ''] = value.trim().split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(minor) ? minor : null;
}
