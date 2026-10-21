import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getActiveMembershipPlans, getCurrentRegisterShift, getRegisters, submitMembershipCashSale, submitMembershipTransferSale, type MembershipSaleRequest } from './membershipCheckoutApi';

const branchId = '00000000-0000-4000-8000-000000000001';
beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('evogym:operational-session', 'opaque-token');
  vi.unstubAllEnvs();
  vi.stubEnv('VITE_API_BASE_URL', 'https://gym.example');
  vi.stubEnv('VITE_BRANCH_ID', branchId);
  vi.restoreAllMocks();
});

describe('membership checkout API', () => {
  it('loads active membership plans and registers with the operational bearer token', async () => {
    const plans = [{ id: 'plan-1', current_version: { id: 'published-version' }, versions: [] }];
    const registers = [{ id: 'register-1', has_open_shift: true }];
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: plans }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: registers }), { status: 200 }));

    await expect(getActiveMembershipPlans()).resolves.toEqual(plans);
    await expect(getRegisters()).resolves.toEqual(registers);
    expect(fetchMock.mock.calls[0][0]).toBe('https://gym.example/api/v1/catalog/plans?kind=membership&status=active');
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer opaque-token' });
    expect(fetchMock.mock.calls[1][0]).toBe('https://gym.example/api/v1/registers');
  });

  it('resolves the current open shift for a register ID', async () => {
    const shift = { id: 'shift-1', register_id: 'register-1', status: 'open' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(shift), { status: 200 }));
    await expect(getCurrentRegisterShift('register-1')).resolves.toEqual(shift);
    expect(fetchMock.mock.calls[0][0]).toBe('https://gym.example/api/v1/shifts/current?register_id=register-1');
  });

  it('routes cash and transfer to distinct endpoints and preserves idempotency keys exactly', async () => {
    const request: MembershipSaleRequest = { member_id: 'member-1', plan_version_id: 'version-1', source_shift_id: 'shift-1', cash_amount_minor: 1200 };
    const success = { order: { id: 'order-1' }, item: {}, payment: { status: 'confirmed' }, membership: { status: 'active' } };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(success), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(success), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(success), { status: 201 }));
    await submitMembershipCashSale('register-1', request, ' key-1 ');
    await submitMembershipTransferSale('register-1', { member_id: 'member-1', plan_version_id: 'version-1' }, 'key-2');
    await submitMembershipCashSale('register-1', request, ' key-1 ');
    expect(fetchMock.mock.calls[0][0]).toBe('https://gym.example/api/v1/registers/register-1/membership-sales');
    expect(fetchMock.mock.calls[1][0]).toBe('https://gym.example/api/v1/registers/register-1/membership-transfer-sales');
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ 'Idempotency-Key': ' key-1 ' });
    expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify(request));
    expect(fetchMock.mock.calls[2][1]?.headers).toMatchObject({ 'Idempotency-Key': ' key-1 ' });
    expect(fetchMock.mock.calls[2][1]?.body).toBe(JSON.stringify(request));
  });

  it('exposes HTTP status/message separately from an unknown network outcome', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Shift is closed' }), { status: 409 }));
    await expect(getRegisters()).rejects.toMatchObject({ status: 409, message: 'Shift is closed' });
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('network unavailable'));
    await expect(getRegisters()).rejects.toMatchObject({ kind: 'network', message: 'network unavailable' });
  });
});
