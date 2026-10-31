import { describe, expect, it, vi } from 'vitest';
import {
  ProductSaleError,
  submitCashProductSale,
  submitCardProductSale,
  createCardIntent,
  getCardIntentStatus,
  cancelCardIntent,
  listEligibleProductReturns,
  submitProductReturn,
} from './productSalesApi';

describe('cash product sale API', () => {
  const payload = { member_id: null, items: [{ product_id: 'product', quantity: 2 }], expected_total_minor: 500 };

  it('posts the frozen payload and idempotency key', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      order: { id: 'order', total_minor: 500 }, items: [], payment: { method: 'cash', status: 'confirmed', amount_minor: 500 },
    }), { status: 201 }));
    await submitCashProductSale(request, 'register', payload, 'key');
    expect(request).toHaveBeenCalledWith('/api/v1/registers/register/product-sales', expect.objectContaining({
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'key' }, body: JSON.stringify(payload),
    }));
  });

  it('does not accept malformed success as a confirmed sale', async () => {
    const request = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    await expect(submitCashProductSale(request, 'register', payload, 'key')).rejects.toThrow();
  });

  it('treats an authorization denial as a definitive first-attempt rejection', async () => {
    const request = vi.fn().mockResolvedValue(new Response('{}', { status: 403 }));
    await expect(submitCashProductSale(request, 'register', payload, 'key')).rejects.toMatchObject({ definitelyRejected: true });
  });

  it('distinguishes definitive rejection from ambiguous idempotency conflicts', async () => {
    const rejected = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'product_sale_rejected' } }), { status: 409 }));
    const conflict = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'idempotency_conflict' } }), { status: 409 }));
    await expect(submitCashProductSale(rejected, 'register', payload, 'key')).rejects.toMatchObject({ definitelyRejected: true });
    await expect(submitCashProductSale(conflict, 'register', payload, 'key')).rejects.toMatchObject({ definitelyRejected: false });
    expect(new ProductSaleError(422, true).definitelyRejected).toBe(true);
  });
});

describe('card product sale API & Mercado Pago Point terminal', () => {
  const cardPayload = {
    member_id: null,
    items: [{ product_id: 'prod-card', quantity: 1 }],
    expected_total_minor: 1500,
    card_intent_id: 'intent-mp-123',
  };

  it('creates a card payment intent on register terminal', async () => {
    const mockIntent = {
      id: 'intent-mp-123',
      payment_intent_id: 'intent-mp-123',
      device_id: 'DEV-POINT-01',
      amount_minor: 1500,
      status: 'ON_TERMINAL',
    };
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(mockIntent), { status: 201 }));
    const result = await createCardIntent(request, 'reg-1', 1500, 'ref-cart-1');
    expect(request).toHaveBeenCalledWith('/api/v1/registers/reg-1/card-intent', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount_minor: 1500, external_reference: 'ref-cart-1' }),
    }));
    expect(result).toEqual(mockIntent);
  });

  it('gets card payment intent status', async () => {
    const mockStatus = {
      id: 'intent-mp-123',
      payment_intent_id: 'intent-mp-123',
      device_id: 'DEV-POINT-01',
      amount_minor: 1500,
      status: 'PROCESSED',
      authorization_code: 'AUTH-123',
      card_brand: 'VISA',
      last_four_digits: '4242',
    };
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(mockStatus), { status: 200 }));
    const result = await getCardIntentStatus(request, 'reg-1', 'intent-mp-123');
    expect(request).toHaveBeenCalledWith('/api/v1/registers/reg-1/card-intent/intent-mp-123');
    expect(result).toEqual(mockStatus);
  });

  it('cancels card payment intent', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ cancelled: true }), { status: 200 }));
    const result = await cancelCardIntent(request, 'reg-1', 'intent-mp-123');
    expect(request).toHaveBeenCalledWith('/api/v1/registers/reg-1/card-intent/intent-mp-123', { method: 'DELETE' });
    expect(result).toBe(true);
  });

  it('submits card product sale and validates payment method card', async () => {
    const mockSaleResult = {
      order: { id: 'order-c-1', total_minor: 1500, register_id: 'reg-1' },
      items: [{ id: 'item-1', product_id: 'prod-card', quantity: 1, line_total_minor: 1500 }],
      payment: {
        id: 'pay-1',
        amount_minor: 1500,
        status: 'confirmed',
        method: 'card',
        card_brand: 'VISA',
        card_last_four: '4242',
        authorization_code: 'AUTH-123',
      },
    };
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(mockSaleResult), { status: 201 }));
    const result = await submitCardProductSale(request, 'reg-1', cardPayload, 'card-key-1');
    expect(request).toHaveBeenCalledWith('/api/v1/registers/reg-1/product-sales/card', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'card-key-1' },
      body: JSON.stringify(cardPayload),
    }));
    expect(result).toEqual(mockSaleResult);
  });

  it('rejects card product sale when response has wrong method or status', async () => {
    const badMethodResult = {
      order: { id: 'order-1', total_minor: 1500 },
      items: [],
      payment: { id: 'p', amount_minor: 1500, status: 'confirmed', method: 'cash' }, // method mismatch
    };
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(badMethodResult), { status: 201 }));
    await expect(submitCardProductSale(request, 'reg-1', cardPayload, 'key')).rejects.toThrow();
  });
});

