import { describe, expect, it } from 'vitest';
import type { DemoState } from '../domain/models';
import { createDemoState } from './adapter';
import { getOperationalAlerts } from './alertCenterSelector';

describe('getOperationalAlerts selector', () => {
  it('returns empty alert set and zero KPIs when no operational exceptions exist', () => {
    const cleanState: DemoState = {
      ...createDemoState(),
      expenses: [],
      stockMovements: [],
      shifts: [
        {
          id: 'shift-clean',
          window: '06:00–14:00',
          openedAt: '2026-10-08T06:00:00-06:00',
          closedAt: '2026-10-08T14:00:00-06:00',
          status: 'closed',
          openingCashMinor: 50000,
          countedCashMinor: 50000,
          expectedCashAtCloseMinor: 50000,
          cashDifferenceMinor: 0,
        },
      ],
      sales: [
        {
          id: 'sale-ok',
          kind: 'product',
          productId: 'demo-water',
          description: 'Agua purificada',
          quantity: 1,
          unitPriceMinor: 2000,
          amountMinor: 2000,
          method: 'cash',
          status: 'confirmed',
          shiftId: 'shift-clean',
          recordedAt: '2026-10-08T09:00:00-06:00',
        },
      ],
      payments: [
        {
          id: 'payment-ok',
          memberId: 'demo-001',
          planId: 'plan-mensual',
          planName: 'Mensual',
          amountMinor: 60000,
          method: 'cash',
          status: 'paid',
          recordedAt: '2026-10-08T10:00:00-06:00',
          shiftId: 'shift-clean',
          effectiveDates: null,
        },
      ],
    };

    const result = getOperationalAlerts(cleanState, 'all');
    expect(result.alerts).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.kpis.totalAlerts).toBe(0);
    expect(result.kpis.cashImpactMinor).toBe(0);
    expect(result.kpis.pendingTransfersMinor).toBe(0);
    expect(result.categoryCounts).toEqual([]);
  });

  it('extracts cash discrepancies only for closed shifts with non-zero difference', () => {
    const base = createDemoState();
    const stateWithDiscrepancy: DemoState = {
      ...base,
      expenses: [],
      stockMovements: [],
      sales: [],
      payments: [],
      shifts: [
        {
          id: 'shift-closed-diff',
          window: '06:00–14:00',
          openedAt: '2026-10-08T06:00:00-06:00',
          closedAt: '2026-10-08T14:00:00-06:00',
          status: 'closed',
          openingCashMinor: 50000,
          countedCashMinor: 48000,
          expectedCashAtCloseMinor: 50000,
          cashDifferenceMinor: -2000, // -$20.00 MXN deficit
          closingNotes: 'Faltante al contar caja chica',
        },
        {
          id: 'shift-open-no-diff',
          window: '14:00–22:00',
          openedAt: '2026-10-08T14:00:00-06:00',
          status: 'open',
          openingCashMinor: 30000,
        },
        {
          id: 'shift-closed-zero-diff',
          window: '14:00–22:00',
          openedAt: '2026-10-07T14:00:00-06:00',
          closedAt: '2026-10-07T22:00:00-06:00',
          status: 'closed',
          openingCashMinor: 30000,
          countedCashMinor: 30000,
          expectedCashAtCloseMinor: 30000,
          cashDifferenceMinor: 0,
        },
      ],
    };

    const result = getOperationalAlerts(stateWithDiscrepancy, 'all');
    expect(result.alerts).toHaveLength(1);
    const alert = result.alerts[0];
    expect(alert.category).toBe('cash_difference');
    expect(alert.shiftId).toBe('shift-closed-diff');
    expect(alert.impactMinor).toBe(-2000);
    expect(alert.targetRoute).toBe('/owner/shifts');
    expect(alert.actionLabel).toBe('Revisar turno');
    expect(alert.detail).toContain('Faltante');
  });

  it('extracts inventory waste movements and computes monetary impact from product catalog', () => {
    const base = createDemoState();
    const stateWithWaste: DemoState = {
      ...base,
      expenses: [],
      sales: [],
      payments: [],
      shifts: [],
      stockMovements: [
        {
          id: 'waste-01',
          productId: 'demo-water', // priceMinor is 2000
          shiftId: 'demo-shift-01',
          kind: 'waste',
          quantity: 3, // 3 * 2000 = 6000 ($60.00 MXN)
          recordedAt: '2026-10-08T11:00:00-06:00',
        },
        {
          id: 'restock-01',
          productId: 'demo-water',
          shiftId: 'demo-shift-01',
          kind: 'restock',
          quantity: 10,
          recordedAt: '2026-10-08T10:00:00-06:00',
        },
      ],
    };

    const result = getOperationalAlerts(stateWithWaste, 'all');
    expect(result.alerts).toHaveLength(1);
    const alert = result.alerts[0];
    expect(alert.category).toBe('waste');
    expect(alert.impactMinor).toBe(6000);
    expect(alert.targetRoute).toBe('/owner/inventory');
    expect(alert.actionLabel).toBe('Revisar inventario');
    expect(alert.detail).toContain('Agua');
    expect(alert.detail).toContain('3');
  });

  it('extracts unplanned cash expenses and routes to shifts', () => {
    const base = createDemoState();
    const stateWithExpenses: DemoState = {
      ...base,
      stockMovements: [],
      sales: [],
      payments: [],
      shifts: [],
      expenses: [
        {
          id: 'exp-01',
          concept: 'Reparación de cerradura de vestidor',
          payeeName: 'Cerrajería Express',
          amountMinor: 35000,
          shiftId: 'demo-shift-01',
          recordedAt: '2026-10-08T09:30:00-06:00',
        },
      ],
    };

    const result = getOperationalAlerts(stateWithExpenses, 'all');
    expect(result.alerts).toHaveLength(1);
    const alert = result.alerts[0];
    expect(alert.category).toBe('expense');
    expect(alert.impactMinor).toBe(35000);
    expect(alert.responsible).toBe('Cerrajería Express');
    expect(alert.targetRoute).toBe('/owner/shifts');
    expect(alert.detail).toContain('Reparación de cerradura');
  });

  it('extracts pending transfers from both sales and membership payments', () => {
    const base = createDemoState();
    const stateWithTransfers: DemoState = {
      ...base,
      expenses: [],
      stockMovements: [],
      shifts: [],
      sales: [
        {
          id: 'sale-transfer-pending',
          kind: 'product',
          productId: 'demo-drink',
          description: 'Bebida isotónica',
          quantity: 2,
          unitPriceMinor: 4000,
          amountMinor: 8000,
          method: 'transfer',
          status: 'pending',
          shiftId: 'demo-shift-01',
          recordedAt: '2026-10-08T10:00:00-06:00',
        },
        {
          id: 'sale-transfer-confirmed',
          kind: 'product',
          productId: 'demo-drink',
          description: 'Bebida isotónica confirmada',
          quantity: 1,
          unitPriceMinor: 4000,
          amountMinor: 4000,
          method: 'transfer',
          status: 'confirmed',
          shiftId: 'demo-shift-01',
          recordedAt: '2026-10-08T10:05:00-06:00',
        },
      ],
      payments: [
        {
          id: 'pay-transfer-pending',
          memberId: 'demo-001',
          planId: 'plan-anual',
          planName: 'Anualidad',
          amountMinor: 550000,
          method: 'transfer',
          status: 'pending',
          recordedAt: '2026-10-08T10:30:00-06:00',
          shiftId: 'demo-shift-01',
          effectiveDates: null,
        },
      ],
    };

    const result = getOperationalAlerts(stateWithTransfers, 'all');
    expect(result.alerts).toHaveLength(2);
    expect(result.alerts.every(a => a.category === 'pending_transfer')).toBe(true);
    expect(result.kpis.pendingTransfersMinor).toBe(558000); // 8000 + 550000
    expect(result.alerts.every(a => a.targetRoute === '/owner/history')).toBe(true);
  });

  it('calculates aggregated KPIs and chart distribution data accurately', () => {
    const base = createDemoState();
    const fullScenarioState: DemoState = {
      ...base,
      shifts: [
        {
          id: 'shift-1',
          window: '06:00–14:00',
          openedAt: '2026-10-08T06:00:00-06:00',
          closedAt: '2026-10-08T14:00:00-06:00',
          status: 'closed',
          openingCashMinor: 50000,
          cashDifferenceMinor: -5000, // -$50.00
        },
      ],
      stockMovements: [
        {
          id: 'waste-1',
          productId: 'demo-water',
          shiftId: 'shift-1',
          kind: 'waste',
          quantity: 2, // 2 * 2000 = 4000
          recordedAt: '2026-10-08T08:00:00-06:00',
        },
      ],
      expenses: [
        {
          id: 'exp-1',
          concept: 'Insumos de limpieza',
          payeeName: 'Abarrotes Don Pepe',
          amountMinor: 15000,
          shiftId: 'shift-1',
          recordedAt: '2026-10-08T09:00:00-06:00',
        },
      ],
      sales: [
        {
          id: 'sale-trans',
          kind: 'product',
          description: 'Proteína muestra',
          quantity: 1,
          unitPriceMinor: 10000,
          amountMinor: 10000,
          method: 'transfer',
          status: 'pending',
          shiftId: 'shift-1',
          recordedAt: '2026-10-08T10:00:00-06:00',
        },
      ],
      payments: [],
    };

    const result = getOperationalAlerts(fullScenarioState, 'all');
    expect(result.totalCount).toBe(4);
    expect(result.kpis.totalAlerts).toBe(4);
    expect(result.kpis.cashImpactMinor).toBe(20000); // 5000 diff + 15000 expense
    expect(result.kpis.pendingTransfersMinor).toBe(10000);
    expect(result.kpis.totalImpactMinor).toBe(34000); // 5000 + 4000 + 15000 + 10000

    expect(result.categoryCounts).toHaveLength(4);
    const wasteCat = result.categoryCounts.find(c => c.category === 'waste');
    expect(wasteCat?.count).toBe(1);
    expect(wasteCat?.percent).toBe(25);
  });

  it('filters alerts by period (today, week, month, all)', () => {
    const base = createDemoState();
    // Reference date: 2026-10-08
    const timeState: DemoState = {
      ...base,
      demoClock: '2026-10-08T12:00:00-06:00',
      shifts: [],
      stockMovements: [],
      sales: [],
      payments: [],
      expenses: [
        // Today (2026-10-08)
        {
          id: 'exp-today',
          concept: 'Gasto hoy',
          payeeName: 'Proveedor 1',
          amountMinor: 1000,
          shiftId: 'shift-1',
          recordedAt: '2026-10-08T10:00:00-06:00',
        },
        // 3 days ago (2026-10-05) -> within week and month
        {
          id: 'exp-3days',
          concept: 'Gasto 3 días',
          payeeName: 'Proveedor 2',
          amountMinor: 2000,
          shiftId: 'shift-1',
          recordedAt: '2026-10-05T10:00:00-06:00',
        },
        // 15 days ago (2026-09-23) -> within month only
        {
          id: 'exp-15days',
          concept: 'Gasto 15 días',
          payeeName: 'Proveedor 3',
          amountMinor: 3000,
          shiftId: 'shift-1',
          recordedAt: '2026-09-23T10:00:00-06:00',
        },
        // 60 days ago (2026-08-09) -> only in 'all'
        {
          id: 'exp-60days',
          concept: 'Gasto 60 días',
          payeeName: 'Proveedor 4',
          amountMinor: 4000,
          shiftId: 'shift-1',
          recordedAt: '2026-08-09T10:00:00-06:00',
        },
      ],
    };

    const todayResult = getOperationalAlerts(timeState, 'today');
    expect(todayResult.alerts.map(a => a.id)).toEqual(['alert-expense-exp-today']);

    const weekResult = getOperationalAlerts(timeState, 'week');
    expect(weekResult.alerts.map(a => a.id)).toEqual(['alert-expense-exp-today', 'alert-expense-exp-3days']);

    const monthResult = getOperationalAlerts(timeState, 'month');
    expect(monthResult.alerts.map(a => a.id)).toEqual(['alert-expense-exp-today', 'alert-expense-exp-3days', 'alert-expense-exp-15days']);

    const allResult = getOperationalAlerts(timeState, 'all');
    expect(allResult.alerts).toHaveLength(4);
  });

  it('sorts alerts in reverse chronological order', () => {
    const base = createDemoState();
    const sortedState: DemoState = {
      ...base,
      shifts: [],
      stockMovements: [],
      sales: [],
      payments: [],
      expenses: [
        {
          id: 'exp-earlier',
          concept: 'Gasto temprano',
          payeeName: 'P1',
          amountMinor: 1000,
          shiftId: 'shift-1',
          recordedAt: '2026-10-08T08:00:00-06:00',
        },
        {
          id: 'exp-later',
          concept: 'Gasto tardío',
          payeeName: 'P2',
          amountMinor: 2000,
          shiftId: 'shift-1',
          recordedAt: '2026-10-08T16:00:00-06:00',
        },
      ],
    };

    const result = getOperationalAlerts(sortedState, 'all');
    expect(result.alerts[0].id).toBe('alert-expense-exp-later');
    expect(result.alerts[1].id).toBe('alert-expense-exp-earlier');
  });

  it('generates return alert for refunded sales and includes waste reasons', () => {
    const base = createDemoState();
    const testState: DemoState = {
      ...base,
      shifts: [],
      expenses: [],
      payments: [],
      stockMovements: [
        {
          id: 'waste-with-reason',
          productId: 'demo-water',
          shiftId: 'shift-1',
          kind: 'waste',
          quantity: 1,
          reason: 'Botella rota por caída',
          recordedAt: '2026-10-08T10:00:00-06:00',
        },
      ],
      sales: [
        {
          id: 'sale-refunded',
          kind: 'product',
          productId: 'demo-water',
          description: 'Agua purificada',
          quantity: 1,
          unitPriceMinor: 2000,
          amountMinor: 2000,
          method: 'cash',
          status: 'confirmed',
          shiftId: 'shift-1',
          recordedAt: '2026-10-08T09:00:00-06:00',
          refundedAt: '2026-10-08T11:00:00-06:00',
          refundReason: 'Cliente insatisfecho',
          memberId: 'demo-001',
        },
      ],
    };

    const result = getOperationalAlerts(testState, 'all');
    expect(result.totalCount).toBe(2);

    const wasteAlert = result.alerts.find(a => a.id === 'alert-waste-waste-with-reason');
    expect(wasteAlert?.detail).toContain('Botella rota por caída');

    const returnAlert = result.alerts.find(a => a.id === 'alert-return-sale-sale-refunded');
    expect(returnAlert).toBeDefined();
    expect(returnAlert?.category).toBe('return');
    expect(returnAlert?.title).toContain('Devolución de producto:');
    expect(returnAlert?.detail).toContain('Cliente insatisfecho');
  });
});
