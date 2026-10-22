import { describe, expect, it } from 'vitest';
import { createDemoState } from './adapter';
import { expectedStock } from './inventoryOperations';
import { getEligibleReturnsForMember, processReturn } from './returnOperations';
import type { DemoState } from '../domain/models';

describe('returnOperations engine', () => {
  it('identifies eligible items (products, supplements, memberships, lockers, gloves) for a member', () => {
    const base = createDemoState();
    const today = base.demoClock;
    const memberId = 'demo-001';

    const testState: DemoState = {
      ...base,
      sales: [
        {
          id: 'sale-today-1',
          kind: 'product',
          productId: 'demo-water',
          description: 'Agua purificada',
          quantity: 2,
          unitPriceMinor: 2000,
          amountMinor: 4000,
          method: 'cash',
          status: 'confirmed',
          shiftId: base.currentShiftId,
          recordedAt: today,
          memberId,
        },
      ],
      supplementSales: [
        {
          id: 'sup-sale-1',
          supplementId: 'sup-creatine',
          name: 'Creatina Monohidratada',
          scoops: 1,
          unitPriceMinor: 3500,
          amountMinor: 3500,
          method: 'card',
          status: 'confirmed',
          shiftId: base.currentShiftId,
          recordedAt: today,
          memberId,
        },
      ],
      lockers: [
        {
          id: 'locker-01',
          number: 1,
          code: '#01',
          status: 'assigned',
          monthlyPriceMinor: 25000,
          assignedMemberId: memberId,
          assignedMemberName: 'Carlos Méndez',
          assignedAt: today,
        },
      ],
      gloves: [
        {
          id: 'glove-01',
          code: '#01',
          color: 'Rojo',
          ounces: 12,
          priceMinor: 2500,
          status: 'rented',
          assignedMemberId: memberId,
          assignedMemberName: 'Carlos Méndez',
          assignedAt: today,
        },
      ],
    };

    const eligible = getEligibleReturnsForMember(testState, memberId);
    expect(eligible.length).toBeGreaterThanOrEqual(4);

    const productReturn = eligible.find(i => i.type === 'product');
    expect(productReturn?.title).toBe('Agua purificada');
    expect(productReturn?.amountMinor).toBe(4000);

    const supReturn = eligible.find(i => i.type === 'supplement');
    expect(supReturn?.title).toContain('Creatina');
    expect(supReturn?.amountMinor).toBe(3500);

    const lockerReturn = eligible.find(i => i.type === 'locker');
    expect(lockerReturn?.title).toBe('Casillero #01');

    const gloveReturn = eligible.find(i => i.type === 'glove');
    expect(gloveReturn?.title).toContain('Guantes #01');
  });

  it('processes a product return: restocks inventory, adds negative ledger event, and marks sale refunded', () => {
    const base = createDemoState();
    const today = base.demoClock;
    const memberId = 'demo-001';
    const initialStock = expectedStock(base, 'demo-water');

    const testState: DemoState = {
      ...base,
      sales: [
        {
          id: 'sale-today-ret',
          kind: 'product',
          productId: 'demo-water',
          description: 'Agua purificada',
          quantity: 2,
          unitPriceMinor: 2000,
          amountMinor: 4000,
          method: 'cash',
          status: 'confirmed',
          shiftId: base.currentShiftId,
          recordedAt: today,
          memberId,
        },
      ],
    };

    const res = processReturn(testState, {
      id: 'ret-01',
      targetType: 'product',
      targetId: 'sale-today-ret',
      memberId,
      reason: 'Cliente canceló su compra en mostrador',
    });

    expect(res.result.status).toBe('ok');
    if (res.result.status !== 'ok') return;
    expect(res.result.refundedAmountMinor).toBe(4000);

    // Stock must have increased back by 2
    expect(expectedStock(res.state, 'demo-water')).toBe(initialStock + 2);

    // Stock movement recorded
    const mov = res.state.stockMovements.find(m => m.id === 'return-stock-ret-01');
    expect(mov?.kind).toBe('restock');
    expect(mov?.quantity).toBe(2);
    expect(mov?.reason).toContain('Cliente canceló su compra en mostrador');

    // Sale marked as refunded
    const updatedSale = res.state.sales.find(s => s.id === 'sale-today-ret');
    expect(updatedSale?.refundedAt).toBeDefined();
    expect(updatedSale?.refundReason).toBe('Cliente canceló su compra en mostrador');

    // Negative ledger event added
    const ledger = res.state.ledger.find(l => l.id === 'refund-event-ret-01');
    expect(ledger?.amountMinor).toBe(-4000);
    expect(ledger?.method).toBe('cash');
  });

  it('processes a supplement return: restores scoops and adds negative ledger event', () => {
    const base = createDemoState();
    const today = base.demoClock;
    const memberId = 'demo-001';
    const initialScoops = base.supplements?.find(s => s.id === 'sup-03')?.availableScoops ?? 50;

    const testState: DemoState = {
      ...base,
      supplementSales: [
        {
          id: 'sup-sale-ret',
          supplementId: 'sup-03',
          name: 'Creatina Monohidratada',
          scoops: 2,
          unitPriceMinor: 3500,
          amountMinor: 7000,
          method: 'card',
          status: 'confirmed',
          shiftId: base.currentShiftId,
          recordedAt: today,
          memberId,
        },
      ],
    };

    const res = processReturn(testState, {
      id: 'ret-sup-01',
      targetType: 'supplement',
      targetId: 'sup-sale-ret',
      memberId,
      reason: 'Sabor no deseado',
    });

    expect(res.result.status).toBe('ok');
    if (res.result.status !== 'ok') return;

    // Scoops restored
    const updatedSup = res.state.supplements?.find(s => s.id === 'sup-03');
    expect(updatedSup?.availableScoops).toBe(initialScoops + 2);

    // Negative ledger event
    const ledger = res.state.ledger.find(l => l.id === 'refund-event-ret-sup-01');
    expect(ledger?.amountMinor).toBe(-7000);
    expect(ledger?.method).toBe('card');
  });

  it('processes an active membership return: cancels membership and adds negative ledger event', () => {
    const base = createDemoState();
    const today = base.demoClock;
    const memberId = 'demo-001';

    const testState: DemoState = {
      ...base,
      members: base.members.map(m =>
        m.id === memberId
          ? {
              ...m,
              membership: {
                planName: 'Mensual',
                startsOn: '2026-10-01',
                endsOn: '2026-10-31',
              },
              demoScenario: 'active',
            }
          : m
      ),
      payments: [
        {
          id: 'pay-ret-01',
          memberId,
          planId: 'plan-mensual',
          planName: 'Mensual',
          amountMinor: 60000,
          method: 'cash',
          status: 'paid',
          recordedAt: today,
          shiftId: base.currentShiftId,
          effectiveDates: null,
        },
      ],
    };

    const res = processReturn(testState, {
      id: 'ret-mem-01',
      targetType: 'membership',
      targetId: 'pay-ret-01',
      memberId,
      reason: 'Mudanza del socio',
    });

    expect(res.result.status).toBe('ok');
    if (res.result.status !== 'ok') return;

    // Member membership cancelled
    const updatedMember = res.state.members.find(m => m.id === memberId);
    expect(updatedMember?.membership).toBeNull();
    expect(updatedMember?.demoScenario).toBe('expired');

    // Negative ledger event
    const ledger = res.state.ledger.find(l => l.id === 'refund-event-ret-mem-01');
    expect(ledger?.amountMinor).toBe(-60000);
    expect(ledger?.kind).toBe('membership');
  });

  it('processes locker and glove returns: frees the resources and marks rentals completed', () => {
    const base = createDemoState();
    const today = base.demoClock;
    const memberId = 'demo-001';

    const testState: DemoState = {
      ...base,
      lockers: [
        {
          id: 'locker-05',
          number: 5,
          code: '#05',
          status: 'assigned',
          monthlyPriceMinor: 25000,
          assignedMemberId: memberId,
          assignedMemberName: 'Carlos Méndez',
          assignedAt: today,
        },
      ],
      gloves: [
        {
          id: 'glove-02',
          code: '#02',
          color: 'Azul',
          ounces: 14,
          priceMinor: 2500,
          status: 'rented',
          assignedMemberId: memberId,
          assignedMemberName: 'Carlos Méndez',
          assignedAt: today,
        },
      ],
    };

    // Return locker
    const resLocker = processReturn(testState, {
      id: 'ret-lock-01',
      targetType: 'locker',
      targetId: 'locker-05',
      memberId,
      reason: 'Ya no necesita casillero',
    });
    expect(resLocker.result.status).toBe('ok');
    const freedLocker = resLocker.state.lockers?.find(l => l.id === 'locker-05');
    expect(freedLocker?.status).toBe('available');
    expect(freedLocker?.assignedMemberId).toBeNull();

    // Return glove
    const resGlove = processReturn(testState, {
      id: 'ret-glv-01',
      targetType: 'glove',
      targetId: 'glove-02',
      memberId,
      reason: 'Sesión terminada antes de tiempo',
    });
    expect(resGlove.result.status).toBe('ok');
    const freedGlove = resGlove.state.gloves?.find(g => g.id === 'glove-02');
    expect(freedGlove?.status).toBe('available');
    expect(freedGlove?.assignedMemberId).toBeNull();
  });
});
