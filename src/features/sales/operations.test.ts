import { describe, expect, it } from 'vitest';
import { createDemoState } from '../../demo/adapter';
import { registerSale } from '../../demo/salesOperations';
import { expectedStock, recordMovement, recordCount } from '../../demo/inventoryOperations';
import { closeShift, openShift, shiftSummary } from '../../demo/shiftOperations';
import { collectMembership } from '../../demo/operations';
import { createElement, useLayoutEffect } from 'react';
import { render, screen, within } from '@testing-library/react';
import { DemoProvider, useDemo } from '../../demo/DemoProvider';
import { Inventory } from '../inventory/Inventory';

describe('connected shift, sale and stock operations', () => {
  const request = { id: 'sale-test', kind: 'product' as const, productId: 'demo-water', quantity: 2, method: 'cash' as const };
  it('posts one complete cash product sale and reduces stock once', () => {
    const initial = createDemoState();
    const first = registerSale(initial, request);
    const duplicate = registerSale(first.state, request);
    expect(first.result.status).toBe('confirmed');
    expect(duplicate.state.ledger).toHaveLength(1);
    expect(expectedStock(duplicate.state, 'demo-water')).toBe(10);
    expect(shiftSummary(duplicate.state, initial.currentShiftId).expectedCashMinor).toBe(54000);
  });
  it('keeps transfer pending without stock reduction or confirmed revenue', () => {
    const outcome = registerSale(createDemoState(), { ...request, method: 'transfer' });
    expect(outcome.result.status).toBe('pending');
    expect(expectedStock(outcome.state, 'demo-water')).toBe(12);
    expect(outcome.state.ledger).toHaveLength(0);
  });
  it('requires explicit visit areas and prices a combo at 100 MXN', () => {
    const outcome = registerSale(createDemoState(), { id: 'visit-test', kind: 'visit', area: 'COMBO', quantity: 1, method: 'card' });
    expect(outcome.state.sales[0].amountMinor).toBe(10000);
    expect(outcome.state.ledger[0].kind).toBe('visit');
  });
  it('derives opening + restock - sold - waste and keeps physical variance separate', () => {
    let state = createDemoState();
    state = recordMovement(state, { id: 'restock', productId: 'demo-water', kind: 'restock', quantity: 5 }).state;
    state = registerSale(state, request).state;
    state = recordMovement(state, { id: 'waste', productId: 'demo-water', kind: 'waste', quantity: 1 }).state;
    expect(expectedStock(state, 'demo-water')).toBe(14);
    const counted = recordCount(state, { id: 'count', productId: 'demo-water', quantity: 13 });
    expect(counted.state.counts[0].variance).toBe(-1);
    expect(expectedStock(counted.state, 'demo-water')).toBe(14);
  });
  it('separates float from collections, closes with a cash difference and opens a new shift', () => {
    let state = createDemoState();
    state = collectMembership(state, { id: 'membership', memberId: 'demo-001', planId: 'gym-month', method: 'cash' }).state;
    state = registerSale(state, { id: 'pending', kind: 'visit', area: 'GYM', quantity: 1, method: 'transfer' }).state;
    expect(shiftSummary(state, state.currentShiftId).confirmedMinor).toBe(50000);
    expect(shiftSummary(state, state.currentShiftId).expectedCashMinor).toBe(100000);
    const closed = closeShift(state, 99000);
    expect(closed.state.shifts.find(shift => shift.id === state.currentShiftId)?.cashDifferenceMinor).toBe(-1000);
    expect(registerSale(closed.state, request).result.status).toBe('error');
    expect(collectMembership(closed.state, { id: 'after-close', memberId: 'demo-001', planId: 'gym-month', method: 'cash' }).result.status).toBe('error');
    const opened = openShift(closed.state, { id: 'next-shift', window: '14:00–22:00', openingCashMinor: 30000 });
    expect(opened.state.currentShiftId).toBe('next-shift');
    expect(shiftSummary(opened.state, 'next-shift').confirmedMinor).toBe(0);
    expect(opened.state.ledger).toHaveLength(1);
  });
  it('rejects overselling, invalid quantities and conflicting duplicate IDs', () => {
    const initial = createDemoState();
    expect(registerSale(initial, { ...request, quantity: 99 }).result.status).toBe('error');
    expect(recordMovement(initial, { id: 'x', productId: 'demo-water', kind: 'waste', quantity: -1 }).result.status).toBe('error');
    const first = registerSale(initial, request);
    expect(registerSale(first.state, { ...request, quantity: 1 }).result.status).toBe('error');
  });
  it('shows reception only current-shift breakdown while preserving carried stock across two shifts', () => {
    let state = createDemoState();
    state = recordMovement(state, { id: 'prior-restock', productId: 'demo-water', kind: 'restock', quantity: 5 }).state;
    state = registerSale(state, { ...request, id: 'prior-sale' }).state;
    state = recordMovement(state, { id: 'prior-waste', productId: 'demo-water', kind: 'waste', quantity: 1 }).state;
    state = closeShift(state, 54000).state;
    state = openShift(state, { id: 'current-shift', window: '14:00–22:00', openingCashMinor: 30000 }).state;
    state = recordMovement(state, { id: 'current-restock', productId: 'demo-water', kind: 'restock', quantity: 3 }).state;
    state = registerSale(state, { ...request, id: 'current-sale', quantity: 1 }).state;
    state = recordMovement(state, { id: 'current-waste', productId: 'demo-water', kind: 'waste', quantity: 2 }).state;
    expect(expectedStock(state, 'demo-water')).toBe(14);

    function ReceptionFixture() {
      const { update } = useDemo();
      useLayoutEffect(() => { update(() => state); }, []);
      return createElement(Inventory, { role: 'RECEPTION' });
    }
    render(createElement(DemoProvider, null, createElement(ReceptionFixture)));
    const inventory = screen.getByRole('region', { name: 'Inventario ilustrativo' });
    expect(within(inventory).getByRole('columnheader', { name: 'Existencia recibida' })).toBeVisible();
    const row = within(inventory).getAllByRole('row')[1];
    expect(within(row).getAllByRole('cell').map(cell => cell.textContent)).toEqual([
      'Agua · producto ilustrativo', '14', '+3', '−1', '−2', '14',
    ]);
    expect(screen.queryByText('prior-restock')).not.toBeInTheDocument();
    expect(screen.queryByText('prior-sale')).not.toBeInTheDocument();
    expect(screen.queryByText('prior-waste')).not.toBeInTheDocument();
    expect(screen.getByText('current-restock')).toBeVisible();
  });
});
