import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMember, createMemberNumber, getActiveMembershipPlans, getCurrentRegisterShift, getRegisters, submitMembershipCashSale, submitMembershipTransferSale, type CreateMemberRequest, type MembershipSaleRequest } from './membershipCheckoutApi';

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
  it('generates a compact unique member number within the backend limit', () => {
    const number = createMemberNumber();
    expect(number).toMatch(/^M[a-f0-9]{31}$/);
    expect(number).toHaveLength(32);
  });

  it('creates members with the operational token and returns the backend record', async () => {
    const member: CreateMemberRequest & { id: string } = { id: 'member-1', member_number: 'M123', full_name: 'A Person', phone: '555', email: 'a@example.test' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(member), { status: 201 }));
    await expect(createMember(member)).resolves.toEqual(member);
    expect(fetchMock.mock.calls[0][0]).toBe('https://gym.example/api/v1/members');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer opaque-token', 'Content-Type': 'application/json' }, body: JSON.stringify(member) });
  });

  it('reconciles duplicate number only when exact number and identity match', async () => {
    const request: CreateMemberRequest = { member_number: 'M123', full_name: 'A Person', phone: '555' };
    const existing = { id: 'member-1', member_number: 'M123', full_name: 'A Person', phone: '555' };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Member number already exists.' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [existing], total: 1, page: 1, limit: 100, pages: 1 }), { status: 200 }));
    await expect(createMember(request)).resolves.toEqual(existing);
    expect(fetchMock.mock.calls[1][0]).toBe('https://gym.example/api/v1/members?page=1&limit=100&search=M123&sort_by=member_number&sort_dir=asc');
  });

  it('treats a verified number collision with a different identity as a recoverable conflict', async () => {
    const request: CreateMemberRequest = { member_number: 'M123', full_name: 'A Person', phone: '555' };
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Member number already exists.' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: 'member-1', member_number: 'M123', full_name: 'Someone Else', phone: '555' }] }), { status: 200 }));
    await expect(createMember(request)).rejects.toMatchObject({ kind: 'conflict', status: 409, memberNumber: 'M123' });
  });

  it('keeps 409 reconciliation unknown when the search has no exact number', async () => {
    const request: CreateMemberRequest = { member_number: 'M123', full_name: 'A Person', phone: '555' };
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Member number already exists.' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    await expect(createMember(request)).rejects.toMatchObject({ kind: 'network' });
  });

  it('keeps 409 reconciliation unknown when the search request fails', async () => {
    const request: CreateMemberRequest = { member_number: 'M123', full_name: 'A Person', phone: '555' };
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Member number already exists.' }), { status: 409 }))
      .mockRejectedValueOnce(new TypeError('search unavailable'));
    await expect(createMember(request)).rejects.toMatchObject({ kind: 'network' });
  });

  it('keeps 409 reconciliation unknown when the search response is incomplete', async () => {
    const request: CreateMemberRequest = { member_number: 'M123', full_name: 'A Person', phone: '555' };
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Member number already exists.' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total: 0 }), { status: 200 }));
    await expect(createMember(request)).rejects.toMatchObject({ kind: 'network' });
  });

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

  it('passes through a cash sale DTO with no membership period', async () => {
    const response = { order: { id: 'order-2' }, item: {}, payment: { status: 'pending' }, membership: null };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(response), { status: 201 }));
    await expect(submitMembershipCashSale('register-1', { member_id: 'member-1', plan_version_id: 'version-1' }, 'key-3'))
      .resolves.toEqual(response);
  });

  it('exposes HTTP status/message separately from an unknown network outcome', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Shift is closed' }), { status: 409 }));
    await expect(getRegisters()).rejects.toMatchObject({ status: 409, message: 'Shift is closed' });
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('network unavailable'));
    await expect(getRegisters()).rejects.toMatchObject({ kind: 'network', message: 'network unavailable' });
  });
});
