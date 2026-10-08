import type { DemoState } from '../domain/models';

export function createDemoState(): DemoState {
  return {
    revision: 0,
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
