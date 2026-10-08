import type { DemoState } from '../domain/models';

export function createDemoState(): DemoState {
  return {
    revision: 0,
    currentShiftId: 'demo-shift-01',
    payments: [],
    ledger: [],
    shifts: [
      { id: 'demo-shift-01', window: '06:00–14:00', openedAt: '2026-10-08T06:00:00-06:00', status: 'open', openingCashMinor: 50000 },
      { id: 'demo-shift-previous', window: '14:00–22:00', openedAt: '2026-10-07T14:00:00-06:00', status: 'closed', openingCashMinor: 30000,
        closedAt: '2026-10-07T22:00:00-06:00', countedCashMinor: 30000, expectedCashAtCloseMinor: 30000, cashDifferenceMinor: 0 },
    ],
    products: [{ id: 'demo-water', name: 'Agua · producto ilustrativo', priceMinor: 2000, openingQuantity: 12, illustrative: true }],
    stockMovements: [],
    counts: [],
    sales: [],
    members: [
      { id: 'demo-001', name: 'Mariana López', phone: '5550000001', creditMinor: 0,
        membership: { planName: 'Mensual', startsOn: '2026-09-17', endsOn: '2026-10-17' } },
      { id: 'demo-002', name: 'Carlos Rivera', phone: '5550000002', creditMinor: 0, membership: null },
    ],
  };
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
