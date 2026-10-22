import { describe, expect, it } from 'vitest';
import { createDemoState } from './adapter';
import { shiftDashboard } from './shiftDashboard';

describe('shiftDashboard', () => {
  it('aggregates confirmed operations once, excludes pending sources, and summarizes cash movements', () => {
    const state = createDemoState();
    state.ledger = [
      { id: 'event-membership', paymentId: 'member-1', shiftId: 'demo-shift-01', kind: 'membership', amountMinor: 10000, method: 'cash', recordedAt: '2026-10-08T12:00:00Z' },
      { id: 'event-product', paymentId: 'cart-1', shiftId: 'demo-shift-01', kind: 'product', amountMinor: 5000, method: 'card', recordedAt: '2026-10-08T12:01:00Z' },
    ];
    state.payments = [{ id: 'member-1', memberId: 'demo-001', planId: 'p', planName: 'Plan', amountMinor: 10000, method: 'cash', status: 'paid', recordedAt: '2026-10-08T12:00:00Z', shiftId: 'demo-shift-01', effectiveDates: null }];
    state.sales = [
      { id: 'sale-1', cartId: 'cart-1', kind: 'product', description: 'Water', productId: 'demo-water', quantity: 1, unitPriceMinor: 5000, amountMinor: 5000, method: 'card', status: 'confirmed', shiftId: 'demo-shift-01', recordedAt: '2026-10-08T12:01:00Z' },
      { id: 'sale-pending', kind: 'visit', description: 'Visit', area: 'GYM', quantity: 1, unitPriceMinor: 2000, amountMinor: 2000, method: 'transfer', status: 'pending', shiftId: 'demo-shift-01', recordedAt: '2026-10-08T12:02:00Z' },
    ];
    state.stockMovements = [
      { id: 'mirror-sale', productId: 'demo-water', shiftId: 'demo-shift-01', kind: 'sale', quantity: 1, recordedAt: '2026-10-08T12:01:00Z' },
      { id: 'restock', productId: 'demo-water', shiftId: 'demo-shift-01', kind: 'restock', quantity: 2, recordedAt: '2026-10-08T12:03:00Z' },
    ];
    state.counts = [{ id: 'count-1', productId: 'demo-water', shiftId: 'demo-shift-01', quantity: 10, expectedAtCount: 11, variance: -1, recordedAt: '2026-10-08T12:04:00Z' }];
    state.expenses = [{ id: 'expense', concept: 'Supplies', payeeName: 'Store', amountMinor: 1000, shiftId: 'demo-shift-01', recordedAt: '2026-10-08T12:05:00Z' }];
    state.extras = [{ id: 'extra', concept: 'Other income', staffName: 'Staff', amountMinor: 500, shiftId: 'demo-shift-01', recordedAt: '2026-10-08T12:06:00Z' }];

    const result = shiftDashboard(state, 'demo-shift-01');

    expect(result?.confirmedMinor).toBe(15000);
    expect(result?.paymentMethods).toEqual([
      { method: 'cash', count: 1, amountMinor: 10000 },
      { method: 'card', count: 1, amountMinor: 5000 },
    ]);
    expect(result?.cashMinor).toBe(10000);
    expect(result?.expectedCashMinor).toBe(59500);
    expect(result?.netMinor).toBe(14500);
    expect(result?.expenseCount).toBe(1);
    expect(result?.activities.find(item => item.family === 'membership')).toMatchObject({ count: 1, amountMinor: 10000 });
    expect(result?.activities.find(item => item.family === 'product')).toMatchObject({ count: 1, amountMinor: 5000 });
    expect(result?.rows.find(item => item.id === 'sale:sale-pending')).toMatchObject({ method: 'transfer', cashImpactMinor: 0 });
    expect(result?.rows.map(item => item.id)).toEqual(expect.arrayContaining(['ledger:event-membership', 'sale:sale-pending', 'expense:expense', 'extra:extra']));
    expect(result?.rows.some(item => item.id === 'stock:mirror-sale')).toBe(false);
    expect(result?.inventoryRows.map(row => row.id)).toEqual(['count:count-1', 'stock:restock']);
    expect(result?.rows.some(row => row.id === 'count:count-1' || row.id === 'stock:restock')).toBe(false);
  });

  it('separates all six sale families and deduplicates product and supplement carts', () => {
    const state = createDemoState();
    state.sales = [
      { id: 'product-line-a', cartId: 'product-cart', kind: 'product', productId: 'demo-water', description: 'Water', quantity: 1, unitPriceMinor: 500, amountMinor: 500, method: 'cash', status: 'confirmed', shiftId: 'demo-shift-01', recordedAt: '2026-10-08T12:00:00Z' },
      { id: 'product-line-b', cartId: 'product-cart', kind: 'product', productId: 'demo-bar', description: 'Bar', quantity: 1, unitPriceMinor: 600, amountMinor: 600, method: 'cash', status: 'confirmed', shiftId: 'demo-shift-01', recordedAt: '2026-10-08T12:01:00Z' },
      { id: 'visit-line', kind: 'visit', area: 'GYM', description: 'Gym visit', quantity: 1, unitPriceMinor: 300, amountMinor: 300, method: 'card', status: 'confirmed', shiftId: 'demo-shift-01', recordedAt: '2026-10-08T12:02:00Z' },
    ];
    state.supplementSales = [
      { id: 'supp-line-a', cartId: 'supp-cart', supplementId: 's1', name: 'Whey', scoops: 1, unitPriceMinor: 200, amountMinor: 200, method: 'cash', status: 'confirmed', shiftId: 'demo-shift-01', recordedAt: '2026-10-08T12:03:00Z' },
      { id: 'supp-line-b', cartId: 'supp-cart', supplementId: 's2', name: 'Creatine', scoops: 1, unitPriceMinor: 250, amountMinor: 250, method: 'cash', status: 'confirmed', shiftId: 'demo-shift-01', recordedAt: '2026-10-08T12:04:00Z' },
    ];
    state.gloveRentals = [{ id: 'glove-rent', gloveId: 'g1', memberId: 'demo-001', memberName: 'Mariana López', shiftId: 'demo-shift-01', priceMinor: 400, method: 'cash', status: 'paid', rentedAt: '2026-10-08T12:05:00Z' }];
    state.lockerRentals = [{ id: 'locker-rent', lockerId: 'l1', memberId: 'demo-001', memberName: 'Mariana López', shiftId: 'demo-shift-01', priceMinor: 500, method: 'card', status: 'paid', rentedAt: '2026-10-08T12:06:00Z', expiresAt: '2026-11-08T12:06:00Z' }];
    state.ledger = [
      { id: 'membership-event', paymentId: 'member-p', shiftId: 'demo-shift-01', kind: 'membership', amountMinor: 1000, method: 'cash', recordedAt: '2026-10-08T11:59:00Z' },
      { id: 'sale-event-product-line-a', paymentId: 'product-line-a', shiftId: 'demo-shift-01', kind: 'product', amountMinor: 500, method: 'cash', recordedAt: '2026-10-08T12:00:00Z' },
      { id: 'sale-event-product-line-b', paymentId: 'product-line-b', shiftId: 'demo-shift-01', kind: 'product', amountMinor: 600, method: 'cash', recordedAt: '2026-10-08T12:01:00Z' },
      { id: 'sale-event-visit-line', paymentId: 'visit-line', shiftId: 'demo-shift-01', kind: 'visit', amountMinor: 300, method: 'card', recordedAt: '2026-10-08T12:02:00Z' },
      { id: 'sup-event-supp-line-a', paymentId: 'supp-line-a', shiftId: 'demo-shift-01', kind: 'product', amountMinor: 200, method: 'cash', recordedAt: '2026-10-08T12:03:00Z' },
      { id: 'sup-event-supp-line-b', paymentId: 'supp-line-b', shiftId: 'demo-shift-01', kind: 'product', amountMinor: 250, method: 'cash', recordedAt: '2026-10-08T12:04:00Z' },
      { id: 'glove-event-glove-rent', paymentId: 'glove-rent', shiftId: 'demo-shift-01', kind: 'product', amountMinor: 400, method: 'cash', recordedAt: '2026-10-08T12:05:00Z' },
      { id: 'locker-event-locker-rent', paymentId: 'locker-rent', shiftId: 'demo-shift-01', kind: 'product', amountMinor: 500, method: 'card', recordedAt: '2026-10-08T12:06:00Z' },
    ];

    const result = shiftDashboard(state, 'demo-shift-01');
    expect(result?.activities).toEqual([
      { family: 'membership', count: 1, amountMinor: 1000 },
      { family: 'product', count: 1, amountMinor: 1100 },
      { family: 'visit', count: 1, amountMinor: 300 },
      { family: 'supplement', count: 1, amountMinor: 450 },
      { family: 'glove', count: 1, amountMinor: 400 },
      { family: 'locker', count: 1, amountMinor: 500 },
    ]);
    expect(result?.rows.find(item => item.id === 'ledger:sup-event-supp-line-a')?.family).toBe('supplement');
    expect(result?.rows.find(item => item.id === 'ledger:glove-event-glove-rent')?.family).toBe('glove');
    expect(result?.rows.find(item => item.id === 'ledger:locker-event-locker-rent')?.family).toBe('locker');
  });

  it('uses explicit event namespaces when specialized source IDs collide', () => {
    const state = createDemoState();
    state.sales = [{ id: 'shared', cartId: 'shared-cart', kind: 'product', productId: 'demo-water', description: 'Product detail', quantity: 1, unitPriceMinor: 404, amountMinor: 404, method: 'cash', status: 'confirmed', shiftId: 'demo-shift-01', recordedAt: '2026-10-08T11:59:00Z' }];
    state.supplementSales = [{ id: 'shared', supplementId: 's1', name: 'Whey detail', scoops: 1, unitPriceMinor: 101, amountMinor: 101, method: 'cash', status: 'confirmed', shiftId: 'demo-shift-01', recordedAt: '2026-10-08T12:00:00Z' }];
    state.gloveRentals = [{ id: 'shared', gloveId: 'g1', memberId: 'demo-001', memberName: 'Glove detail', shiftId: 'demo-shift-01', priceMinor: 202, method: 'card', status: 'paid', rentedAt: '2026-10-08T12:01:00Z' }];
    state.lockerRentals = [{ id: 'shared', lockerId: 'l1', memberId: 'demo-001', memberName: 'Locker detail', shiftId: 'demo-shift-01', priceMinor: 303, method: 'cash', status: 'paid', rentedAt: '2026-10-08T12:02:00Z', expiresAt: '2026-11-08T12:02:00Z' }];
    state.ledger = [
      { id: 'sale-event-shared', paymentId: 'shared', shiftId: 'demo-shift-01', kind: 'product', amountMinor: 404, method: 'cash', recordedAt: '2026-10-08T11:59:00Z' },
      { id: 'sup-event-shared', paymentId: 'shared', shiftId: 'demo-shift-01', kind: 'product', amountMinor: 101, method: 'cash', recordedAt: '2026-10-08T12:00:00Z' },
      { id: 'glove-event-shared', paymentId: 'shared', shiftId: 'demo-shift-01', kind: 'product', amountMinor: 202, method: 'card', recordedAt: '2026-10-08T12:01:00Z' },
      { id: 'locker-event-shared', paymentId: 'shared', shiftId: 'demo-shift-01', kind: 'product', amountMinor: 303, method: 'cash', recordedAt: '2026-10-08T12:02:00Z' },
    ];

    const result = shiftDashboard(state, 'demo-shift-01');
    expect(result?.activities).toEqual([
      { family: 'membership', count: 0, amountMinor: 0 },
      { family: 'product', count: 1, amountMinor: 404 },
      { family: 'visit', count: 0, amountMinor: 0 },
      { family: 'supplement', count: 1, amountMinor: 101 },
      { family: 'glove', count: 1, amountMinor: 202 },
      { family: 'locker', count: 1, amountMinor: 303 },
    ]);
    expect(result?.rows.find(item => item.id === 'ledger:sale-event-shared')).toMatchObject({ family: 'product', amountMinor: 404, description: 'Product detail' });
    expect(result?.rows.find(item => item.id === 'ledger:sup-event-shared')).toMatchObject({ family: 'supplement', amountMinor: 101, description: 'Whey detail' });
    expect(result?.rows.find(item => item.id === 'ledger:glove-event-shared')).toMatchObject({ family: 'glove', amountMinor: 202, actor: 'Glove detail' });
    expect(result?.rows.find(item => item.id === 'ledger:locker-event-shared')).toMatchObject({ family: 'locker', amountMinor: 303, actor: 'Locker detail' });
  });

  it('keeps every pending transfer canonical and outside confirmed totals', () => {
    const state = createDemoState();
    state.payments = [{ id: 'pending-membership', memberId: 'demo-001', planId: 'p', planName: 'Plan', amountMinor: 100, method: 'transfer', status: 'pending', recordedAt: '2026-10-08T12:00:00Z', shiftId: 'demo-shift-01', effectiveDates: null }];
    state.sales = [{ id: 'pending-sale', kind: 'visit', area: 'GYM', description: 'Visit', quantity: 1, unitPriceMinor: 200, amountMinor: 200, method: 'transfer', status: 'pending', shiftId: 'demo-shift-01', recordedAt: '2026-10-08T12:00:00Z' }];
    state.supplementSales = [{ id: 'pending-supplement', supplementId: 's1', name: 'Whey', scoops: 1, unitPriceMinor: 300, amountMinor: 300, method: 'transfer', status: 'pending', shiftId: 'demo-shift-01', recordedAt: '2026-10-08T12:00:00Z' }];
    state.gloveRentals = [{ id: 'pending-glove', gloveId: 'g1', memberId: 'demo-001', memberName: 'Mariana López', shiftId: 'demo-shift-01', priceMinor: 400, method: 'transfer', status: 'pending', rentedAt: '2026-10-08T12:00:00Z' }];
    state.lockerRentals = [{ id: 'pending-locker', lockerId: 'l1', memberId: 'demo-001', memberName: 'Mariana López', shiftId: 'demo-shift-01', priceMinor: 500, method: 'transfer', status: 'pending', rentedAt: '2026-10-08T12:00:00Z', expiresAt: '2026-11-08T12:00:00Z' }];

    const result = shiftDashboard(state, 'demo-shift-01');
    expect(result?.confirmedMinor).toBe(0);
    expect(result?.paymentMethods).toEqual([]);
    expect(result?.pendingTransferMinor).toBe(1500);
    expect(result?.rows.filter(row => row.status === 'pending').every(row => row.method === 'transfer')).toBe(true);
  });

  it('returns null for a missing shift and empty-safe optional sources', () => {
    const state = createDemoState();
    delete state.expenses;
    delete state.extras;
    expect(shiftDashboard(state, 'missing')).toBeNull();
    expect(shiftDashboard(state, 'demo-shift-01')?.rows).toEqual([]);
    expect(shiftDashboard(state, 'demo-shift-01')?.inventoryRows).toEqual([]);
  });

  it('reflects negative refund events as Devolución and deducts expected cash', () => {
    const state = createDemoState();
    state.shifts[0].openingCashMinor = 50000;
    state.expenses = [];
    state.extras = [];
    state.ledger = [
      {
        id: 'sale-event-1',
        paymentId: 'sale-1',
        shiftId: 'demo-shift-01',
        kind: 'product',
        amountMinor: 2000,
        method: 'cash',
        recordedAt: '2026-10-08T10:00:00Z',
      },
      {
        id: 'refund-event-1',
        paymentId: 'sale-1',
        shiftId: 'demo-shift-01',
        kind: 'product',
        amountMinor: -2000,
        method: 'cash',
        recordedAt: '2026-10-08T11:00:00Z',
      },
    ];

    const result = shiftDashboard(state, 'demo-shift-01');
    expect(result?.cashMinor).toBe(0);
    expect(result?.confirmedMinor).toBe(0);
    expect(result?.expectedCashMinor).toBe(50000);

    const refundRow = result?.rows.find(r => r.id === 'ledger:refund-event-1');
    expect(refundRow?.description).toContain('Devolución:');
    expect(refundRow?.amountMinor).toBe(-2000);
  });
});
