import { describe, expect, it, vi } from 'vitest';
import {
  RentalApiError,
  listRentalAssets,
  createRentalAsset,
  updateRentalAsset,
  rentGlove,
  returnGlove,
  assignLocker,
  renewLocker,
  releaseLocker,
  previewLockerCancellation,
  confirmLockerCancellation,
  listRentalAlerts,
  reviewRentalAlert,
  beginRentalCardAttempt,
  getRentalCardAttempt,
} from './rentalsApi';

describe('rentalsApi client', () => {
  const branchId = 'branch-001';

  it('listRentalAssets fetches with query params', async () => {
    const mockPage = { items: [{ id: 'asset-1', code: 'G-01', kind: 'glove', price_minor: 5000 }], total: 1 };
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(mockPage), { status: 200 }));

    const result = await listRentalAssets(request, branchId, 'glove');
    expect(request).toHaveBeenCalledWith(expect.stringContaining('/api/v1/rentals/assets?branch_id=branch-001'));
    expect(result.items).toHaveLength(1);
    expect(result.items[0].code).toBe('G-01');
  });

  it('createRentalAsset posts payload to backend', async () => {
    const payload = { branch_id: branchId, kind: 'glove' as const, code: 'G-02', price_minor: 6000 };
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...payload, id: 'asset-2', is_active: true }), { status: 201 }));

    const result = await createRentalAsset(request, payload);
    expect(request).toHaveBeenCalledWith('/api/v1/rentals/assets', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(payload),
    }));
    expect(result.id).toBe('asset-2');
  });

  it('rentGlove sends Idempotency-Key header and returns RentalDTO', async () => {
    const payload = {
      branch_id: branchId,
      asset_id: 'asset-1',
      member_id: 'member-1',
      register_id: 'reg-1',
      components: [{ method: 'cash' as const, amount_minor: 5000 }],
      expected_total_minor: 5000,
      accepted_shortfall_minor: 0,
    };
    const mockRental = { id: 'rent-1', status: 'active', kind: 'glove' };
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(mockRental), { status: 201 }));

    const result = await rentGlove(request, payload, 'key-123');
    expect(request).toHaveBeenCalledWith('/api/v1/rentals/gloves', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'key-123' },
    }));
    expect(result.id).toBe('rent-1');
  });

  it('returnGlove calls end rental return route', async () => {
    const mockRental = { id: 'rent-1', status: 'returned' };
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(mockRental), { status: 200 }));

    const result = await returnGlove(request, 'rent-1', 'key-return');
    expect(request).toHaveBeenCalledWith('/api/v1/rentals/rent-1/return', expect.objectContaining({
      method: 'POST',
      headers: { 'Idempotency-Key': 'key-return' },
    }));
    expect(result.status).toBe('returned');
  });

  it('assignLocker calls lockers post route', async () => {
    const payload = {
      branch_id: branchId,
      asset_id: 'asset-lock-1',
      member_id: 'member-1',
      register_id: 'reg-1',
      components: [{ method: 'card' as const, amount_minor: 18000 }],
      expected_total_minor: 18000,
      accepted_shortfall_minor: 0,
    };
    const mockRental = { id: 'rent-lock-1', status: 'active', kind: 'locker' };
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(mockRental), { status: 201 }));

    const result = await assignLocker(request, payload, 'key-assign');
    expect(result.id).toBe('rent-lock-1');
  });

  it('renewLocker calls renewals post route', async () => {
    const payload = {
      register_id: 'reg-1',
      components: [{ method: 'cash' as const, amount_minor: 18000 }],
      expected_total_minor: 18000,
      accepted_shortfall_minor: 0,
    };
    const mockRental = { id: 'rent-lock-1', status: 'active', kind: 'locker' };
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(mockRental), { status: 201 }));

    const result = await renewLocker(request, 'rent-lock-1', payload, 'key-renew');
    expect(request).toHaveBeenCalledWith('/api/v1/rentals/rent-lock-1/renewals', expect.objectContaining({
      method: 'POST',
    }));
    expect(result.id).toBe('rent-lock-1');
  });

  it('releaseLocker calls release post route', async () => {
    const mockRental = { id: 'rent-lock-1', status: 'released' };
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(mockRental), { status: 200 }));

    const result = await releaseLocker(request, 'rent-lock-1', 'key-rel');
    expect(request).toHaveBeenCalledWith('/api/v1/rentals/rent-lock-1/release', expect.objectContaining({
      method: 'POST',
    }));
    expect(result.status).toBe('released');
  });

  it('previewLockerCancellation gets preview DTO', async () => {
    const mockPreview = { can_cancel: true, preview_token: 'tok-1', suggested_refund_minor: 9000, max_refundable_minor: 18000 };
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(mockPreview), { status: 200 }));

    const result = await previewLockerCancellation(request, 'rent-lock-1');
    expect(request).toHaveBeenCalledWith('/api/v1/rentals/rent-lock-1/cancellation-preview');
    expect(result.suggested_refund_minor).toBe(9000);
  });

  it('confirmLockerCancellation posts cancellation with reason and refund', async () => {
    const payload = {
      register_id: 'reg-1',
      preview_token: 'tok-1',
      refund_amount_minor: 9000,
      refund_method: 'cash' as const,
      reason: 'Socio cambia de residencia',
    };
    const mockCancellation = { id: 'canc-1', rental_id: 'rent-lock-1', reviewed: false };
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(mockCancellation), { status: 201 }));

    const result = await confirmLockerCancellation(request, 'rent-lock-1', payload, 'key-canc');
    expect(request).toHaveBeenCalledWith('/api/v1/rentals/rent-lock-1/cancellation', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(payload),
    }));
    expect(result.id).toBe('canc-1');
  });

  it('listRentalAlerts and reviewRentalAlert handle admin review flow', async () => {
    const mockAlerts = { items: [{ id: 'canc-1', reviewed: false, reason: 'Test' }], total: 1 };
    const listReq = vi.fn().mockResolvedValue(new Response(JSON.stringify(mockAlerts), { status: 200 }));
    const alerts = await listRentalAlerts(listReq, branchId);
    expect(alerts.items).toHaveLength(1);

    const mockReviewed = { id: 'canc-1', reviewed: true, reviewed_at: '2026-10-31T00:00:00Z' };
    const reviewReq = vi.fn().mockResolvedValue(new Response(JSON.stringify(mockReviewed), { status: 200 }));
    const reviewed = await reviewRentalAlert(reviewReq, 'canc-1');
    expect(reviewed.reviewed).toBe(true);
  });

  it('throws RentalApiError on HTTP error status with extracted message', async () => {
    const errorResponse = new Response(JSON.stringify({ detail: 'Rental asset is not available for assignment.' }), { status: 409 });
    const request = vi.fn().mockResolvedValue(errorResponse);

    await expect(returnGlove(request, 'rent-err', 'key')).rejects.toThrow(RentalApiError);
  });

  it('rentGlove forwards expected_deposit_minor', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'r', deposit_status: 'held' }), { status: 201 }));
    await rentGlove(request, {
      branch_id: branchId, asset_id: 'a', member_id: 'm', register_id: 'reg',
      components: [], expected_total_minor: 5000, accepted_shortfall_minor: 0, expected_deposit_minor: 20000,
    }, 'k');
    const body = JSON.parse((request.mock.calls[0][1] as RequestInit).body as string);
    expect(body.expected_deposit_minor).toBe(20000);
  });

  it('returnGlove and releaseLocker send the deposit body only when given', async () => {
    const request = vi.fn().mockImplementation(() => Promise.resolve(new Response('{"id":"r"}', { status: 200 })));
    await returnGlove(request, 'r1', 'k1', { register_id: 'reg', deposit_refund_minor: 10000, reason: 'Desgaste' });
    const init = request.mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'Idempotency-Key': 'k1' });
    expect(JSON.parse(init.body as string)).toEqual({ register_id: 'reg', deposit_refund_minor: 10000, reason: 'Desgaste' });

    await releaseLocker(request, 'r2', 'k2', { register_id: 'reg' });
    expect(JSON.parse((request.mock.calls[1][1] as RequestInit).body as string)).toEqual({ register_id: 'reg' });

    await releaseLocker(request, 'r3', 'k3');
    expect((request.mock.calls[2][1] as RequestInit).body).toBeUndefined();
  });

  it('updateRentalAsset patches deposit_minor', async () => {
    const request = vi.fn().mockResolvedValue(new Response('{"id":"a","deposit_minor":15000}', { status: 200 }));
    const result = await updateRentalAsset(request, 'a', { deposit_minor: 15000 });
    expect(JSON.parse((request.mock.calls[0][1] as RequestInit).body as string)).toEqual({ deposit_minor: 15000 });
    expect(result.deposit_minor).toBe(15000);
  });

  it('maps 409 and 422 deposit errors to Spanish messages', async () => {
    const mk = (status: number, detail: string) =>
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail }), { status }));
    await expect(returnGlove(mk(409, 'Deposit refund exceeds held amount.'), 'r', 'k')).rejects.toThrow(
      'El reembolso no puede exceder el depósito retenido.'
    );
    await expect(returnGlove(mk(409, 'Expected deposit does not match the asset deposit.'), 'r', 'k')).rejects.toThrow(
      /depósito cambió/
    );
    await expect(returnGlove(mk(422, 'A reason is required when retaining part of the deposit.'), 'r', 'k')).rejects.toThrow(
      /motivo/
    );
    await expect(returnGlove(mk(422, 'register_id is required'), 'r', 'k')).rejects.toThrow(/caja/);
  });

  it('beginRentalCardAttempt posts to the charge and getRentalCardAttempt reads it', async () => {
    const attempt = { id: 'att-1', status: 'pending', rental_id: 'r', charge_id: 'c', amount_minor: 5000 };
    const request = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(attempt), { status: 200 })));
    const created = await beginRentalCardAttempt(request, 'r', 'c', { register_id: 'reg', amount_minor: 5000 }, 'k-att');
    expect(request).toHaveBeenCalledWith('/api/v1/rentals/r/charges/c/card-attempts', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'k-att' },
    }));
    expect(created.status).toBe('pending');
    await getRentalCardAttempt(request, 'att-1');
    expect(request).toHaveBeenLastCalledWith('/api/v1/rentals/card-attempts/att-1');
  });

  it('reports an unconfigured card terminal (503) in Spanish', async () => {
    const request = vi.fn().mockResolvedValue(new Response('{"detail":"x"}', { status: 503 }));
    await expect(beginRentalCardAttempt(request, 'r', 'c', { register_id: 'reg', amount_minor: 1 }, 'k')).rejects.toThrow(
      /terminal de tarjeta/
    );
  });
});
