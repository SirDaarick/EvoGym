export type ScheduleRequest = (path: string, init?: RequestInit) => Promise<Response>;

export interface StaffScheduleSeriesItem {
  id: string;
  profile_id: string;
  branch_id: string;
  start_date: string;
  weekdays: number[];
  start_time: string;
  end_time: string;
  end_date: string | null;
  occurrence_count: number | null;
  cancelled_from: string | null;
}

export interface StaffScheduleOccurrenceItem {
  series_id: string;
  local_date: string;
  local_start: string;
  local_end: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  recorded_exception: 'skip' | 'override' | null;
}

export interface StaffScheduleExceptionItem {
  series_id: string;
  local_date: string;
  action: 'skip' | 'override';
  original_start_time: string;
  original_end_time: string;
  override_start_time: string | null;
  override_end_time: string | null;
  recorded_by: string;
  recorded_at: string;
}

export interface CreateSeriesPayload {
  start_date: string;
  weekdays: number[];
  start_time: string;
  end_time: string;
  end_date?: string | null;
  occurrence_count?: number | null;
}

export interface EditSeriesPayload {
  effective_date: string;
  scope: 'this_and_future' | 'series' | 'all_future';
  weekdays?: number[];
  start_time?: string;
  end_time?: string;
  end_date?: string | null;
  occurrence_count?: number | null;
}

export interface CreateExceptionPayload {
  action: 'skip' | 'override';
  start_time?: string;
  end_time?: string;
}

export function formatScheduleSummary(series?: StaffScheduleSeriesItem): string {
  if (!series || (series.cancelled_from && series.cancelled_from <= series.start_date)) {
    return 'Sin horario';
  }
  const dayNames = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const daysStr = [...series.weekdays]
    .sort((a, b) => a - b)
    .map(d => dayNames[d] ?? String(d))
    .join(', ');
  const start = series.start_time.slice(0, 5);
  const end = series.end_time.slice(0, 5);
  return `${daysStr} · ${start}–${end}`;
}

export async function listScheduleSeries(
  request: ScheduleRequest,
  branchId: string
): Promise<StaffScheduleSeriesItem[]> {
  const res = await request(`/api/v1/staff-schedules/branches/${encodeURIComponent(branchId)}`);
  if (!res.ok) {
    throw new Error(`Error al cargar turnos (${res.status})`);
  }
  return res.json() as Promise<StaffScheduleSeriesItem[]>;
}

export async function createScheduleSeries(
  request: ScheduleRequest,
  branchId: string,
  profileId: string,
  payload: CreateSeriesPayload
): Promise<StaffScheduleSeriesItem> {
  const res = await request(
    `/api/v1/staff-schedules/branches/${encodeURIComponent(branchId)}/profiles/${encodeURIComponent(profileId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.detail || `Error al crear horario (${res.status})`);
  }
  return res.json() as Promise<StaffScheduleSeriesItem>;
}

export async function listScheduleOccurrences(
  request: ScheduleRequest,
  seriesId: string,
  fromDate: string,
  toDate: string
): Promise<StaffScheduleOccurrenceItem[]> {
  const res = await request(
    `/api/v1/staff-schedules/${encodeURIComponent(seriesId)}/occurrences?from_date=${encodeURIComponent(fromDate)}&to_date=${encodeURIComponent(toDate)}`
  );
  if (!res.ok) {
    throw new Error(`Error al cargar ocurrencias (${res.status})`);
  }
  return res.json() as Promise<StaffScheduleOccurrenceItem[]>;
}

export async function editFutureScheduleSeries(
  request: ScheduleRequest,
  seriesId: string,
  payload: EditSeriesPayload
): Promise<StaffScheduleSeriesItem> {
  const res = await request(`/api/v1/staff-schedules/${encodeURIComponent(seriesId)}/edit`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.detail || `Error al editar horario (${res.status})`);
  }
  return res.json() as Promise<StaffScheduleSeriesItem>;
}

export async function createScheduleException(
  request: ScheduleRequest,
  seriesId: string,
  localDate: string,
  payload: CreateExceptionPayload
): Promise<StaffScheduleExceptionItem> {
  const res = await request(
    `/api/v1/staff-schedules/${encodeURIComponent(seriesId)}/occurrences/${encodeURIComponent(localDate)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.detail || `Error al registrar excepción (${res.status})`);
  }
  return res.json() as Promise<StaffScheduleExceptionItem>;
}

export async function cancelScheduleSeries(
  request: ScheduleRequest,
  seriesId: string
): Promise<void> {
  const res = await request(`/api/v1/staff-schedules/${encodeURIComponent(seriesId)}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 204) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.detail || `Error al cancelar horario (${res.status})`);
  }
}
