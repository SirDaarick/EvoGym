import {
  getReceptionConfig,
  readOperationalToken,
  request,
  OperationalApiHttpError,
  OperationalApiNetworkError,
} from './receptionApi';

export { OperationalApiHttpError, OperationalApiNetworkError };

export type AttendanceRequest = (path: string, init?: RequestInit) => Promise<Response>;

const HTTP_MESSAGES: Record<number, string> = {
  401: 'La sesión expiró o fue revocada. Inicia sesión nuevamente.',
  403: 'No tienes autorización para realizar esta acción.',
  409: 'La solicitud entra en conflicto con el estado actual.',
  429: 'Demasiadas solicitudes. Intenta nuevamente más tarde.',
  422: 'Revisa los datos enviados e intenta nuevamente.',
};

// Without an injected request this keeps the token/fetch behavior of receptionApi.
async function send<T>(path: string, init: RequestInit, token?: string, injected?: AttendanceRequest): Promise<T> {
  if (!injected) {
    return request<T>(getReceptionConfig(), path, token ?? readOperationalToken() ?? undefined, init);
  }
  let response: Response;
  try {
    response = await (init.body ? injected(path, { ...init, headers: { 'Content-Type': 'application/json' } }) : injected(path));
  } catch {
    throw new OperationalApiNetworkError();
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new OperationalApiHttpError(
      response.status,
      typeof body?.detail === 'string' ? body.detail : (HTTP_MESSAGES[response.status] ?? `La solicitud falló (${response.status}).`)
    );
  }
  return response.json() as Promise<T>;
}

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
  notes?: string | null;
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
  covered_profile_id?: string | null;
  notes?: string | null;
}

export type StaffAttendanceCreatePayload = RecordAttendancePayload;

export interface StaffAttendanceCheckoutItem {
  id: string;
  attendance_id: string;
  recorded_by: string;
  occurred_at: string;
}

export interface StaffAttendanceCorrectionItem {
  id: string;
  attendance_id: string;
  corrected_by: string;
  field_name: string;
  original_value: string;
  corrected_value: string;
  reason: string;
  corrected_at: string;
}

export interface StaffCorrectionRequest {
  field_name: string;
  original_value?: string | null;
  corrected_value: string;
  reason: string;
}

export async function listStaffAttendance(
  businessDate?: string,
  token?: string,
  branchId?: string,
  injected?: AttendanceRequest
): Promise<StaffAttendancePage> {
  const targetBranchId = branchId ?? getReceptionConfig().branchId;
  const params = new URLSearchParams();
  if (targetBranchId) {
    params.set('branch_id', targetBranchId);
  }
  if (businessDate) {
    params.set('business_date', businessDate);
  }
  const queryString = params.toString() ? `?${params.toString()}` : '';
  return send<StaffAttendancePage>(`/api/v1/staff-attendance${queryString}`, {}, token, injected);
}

export async function recordStaffAttendance(
  profileId: string,
  payload?: RecordAttendancePayload,
  token?: string,
  branchId?: string,
  injected?: AttendanceRequest
): Promise<StaffAttendanceItem> {
  const targetBranchId = branchId ?? getReceptionConfig().branchId;
  return send<StaffAttendanceItem>(
    `/api/v1/staff-attendance/branches/${encodeURIComponent(targetBranchId)}/profiles/${encodeURIComponent(profileId)}`,
    { method: 'POST', body: JSON.stringify(payload ?? {}) },
    token,
    injected
  );
}

export async function recordStaffCheckout(
  attendanceId: string,
  token?: string,
  idempotencyKey?: string,
  injected?: AttendanceRequest
): Promise<StaffAttendanceCheckoutItem> {
  return send<StaffAttendanceCheckoutItem>(
    `/api/v1/staff-attendance/${encodeURIComponent(attendanceId)}/checkout`,
    { method: 'POST', body: JSON.stringify(idempotencyKey ? { idempotency_key: idempotencyKey } : {}) },
    token,
    injected
  );
}

export async function correctStaffAttendance(
  attendanceId: string,
  payload: StaffCorrectionRequest,
  token?: string,
  injected?: AttendanceRequest
): Promise<StaffAttendanceCorrectionItem> {
  return send<StaffAttendanceCorrectionItem>(
    `/api/v1/staff-attendance/${encodeURIComponent(attendanceId)}/corrections`,
    { method: 'POST', body: JSON.stringify(payload) },
    token,
    injected
  );
}

export async function getStaffAttendanceCorrections(
  attendanceId: string,
  token?: string,
  injected?: AttendanceRequest
): Promise<StaffAttendanceCorrectionItem[]> {
  return send<StaffAttendanceCorrectionItem[]>(
    `/api/v1/staff-attendance/${encodeURIComponent(attendanceId)}/corrections`,
    {},
    token,
    injected
  );
}

export async function listBranchAttendanceCorrections(
  branchId?: string,
  businessDate?: string,
  token?: string,
  injected?: AttendanceRequest
): Promise<StaffAttendanceCorrectionItem[]> {
  const targetBranchId = branchId ?? getReceptionConfig().branchId;
  const params = new URLSearchParams();
  if (businessDate) {
    params.set('business_date', businessDate);
  }
  const queryString = params.toString() ? `?${params.toString()}` : '';
  return send<StaffAttendanceCorrectionItem[]>(
    `/api/v1/staff-attendance/branches/${encodeURIComponent(targetBranchId)}/corrections${queryString}`,
    {},
    token,
    injected
  );
}
