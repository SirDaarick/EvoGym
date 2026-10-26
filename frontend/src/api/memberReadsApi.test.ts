import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { getMemberReload, type MemberReloadResponse } from './memberReadsApi';
import type { ReceptionConfig } from './receptionApi';

describe('memberReadsApi - getMemberReload', () => {
  const mockConfig: ReceptionConfig = {
    apiOrigin: 'https://gym-api.example.com',
    branchId: '00000000-0000-7000-8000-000000000001',
  };

  const syntheticResponse: MemberReloadResponse = {
    profile: {
      id: '018f3a20-0000-7000-8000-000000000001',
      organization_id: '018f3a00-0000-7000-8000-000000000001',
      home_branch_id: '00000000-0000-7000-8000-000000000001',
      member_number: 'SOC-0001',
      full_name: 'Synthetic Member Test',
      preferred_name: 'Synthetic',
      phone: '+525555555555',
      email: 'synthetic@example.com',
      birth_date: '1995-05-15',
      joined_on: '2026-01-10',
      status: 'active',
      photo_url: null,
      emergency_contact_name: 'Emergency Contact',
      emergency_contact_phone: '+525555555556',
    },
    active_periods: [
      {
        id: '018f3a30-0000-7000-8000-000000000001',
        order_item_id: '018f3a40-0000-7000-8000-000000000001',
        plan_version_id: '018f3a50-0000-7000-8000-000000000001',
        plan_name: 'Membresía Mensual Pro',
        starts_on: '2026-10-01',
        ends_on: '2026-11-01',
        branch_id: null,
        is_current: true,
        access_status: 'eligible',
      },
    ],
    class_samples: [
      {
        id: '018f3a60-0000-7000-8000-000000000001',
        order_item_id: '018f3a70-0000-7000-8000-000000000001',
        plan_version_id: '018f3a80-0000-7000-8000-000000000001',
        plan_name: 'Clase Muestra Box',
        is_consumed: false,
        consumed_at: null,
        consumed_visit_id: null,
      },
    ],
    financial: {
      has_pending_balance: false,
      credit_balance_minor: 0,
      total_pending_balance_minor: 0,
      currency: 'MXN',
      debts: [],
    },
    recent_visits: [
      {
        id: '018f3a90-0000-7000-8000-000000000001',
        visit_id: '018f3aa0-0000-7000-8000-000000000001',
        branch_id: '00000000-0000-7000-8000-000000000001',
        period_id: '018f3a30-0000-7000-8000-000000000001',
        sample_entitlement_id: null,
        occurred_at: '2026-10-20T10:00:00.000Z',
        access_reason: 'valid_membership',
        access_warnings: [],
      },
    ],
    server_time: '2026-10-23T05:00:00.000Z',
  };

  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches member reload state with valid headers and parses typed response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => syntheticResponse,
    });
    globalThis.fetch = fetchMock;

    const memberId = '018f3a20-0000-7000-8000-000000000001';
    const token = 'operational-token-xyz';
    const result = await getMemberReload(memberId, token, mockConfig);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://gym-api.example.com/api/v1/members/018f3a20-0000-7000-8000-000000000001/reload');
    expect(options.method).toBe('GET');
    expect(options.headers).toEqual({
      Authorization: 'Bearer operational-token-xyz',
      Accept: 'application/json',
    });
    expect(result).toEqual(syntheticResponse);
    expect(result.profile.full_name).toBe('Synthetic Member Test');
    expect(result.active_periods[0].plan_name).toBe('Membresía Mensual Pro');
  });

  it('appends visit_limit query parameter when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => syntheticResponse,
    });
    globalThis.fetch = fetchMock;

    const memberId = '018f3a20-0000-7000-8000-000000000001';
    const token = 'token-123';
    await getMemberReload(memberId, token, mockConfig, 10);

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://gym-api.example.com/api/v1/members/018f3a20-0000-7000-8000-000000000001/reload?visit_limit=10');
  });

  it('throws meaningful error on 401 Unauthorized', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Token de acceso inválido o expirado' }),
    });

    await expect(getMemberReload('mem-1', 'bad-token', mockConfig)).rejects.toThrow(
      'Token de acceso inválido o expirado'
    );
  });

  it('throws fallback message on 401 when error body is not JSON', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => {
        throw new Error('Not JSON');
      },
    });

    await expect(getMemberReload('mem-1', 'bad-token', mockConfig)).rejects.toThrow(
      'La sesión expiró o se requiere autenticación.'
    );
  });

  it('throws meaningful error on 403 Forbidden', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ message: 'Acceso restringido a la sucursal de origen' }),
    });

    await expect(getMemberReload('mem-1', 'token-val', mockConfig)).rejects.toThrow(
      'Acceso restringido a la sucursal de origen'
    );
  });

  it('throws meaningful error on 404 Not Found', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ code: 'MEMBER_NOT_FOUND', message: 'Socio no encontrado' }),
    });

    await expect(getMemberReload('mem-missing', 'token-val', mockConfig)).rejects.toThrow(
      'Socio no encontrado'
    );
  });

  it('throws meaningful error on 422 Unprocessable Entity', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ code: 'MALFORMED_IDENTIFIER', message: 'UUID de socio inválido' }),
    });

    await expect(getMemberReload('invalid-uuid', 'token-val', mockConfig)).rejects.toThrow(
      'UUID de socio inválido'
    );
  });
});
