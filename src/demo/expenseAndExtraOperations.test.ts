import { describe, expect, it } from 'vitest';
import { createDemoState } from './adapter';
import { registerExpense } from './expenseOperations';
import { registerExtra } from './extraOperations';

describe('expenseAndExtraOperations', () => {
  it('registers an expense successfully', () => {
    const state = createDemoState();
    const result = registerExpense(state, {
      id: 'test-expense-01',
      concept: 'Compra de cloro y trapeador',
      payeeName: 'Super Abarrotes',
      amountMinor: 8500,
    });

    expect(result.result.status).toBe('recorded');
    if (result.result.status === 'recorded') {
      expect(result.result.expense.concept).toBe('Compra de cloro y trapeador');
      expect(result.result.expense.amountMinor).toBe(8500);
      expect(result.result.expense.payeeName).toBe('Super Abarrotes');
    }

    const saved = result.state.expenses?.find(e => e.id === 'test-expense-01');
    expect(saved).toBeDefined();
  });

  it('rejects an expense with missing concept or non-positive amount', () => {
    const state = createDemoState();
    const result1 = registerExpense(state, {
      id: 'test-expense-02',
      concept: '',
      payeeName: 'Super Abarrotes',
      amountMinor: 8500,
    });
    expect(result1.result.status).toBe('error');

    const result2 = registerExpense(state, {
      id: 'test-expense-03',
      concept: 'Algo',
      payeeName: 'Super Abarrotes',
      amountMinor: 0,
    });
    expect(result2.result.status).toBe('error');
  });

  it('registers an extra successfully', () => {
    const state = createDemoState();
    const result = registerExtra(state, {
      id: 'test-extra-01',
      concept: 'Feria propia para dar cambio',
      staffName: 'Mariana López',
      amountMinor: 10000,
    });

    expect(result.result.status).toBe('recorded');
    if (result.result.status === 'recorded') {
      expect(result.result.extra.concept).toBe('Feria propia para dar cambio');
      expect(result.result.extra.amountMinor).toBe(10000);
      expect(result.result.extra.staffName).toBe('Mariana López');
    }

    const saved = result.state.extras?.find(e => e.id === 'test-extra-01');
    expect(saved).toBeDefined();
  });
});
