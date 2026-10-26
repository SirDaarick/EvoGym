import {
  getReceptionConfig,
  readOperationalToken,
  request,
  OperationalApiHttpError,
  OperationalApiNetworkError,
} from './receptionApi';

export { OperationalApiHttpError, OperationalApiNetworkError };

export interface StaffAttendanceItem {
  id: string;
  profile_id: string;
  branch_id: string;
  full_name: string;
  position: string;
  recorded_by: string;
  occurred_at: string;
  business_date: string;
  status: string;
  expected_entry_time: string | null;
  grace_tolerance_minutes: number | null;
  checkout_at: string | null;
  checkout_recorded_by: string | null;
  series_id: string | null;
  occurrence_date: string | null;
  device_captured_at: string | null;
  server_received_at: string;
  idempotency_key: string | null;
  clock_validation_status: string;
  review_required: boolean;
  schedule_conflict: boolean;
}

export interface StaffAttendancePage {
  items: StaffAttendanceItem[];
  total: number;
}

export interface RecordAttendancePayload {
  series_id?: string | null;
  occurrence_date?: string | null;
  device_captured_at?: string;
  idempotency_key?: string;
}

export interface StaffAttendanceCheckoutItem {
  id: string;
  attendance_id: string;
  recorded_by: string;
  occurred_at: string;
}

export interface StaffCorrectionRequest {
  field_name: string;
  original_value: string | null;
  corrected_value: string;
  reason: string;
}

export async function listStaffAttendance(
  businessDate?: string,
  token?: string,
  branchId?: string
): Promise<StaffAttendancePage> {
  const config = getReceptionConfig();
  const activeToken = token ?? readOperationalToken() ?? undefined;
  const targetBranchId = branchId ?? config.branchId;
  const params = new URLSearchParams();
  if (targetBranchId) {
    params.set('branch_id', targetBranchId);
  }
  if (businessDate) {
    params.set('business_date', businessDate);
  }
  const queryString = params.toString() ? `?${params.toString()}` : '';
  return request<StaffAttendancePage>(config, `/api/v1/staff-attendance${queryString}`, activeToken);
}

export async function recordStaffAttendance(
  profileId: string,
  payload?: RecordAttendancePayload,
  token?: string,
  branchId?: string
): Promise<StaffAttendanceItem> {
  const config = getReceptionConfig();
  const activeToken = token ?? readOperationalToken() ?? undefined;
  const targetBranchId = branchId ?? config.branchId;
  const body = payload ? JSON.stringify(payload) : JSON.stringify({});
  return request<StaffAttendanceItem>(
    config,
    `/api/v1/staff-attendance/branches/${encodeURIComponent(targetBranchId)}/profiles/${encodeURIComponent(profileId)}`,
    activeToken,
    {
      method: 'POST',
      body,
    }
  );
}

export async function recordStaffCheckout(
  attendanceId: string,
  token?: string
): Promise<StaffAttendanceCheckoutItem> {
  const config = getReceptionConfig();
  const activeToken = token ?? readOperationalToken() ?? undefined;
  return request<StaffAttendanceCheckoutItem>(
    config,
    `/api/v1/staff-attendance/${encodeURIComponent(attendanceId)}/checkout`,
    activeToken,
    {
      method: 'POST',
      body: JSON.stringify({}),
    }
  );
}

export async function correctStaffAttendance(
  attendanceId: string,
  payload: StaffCorrectionRequest,
  token?: string
): Promise<unknown> {
  const config = getReceptionConfig();
  const activeToken = token ?? readOperationalToken() ?? undefined;
  return request<unknown>(
    config,
    `/api/v1/staff-attendance/${encodeURIComponent(attendanceId)}/corrections`,
    activeToken,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
}
