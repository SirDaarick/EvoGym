import { describe, expect, it } from 'vitest';
import { createDemoState } from './adapter';
import { quoteSupplementCart, registerSupplementCart } from './supplementOperations';

describe('supplementOperations', () => {
  it('quotes supplement cart correctly', () => {
    const state = createDemoState();
    const quote = quoteSupplementCart(state, [
      { supplementId: 'sup-01', scoops: 2 }, // 3500 * 2 = 7000
      { supplementId: 'sup-03', scoops: 1 }, // 2000 * 1 = 2000
    ]);
    expect(quote).not.toBeNull();
    expect(quote?.totalMinor).toBe(9000);
    expect(quote?.lines).toHaveLength(2);
  });

  it('registers supplement sale and decrements available scoops', () => {
    const state = createDemoState();
    const initialScoops = state.supplements?.find(s => s.id === 'sup-01')?.availableScoops ?? 0;

    const result = registerSupplementCart(state, {
      id: 'sup-sale-test',
      method: 'cash',
      memberId: 'demo-001',
      lines: [{ supplementId: 'sup-01', scoops: 2 }],
    });

    expect(result.result.status).toBe('confirmed');
    const updatedSup = result.state.supplements?.find(s => s.id === 'sup-01');
    expect(updatedSup?.availableScoops).toBe(initialScoops - 2);

    const ledger = result.state.ledger.find(l => l.paymentId.includes('sup-sale-test'));
    expect(ledger).toBeDefined();
    expect(ledger?.amountMinor).toBe(7000);
  });

  it('rejects sale if requested scoops exceed available stock', () => {
    const state = createDemoState();
    const result = registerSupplementCart(state, {
      id: 'sup-sale-exceed',
      method: 'cash',
      lines: [{ supplementId: 'sup-01', scoops: 999 }],
    });

    expect(result.result.status).toBe('error');
    if (result.result.status === 'error') {
      expect(result.result.message).toContain('insuficientes');
    }
  });
});