describe('product returns and refunds API', () => {
  it('lists eligible product returns for a member', async () => {
    const mockItems = [
      {
        order_item_id: 'item-1',
        order_id: 'order-1',
        product_id: 'prod-1',
        product_name: 'Water',
        quantity: 2,
        unit_amount_minor: 1200,
        line_total_minor: 2400,
        original_payment_method: 'cash',
        created_at: '2026-10-31T01:00:00Z',
      },
    ];
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(mockItems), { status: 200 }));
    const result = await listEligibleProductReturns(request, 'reg-1', 'member-1');
    expect(request).toHaveBeenCalledWith('/api/v1/registers/reg-1/members/member-1/eligible-product-returns');
    expect(result).toEqual(mockItems);
  });

  it('throws when listEligibleProductReturns fails', async () => {
    const request = vi.fn().mockResolvedValue(new Response('{}', { status: 500 }));
    await expect(listEligibleProductReturns(request, 'reg-1', 'member-1')).rejects.toThrow(
      'No se pudieron consultar los productos elegibles para devolución.'
    );
  });

  it('submits a product return with idempotency key', async () => {
    const mockRefund = {
      id: 'refund-1',
      order_item_id: 'item-1',
      branch_id: 'branch-1',
      register_id: 'reg-1',
      shift_id: 'shift-1',
      financial_shift_id: 'shift-1',
      actor_id: 'actor-1',
      reason: 'Cliente cambió de opinión',
      disposition: 'restock',
      payout_method: 'cash',
      amount_minor: 2400,
      quantity: 2,
      idempotency_key: 'key-123',
      created_at: '2026-10-31T01:00:00Z',
    };
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(mockRefund), { status: 201 }));
    const payload = {
      order_item_id: 'item-1',
      reason: 'Cliente cambió de opinión',
      disposition: 'restock' as const,
      payout_method: 'cash' as const,
    };
    const result = await submitProductReturn(request, 'reg-1', payload, 'key-123');
    expect(request).toHaveBeenCalledWith('/api/v1/registers/reg-1/product-returns', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'key-123' },
      body: JSON.stringify(payload),
    }));
    expect(result).toEqual(mockRefund);
  });

  it('extracts server error message when submitProductReturn fails', async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Item already returned' } }), { status: 409 })
    );
    await expect(
      submitProductReturn(
        request,
        'reg-1',
        { order_item_id: 'item-1', reason: 'r', disposition: 'restock', payout_method: 'cash' },
        'key'
      )
    ).rejects.toThrow('Item already returned');
  });
});
