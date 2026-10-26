import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listStaffAttendance,
  recordStaffAttendance,
  recordStaffCheckout,
  correctStaffAttendance,
  OperationalApiHttpError,
  OperationalApiNetworkError,
  type StaffAttendanceItem,
} from './staffAttendanceApi';

const branchId = '00000000-0000-4000-8000-000000000001';

beforeEach(() => {
  sessionStorage.clear();
  vi.unstubAllEnvs();
  vi.stubEnv('VITE_API_BASE_URL', 'https://gym.example');
  vi.stubEnv('VITE_BRANCH_ID', branchId);
  vi.restoreAllMocks();
});

describe('staffAttendanceApi', () => {
  const mockAttendanceItem: StaffAttendanceItem = {
    id: 'att-123',
    profile_id: 'prof-456',
    branch_id: branchId,
    full_name: 'Carlos Ruiz',
    position: 'Entrenador',
    recorded_by: 'Sheila Recepción',
    occurred_at: '2026-10-23T08:00:00Z',
    business_date: '2026-10-23',
    status: 'present',
    expected_entry_time: '08:00:00',
    grace_tolerance_minutes: 15,
    checkout_at: null,
    checkout_recorded_by: null,
    series_id: 'series-789',
    occurrence_date: '2026-10-23',
    device_captured_at: '2026-10-23T07:59:00Z',
    server_received_at: '2026-10-23T08:00:01Z',
    idempotency_key: 'idem-key-12345',
    clock_validation_status: 'accepted',
    review_required: false,
    schedule_conflict: false,
  };

  describe('listStaffAttendance', () => {
    it('fetches staff attendance with branch and business date', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [mockAttendanceItem],
            total: 1,
          }),
          { status: 200 }
        )
      );

      sessionStorage.setItem('evogym:operational-session', 'test-token');

      const result = await listStaffAttendance('2026-10-23');

      expect(fetchMock).toHaveBeenCalledWith(
        `https://gym.example/api/v1/staff-attendance?branch_id=${branchId}&business_date=2026-10-23`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('att-123');
      expect(result.total).toBe(1);
    });

    it('allows overriding token and branchId', async () => {
      const customBranch = '00000000-0000-4000-8000-000000000002';
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 })
      );

      await listStaffAttendance(undefined, 'custom-token', customBranch);

      expect(fetchMock).toHaveBeenCalledWith(
        `https://gym.example/api/v1/staff-attendance?branch_id=${customBranch}`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer custom-token',
          }),
        })
      );
    });
  });

  describe('recordStaffAttendance', () => {
    it('sends POST to branch profile path with payload and idempotency key', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(mockAttendanceItem), { status: 201 })
      );

      const payload = {
        series_id: 'series-789',
        occurrence_date: '2026-10-23',
        device_captured_at: '2026-10-23T07:59:00Z',
        idempotency_key: 'idem-key-12345',
      };

      const result = await recordStaffAttendance('prof-456', payload, 'custom-token');

      expect(fetchMock).toHaveBeenCalledWith(
        `https://gym.example/api/v1/staff-attendance/branches/${branchId}/profiles/prof-456`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(payload),
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer custom-token',
          }),
        })
      );
      expect(result.status).toBe('present');
    });
  });

  describe('recordStaffCheckout', () => {
    it('sends POST to checkout endpoint', async () => {
      const checkoutResponse = {
        id: 'chk-1',
        attendance_id: 'att-123',
        recorded_by: 'Sheila',
        occurred_at: '2026-10-23T16:00:00Z',
      };
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(checkoutResponse), { status: 200 })
      );

      const result = await recordStaffCheckout('att-123', 'tok-1');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://gym.example/api/v1/staff-attendance/att-123/checkout',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer tok-1',
          }),
        })
      );
      expect(result.attendance_id).toBe('att-123');
    });
  });

  describe('correctStaffAttendance', () => {
    it('sends POST to corrections endpoint with payload', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ status: 'corrected' }), { status: 200 })
      );

      const correction = {
        field_name: 'status',
        original_value: 'late',
        corrected_value: 'present',
        reason: 'Ajuste por falla de transporte justificada',
      };

      await correctStaffAttendance('att-123', correction, 'tok-1');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://gym.example/api/v1/staff-attendance/att-123/corrections',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(correction),
        })
      );
    });
  });

  describe('error handling', () => {
    it('throws OperationalApiHttpError for 401 Unauthorized', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Token expired' } }), { status: 401 })
      );

      await expect(listStaffAttendance('2026-10-23', 'expired-tok')).rejects.toThrow(
        OperationalApiHttpError
      );
      await expect(listStaffAttendance('2026-10-23', 'expired-tok')).rejects.toMatchObject({
        kind: 'http',
        status: 401,
      });
    });

    it('throws OperationalApiHttpError for 403 Forbidden', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'PERMISSION_DENIED' } }), { status: 403 })
      );

      await expect(
        recordStaffAttendance('prof-456', undefined, 'forbidden-tok')
      ).rejects.toMatchObject({
        kind: 'http',
        status: 403,
      });
    });

    it('throws OperationalApiHttpError for 409 Conflict', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'ATTENDANCE_ALREADY_RECORDED',
              message: 'Turno ya registrado para esta fecha',
            },
          }),
          { status: 409 }
        )
      );

      await expect(
        recordStaffAttendance('prof-456', { idempotency_key: 'idem-1' }, 'tok')
      ).rejects.toMatchObject({
        kind: 'http',
        status: 409,
      });
    });

    it('throws OperationalApiNetworkError on network failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(listStaffAttendance('2026-10-23')).rejects.toBeInstanceOf(
        OperationalApiNetworkError
      );
    });
  });
});
