import { describe, expect, it, vi } from 'vitest';
import {
  createTransferReviewIdempotencyKey,
  getPendingMoney,
  PendingMoneyApiError,
  reviewTransferPayment,
  type PendingMoneyResponse,
} from './pendingMoneyApi';
import type { AuthenticatedRequest } from './membershipCheckoutApi';

describe('pendingMoneyApi (F07-F01)', () => {
  const sampleResponse: PendingMoneyResponse = {
    items: [
      {
        item_type: 'pending_transfer',
        branch_id: 'branch-1',
        branch_name: 'Sucursal Centro',
        member_id: 'member-1',
        member_number: 'SOC-101',
        member_name: 'Laura Méndez',
        order_id: 'order-tx-1',
        amount_minor: 125000,
        currency: 'MXN',
        source_event_id: 'payment-tx-1',
        source_event_at: '2026-10-28T14:00:00Z',
        status: 'under_review',
        status_event_id: null,
        status_event_at: null,
        initial_amount_minor: null,
        paid_amount_minor: null,
      },
      {
        item_type: 'membership_debt',
        branch_id: 'branch-1',
        branch_name: 'Sucursal Centro',
        member_id: 'member-2',
        member_number: 'SOC-102',
        member_name: 'Pedro Solís',
        order_id: 'order-debt-1',
        amount_minor: 35000,
        currency: 'MXN',
        source_event_id: 'debt-1',
        source_event_at: '2026-10-28T12:00:00Z',
        status: 'outstanding',
        status_event_id: null,
        status_event_at: null,
        initial_amount_minor: 50000,
        paid_amount_minor: 15000,
      },
    ],
    total_items: 2,
    total_pending_minor: 160000,
  };

  it('requests GET /api/v1/admin/pending-money with and without branch_id query parameter', async () => {
    const mockRequest = vi.fn<AuthenticatedRequest>(async () => {
      return new Response(JSON.stringify(sampleResponse), { status: 200 });
    });

    const allResult = await getPendingMoney({ apiRequest: mockRequest });
    expect(allResult).toEqual(sampleResponse);
    expect(mockRequest).toHaveBeenCalledWith('/api/v1/admin/pending-money', expect.any(Object));

    await getPendingMoney({ branchId: 'branch-uuid-123', apiRequest: mockRequest });
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/admin/pending-money?branch_id=branch-uuid-123',
      expect.any(Object),
    );
  });

  it('posts transfer review decisions (confirmed and pending) with Idempotency-Key header', async () => {
    const reviewResponse = {
      order: { id: 'order-tx-1' },
      item: { id: 'item-tx-1' },
      payment: { id: 'payment-tx-1', status: 'confirmed' },
      membership: { id: 'period-tx-1', starts_on: '2026-10-28', ends_on: '2026-11-28' },
    };
    const mockRequest = vi.fn<AuthenticatedRequest>(async () => {
      return new Response(JSON.stringify(reviewResponse), { status: 200 });
    });

    const key1 = createTransferReviewIdempotencyKey();
    const res1 = await reviewTransferPayment('payment-tx-1', { status: 'confirmed' }, key1, mockRequest);
    expect(res1).toEqual(reviewResponse);
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/registers/transfer-payments/payment-tx-1/review',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'Idempotency-Key': key1,
        }),
        body: JSON.stringify({ status: 'confirmed' }),
      }),
    );

    const key2 = createTransferReviewIdempotencyKey();
    await reviewTransferPayment('payment-tx-1', { status: 'pending' }, key2, mockRequest);
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/registers/transfer-payments/payment-tx-1/review',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Idempotency-Key': key2,
        }),
        body: JSON.stringify({ status: 'pending' }),
      }),
    );
  });

  it('propagates 403 Forbidden and 409 Conflict errors via PendingMoneyApiError', async () => {
    const mockRequest = vi.fn<AuthenticatedRequest>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Forbidden branch access' }), { status: 403 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Confirmed transfer payments cannot be marked pending.' }), { status: 409 }),
      );

    await expect(getPendingMoney({ branchId: 'other-branch', apiRequest: mockRequest })).rejects.toMatchObject({
      name: 'PendingMoneyApiError',
      status: 403,
      message: 'Forbidden branch access',
    });

    const err = await reviewTransferPayment('payment-tx-1', { status: 'pending' }, 'key-conflict', mockRequest).catch(e => e);
    expect(err).toBeInstanceOf(PendingMoneyApiError);
    expect(err.status).toBe(409);
    expect(err.message).toBe('Confirmed transfer payments cannot be marked pending.');
  });
});
