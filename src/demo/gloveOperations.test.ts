import { describe, expect, it } from 'vitest';
import { createDemoState } from './adapter';
import { rentGlove, returnGlove } from './gloveOperations';

describe('gloveOperations', () => {
  it('rents an available glove with cash and records ledger event', () => {
    const state = createDemoState();
    const result = rentGlove(state, {
      id: 'rental-test-01',
      gloveId: 'glove-01',
      memberId: 'demo-001',
      method: 'cash',
    });

    expect(result.result.status).toBe('paid');
    if (result.result.status === 'paid') {
      expect(result.result.glove.id).toBe('glove-01');
      expect(result.result.glove.status).toBe('rented');
      expect(result.result.glove.assignedMemberId).toBe('demo-001');
      expect(result.result.glove.assignedMemberName).toBe('Mariana López');
      expect(result.result.glove.paymentMethod).toBe('cash');
      expect(result.result.glove.paymentStatus).toBe('paid');
      expect(result.result.rental.id).toBe('rental-test-01');
    }

    const updatedGlove = result.state.gloves?.find(g => g.id === 'glove-01');
    expect(updatedGlove?.status).toBe('rented');
    expect(updatedGlove?.assignedMemberName).toBe('Mariana López');

    const ledger = result.state.ledger.find(l => l.paymentId === 'rental-test-01');
    expect(ledger).toBeDefined();
    expect(ledger?.amountMinor).toBe(2500);
    expect(ledger?.kind).toBe('product');
    expect(ledger?.method).toBe('cash');
    expect(result.state.revision).toBe(state.revision + 1);
  });

  it('rents an available glove with transfer as pending without ledger event', () => {
    const state = createDemoState();
    const result = rentGlove(state, {
      id: 'rental-test-transfer',
      gloveId: 'glove-03',
      memberId: 'demo-001',
      method: 'transfer',
    });

    expect(result.result.status).toBe('pending');
    if (result.result.status === 'pending') {
      expect(result.result.glove.paymentStatus).toBe('pending');
    }

    const ledger = result.state.ledger.find(l => l.paymentId === 'rental-test-transfer');
    expect(ledger).toBeUndefined();
  });

  it('returns idempotent result if request id matches previous rental', () => {
    const state = createDemoState();
    const first = rentGlove(state, {
      id: 'rental-idemp-1',
      gloveId: 'glove-01',
      memberId: 'demo-001',
      method: 'card',
    });
    expect(first.result.status).toBe('paid');

    const second = rentGlove(first.state, {
      id: 'rental-idemp-1',
      gloveId: 'glove-01',
      memberId: 'demo-001',
      method: 'card',
    });
    expect(second.result.status).toBe('paid');
  });

  it('rejects duplicate request id with different parameters', () => {
    const state = createDemoState();
    const first = rentGlove(state, {
      id: 'rental-mismatch-1',
      gloveId: 'glove-01',
      memberId: 'demo-001',
      method: 'cash',
    });
    expect(first.result.status).toBe('paid');

    const second = rentGlove(first.state, {
      id: 'rental-mismatch-1',
      gloveId: 'glove-03',
      memberId: 'demo-002',
      method: 'card',
    });
    expect(second.result.status).toBe('error');
    if (second.result.status === 'error') {
      expect(second.result.message).toContain('ya pertenece a otra');
    }
  });

  it('rejects renting a glove that is already rented', () => {
    const state = createDemoState();
    const result = rentGlove(state, {
      id: 'rental-fail-01',
      gloveId: 'glove-02', // already rented in seed
      memberId: 'demo-001',
      method: 'cash',
    });

    expect(result.result.status).toBe('error');
    if (result.result.status === 'error') {
      expect(result.result.message).toContain('no está disponible');
    }
  });

  it('rejects renting if member does not exist', () => {
    const state = createDemoState();
    const result = rentGlove(state, {
      id: 'rental-fail-02',
      gloveId: 'glove-01',
      memberId: 'non-existent',
      method: 'cash',
    });

    expect(result.result.status).toBe('error');
    if (result.result.status === 'error') {
      expect(result.result.message).toContain('Socio no encontrado');
    }
  });

  it('rejects renting if current shift is closed or missing', () => {
    const state = createDemoState();
    const closedState = {
      ...state,
      shifts: state.shifts.map(s => ({ ...s, status: 'closed' as const })),
    };
    const result = rentGlove(closedState, {
      id: 'rental-fail-03',
      gloveId: 'glove-01',
      memberId: 'demo-001',
      method: 'cash',
    });

    expect(result.result.status).toBe('error');
    if (result.result.status === 'error') {
      expect(result.result.message).toContain('Abre un turno');
    }
  });

  it('returns a rented glove successfully and marks rental record as returned', () => {
    const state = createDemoState();
    const result = returnGlove(state, 'glove-02');

    expect(result.result.status).toBe('returned');
    if (result.result.status === 'returned') {
      expect(result.result.glove.status).toBe('available');
      expect(result.result.glove.assignedMemberId).toBeNull();
      expect(result.result.glove.assignedMemberName).toBeNull();
      expect(result.result.glove.assignedAt).toBeNull();
      expect(result.result.glove.paymentMethod).toBeNull();
      expect(result.result.glove.paymentStatus).toBeNull();
      expect(result.result.rental?.returnedAt).toBeTruthy();
    }

    const updatedRental = result.state.gloveRentals?.find(r => r.gloveId === 'glove-02');
    expect(updatedRental?.returnedAt).toBeTruthy();
    expect(result.state.revision).toBe(state.revision + 1);
  });

  it('rejects returning a glove that is already available', () => {
    const state = createDemoState();
    const result = returnGlove(state, 'glove-01'); // available in seed

    expect(result.result.status).toBe('error');
    if (result.result.status === 'error') {
      expect(result.result.message).toContain('no se encuentra rentado');
    }
  });

  it('rejects returning a non-existent glove', () => {
    const state = createDemoState();
    const result = returnGlove(state, 'glove-unknown');

    expect(result.result.status).toBe('error');
    if (result.result.status === 'error') {
      expect(result.result.message).toContain('Guante no encontrado');
    }
  });
});
