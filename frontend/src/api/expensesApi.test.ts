import { describe, expect, it, vi } from 'vitest';
import { createCashContribution, listCashContributions, createShiftExpense, voidExpense, ExpenseApiError } from './expensesApi';

describe('expenses API', () => {
  it('uses the supplied idempotency key for cash contributions and lists the current shift', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ items: [], total_minor: 0 })));
    const body = { concept: 'Fund', contributor_name: 'Admin', amount_minor: 80000 };
    await createCashContribution(request, 'register/1', body, 'key-1');
    expect(request).toHaveBeenCalledWith('/api/v1/registers/register%2F1/cash-contributions', expect.objectContaining({
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'key-1' }, body: JSON.stringify(body),
    }));
    await expect(listCashContributions(request, 'register/1')).resolves.toEqual({ items: [], total_minor: 0 });
  });

  it('preserves HTTP status for expense errors', async () => {
    const request = vi.fn().mockResolvedValue(new Response('{}', { status: 409 }));
    await expect(createShiftExpense(request, 'r', { category: 'limpieza', concept: 'Soap', payee_name: 'Shop', amount_minor: 100 }, 'key'))
      .rejects.toMatchObject<Partial<ExpenseApiError>>({ status: 409 });
  });

  it('translates purchase_cancellation_requires_review 409 to an actionable message and preserves the error code', async () => {
    const errorPayload = {
      error: {
        code: 'purchase_cancellation_requires_review',
        message: 'Purchase has products already sold or consumed; administrator review is required.',
      },
    };
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(errorPayload), { status: 409 }));
    const promise = voidExpense(request, 'exp-123', 'Reversal test');
    await expect(promise).rejects.toThrow(
      'Esta compra tiene productos que ya fueron vendidos o consumidos; requiere revisión de un administrador.'
    );
    await expect(promise).rejects.toMatchObject({
      status: 409,
      code: 'purchase_cancellation_requires_review',
    });
  });
});
