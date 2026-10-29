import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMember,
  createMemberNumber,
  getActiveMembershipPlans,
  getCurrentRegisterShift,
  getRegisters,
  listRegisterMemberOpenDebts,
  MembershipCheckoutApiError,
  submitMembershipCashSale,
  submitMembershipDebtPayment,
  submitMembershipTransferSale,
  type AuthenticatedRequest,
  type CreateMemberRequest,
  type MembershipSaleRequest,
  type RegisterMemberOpenDebt,
} from './membershipCheckoutApi';

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
    const plans = [{
      id: 'plan-1', code: 'month', name: 'Mensual', kind: 'membership', status: 'active',
      created_at: '2026-10-22T00:00:00Z', updated_at: '2026-10-22T00:00:00Z',
      current_version: {
        id: 'published-version', plan_id: 'plan-1', version_number: 1, name: 'Mensual',
        price_minor: 50000, currency: 'MXN', reference_amount_minor: null,
        duration_value: 1, duration_unit: 'month', entitlement_mode: 'period',
        eligibility_type: null, restriction_notes: null, is_active: true,
        published_at: '2026-10-22T00:00:00Z', services: [],
      },
      versions: [], future_field: true,
    }];
    const registers = [{ id: 'register-1', branch_id: branchId, code: 'front', name: 'Caja', status: 'active', has_open_shift: true }];
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(plans), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(registers), { status: 200 }));

    await expect(getActiveMembershipPlans()).resolves.toEqual(plans);
    await expect(getRegisters()).resolves.toEqual(registers);
    expect(fetchMock.mock.calls[0][0]).toBe('https://gym.example/api/v1/catalog/plans?kind=membership&status=active');
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer opaque-token' });
    expect(fetchMock.mock.calls[1][0]).toBe('https://gym.example/api/v1/registers');
  });

  it('resolves the current open shift for a register ID', async () => {
    const shift = { id: 'shift-1', cash_register_id: 'register-1', status: 'open' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(shift), { status: 200 }));
    await expect(getCurrentRegisterShift('register-1')).resolves.toEqual(shift);
    expect(fetchMock.mock.calls[0][0]).toBe('https://gym.example/api/v1/shifts/current?register_id=register-1');
  });

  it.each([getActiveMembershipPlans, getRegisters])('accepts an empty serialized list', async (load) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));
    await expect(load()).resolves.toEqual([]);
  });

  it.each([
    { current_version: null, versions: [{ id: 'old-version', price_minor: 1 }] },
    { current_version: { id: 'sample-version', price_minor: 0, entitlement_mode: 'single_entry', duration_value: null, duration_unit: null }, versions: [] },
  ])('preserves unpublished and free sample plan semantics', async (fields) => {
    const plans = [{ id: 'plan-1', kind: 'membership', ...fields }];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(plans), { status: 200 }));
    await expect(getActiveMembershipPlans()).resolves.toEqual(plans);
  });

  it.each([
    {}, { items: [] }, [null], [{ id: '', current_version: null }],
    [{ id: 'plan-1', current_version: { id: 'version-1', price_minor: -1 } }],
    [{ id: 'plan-1', current_version: { id: 'version-1', price_minor: 1.5 } }],
    [{ id: 'plan-1', current_version: { id: 'version-1', price_minor: '50000' } }],
    [{ id: 'plan-1', current_version: { id: 42, price_minor: 50000 } }],
  ].map(body => ({ body })))('rejects malformed plan response $body', async ({ body }) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    await expect(getActiveMembershipPlans()).rejects.toThrow();
  });

  it.each([{}, { items: [] }, [null], [{ id: 'register-1', has_open_shift: 'true' }], [{ id: '', has_open_shift: true }]].map(body => ({ body })))('rejects malformed register response $body', async ({ body }) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    await expect(getRegisters()).rejects.toThrow();
  });

  it.each([null, {}, { id: 'shift-1', register_id: 'register-1' }, { id: '', cash_register_id: 'register-1' }])('rejects malformed current-shift response %j', async (body) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    await expect(getCurrentRegisterShift('register-1')).rejects.toThrow();
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'http_error', message: 'Shift is closed', request_id: 'conflict-id' } }), { status: 409 }));
    await expect(getRegisters()).rejects.toMatchObject({ kind: 'http', status: 409, requestId: 'conflict-id', message: 'La solicitud entra en conflicto con el estado actual.' });
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('network unavailable'));
    await expect(getRegisters()).rejects.toMatchObject({ kind: 'network', message: 'No se pudo conectar con el servidor. Intenta nuevamente.' });
  });

  it('preserves typed metadata and safe mapped messages for checkout HTTP failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'SHIFT_CLOSED', message: 'internal database secret', request_id: 'body-id' } }), { status: 403, headers: { 'X-Request-ID': 'header-id' } }));
    await expect(getRegisters()).rejects.toMatchObject({
      kind: 'http', status: 403, code: 'SHIFT_CLOSED', requestId: 'header-id',
      message: expect.not.stringContaining('internal database secret'),
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: { request_id: 'retry-id' } }), { status: 429 }));
    await expect(getRegisters()).rejects.toMatchObject({ status: 429, requestId: 'retry-id' });
  });

  it('uses injected apiRequest transport, sends headers, and maps network and HTTP errors', async () => {
    sessionStorage.clear();
    const saleResponse = {
      order: { id: 'order-live' },
      item: { id: 'item-live' },
      payment: { status: 'confirmed' },
      membership: { id: 'mem-1', starts_on: '2026-10-28', ends_on: '2026-11-28' },
      sample_entitlement: null,
    };

    const mockRequest = vi.fn<AuthenticatedRequest>(async (path, init) => {
      if (path.includes('membership-sales') && init?.method === 'POST') {
        return new Response(JSON.stringify(saleResponse), { status: 201 });
      }
      if (path.includes('membership-transfer-sales') && init?.method === 'POST') {
        return new Response(JSON.stringify(saleResponse), { status: 201 });
      }
      return new Response('{}', { status: 200 });
    });

    const cashReq: MembershipSaleRequest = {
      member_id: 'member-10',
      plan_version_id: 'plan-v1',
      source_shift_id: 'shift-10',
      cash_amount_minor: 50000,
    };
    const cashResult = await submitMembershipCashSale('reg-1', cashReq, 'idemp-cash-1', mockRequest);
    expect(cashResult).toEqual(saleResponse);
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/registers/reg-1/membership-sales',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idemp-cash-1',
        }),
        body: JSON.stringify(cashReq),
      }),
    );

    const transferResult = await submitMembershipTransferSale('reg-1', { member_id: 'member-10', plan_version_id: 'plan-v1' }, 'idemp-tx-1', mockRequest);
    expect(transferResult).toEqual(saleResponse);
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/registers/reg-1/membership-transfer-sales',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idemp-tx-1',
        }),
      }),
    );

    // Network error mapping
    mockRequest.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(submitMembershipCashSale('reg-1', cashReq, 'idemp-cash-2', mockRequest))
      .rejects.toMatchObject({ kind: 'network' });

    // HTTP error mapping: 403, 409, 422
    mockRequest.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'No access' } }), { status: 403 }));
    await expect(submitMembershipCashSale('reg-1', cashReq, 'idemp-cash-3', mockRequest))
      .rejects.toMatchObject({ kind: 'http', status: 403 });

    mockRequest.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'SHIFT_CLOSED', message: 'Shift closed' } }), { status: 409 }));
    await expect(submitMembershipCashSale('reg-1', cashReq, 'idemp-cash-4', mockRequest))
      .rejects.toMatchObject({ kind: 'http', status: 409 });

    mockRequest.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'UNPROCESSABLE', message: 'Invalid payload' } }), { status: 422 }));
    await expect(submitMembershipCashSale('reg-1', cashReq, 'idemp-cash-5', mockRequest))
      .rejects.toMatchObject({ kind: 'http', status: 422 });
  });

  it('F06-F01: lists branch-scoped open debts and posts register debt payments with Idempotency-Key and error propagation', async () => {
    const openDebts: RegisterMemberOpenDebt[] = [
      {
        debt_id: 'debt-f06-1',
        order_id: 'order-f06-1',
        member_id: 'member-f06-1',
        branch_id: branchId,
        currency: 'MXN',
        description_snapshot: 'Mensualidad Pro',
        initial_outstanding_minor: 6000,
        paid_amount_minor: 2000,
        remaining_balance_minor: 4000,
        created_at: '2026-10-28T10:00:00Z',
      },
    ];
    const receipt = {
      id: 'receipt-f06-1',
      debt_id: 'debt-f06-1',
      order_id: 'order-f06-1',
      member_id: 'member-f06-1',
      branch_id: branchId,
      register_id: 'reg-f06-1',
      shift_id: 'shift-f06-1',
      amount_minor: 2500,
      remaining_balance_minor: 1500,
      received_by: 'staff-1',
      received_at: '2026-10-28T11:00:00Z',
    };

    const mockRequest = vi.fn<AuthenticatedRequest>(async (path, init) => {
      if (path === '/api/v1/registers/reg-f06-1/members/member-f06-1/debts' && (!init?.method || init.method === 'GET')) {
        return new Response(JSON.stringify(openDebts), { status: 200 });
      }
      if (path === '/api/v1/registers/reg-f06-1/membership-debt-payments' && init?.method === 'POST') {
        return new Response(JSON.stringify(receipt), { status: 201 });
      }
      return new Response('{}', { status: 200 });
    });

    await expect(listRegisterMemberOpenDebts('reg-f06-1', 'member-f06-1', mockRequest)).resolves.toEqual(openDebts);
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/registers/reg-f06-1/members/member-f06-1/debts',
      expect.any(Object),
    );

    const repayResult = await submitMembershipDebtPayment(
      'reg-f06-1',
      { order_id: 'order-f06-1', amount_minor: 2500 },
      'idemp-debt-f06-1',
      mockRequest,
    );
    expect(repayResult).toEqual(receipt);
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/registers/reg-f06-1/membership-debt-payments',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idemp-debt-f06-1',
        }),
        body: JSON.stringify({ order_id: 'order-f06-1', amount_minor: 2500 }),
      }),
    );

    mockRequest.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'CONFLICT', message: 'Repayment cannot exceed the remaining membership debt.' } }), { status: 409 }),
    );
    await expect(
      submitMembershipDebtPayment('reg-f06-1', { order_id: 'order-f06-1', amount_minor: 9999 }, 'idemp-debt-over', mockRequest),
    ).rejects.toBeInstanceOf(MembershipCheckoutApiError);
  });
});

