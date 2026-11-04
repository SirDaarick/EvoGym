import type { AuthenticatedRequest } from './membershipCheckoutApi';

export interface OwnerAttendanceHour { hour: number; label: string; visits: number }
export interface OwnerAttendanceHourBin {
  hour: number; hourLabel: string; timeRange: string; rawVisits: number; isPeak: boolean; isValley: boolean;
}
export interface OwnerAttendanceDayBin {
  dayIndex: number; dayName: string; shortName: string; rawVisits: number; percent: number; isBusiest: boolean;
}
export interface OwnerAttendance {
  period: { from: string; to: string; branchId: string; timezone: string };
  gymCapacity: number;
  liveOccupancyCount: number;
  liveOccupancyPercent: number;
  totalCheckIns: number;
  memberCheckIns: number;
  classSampleCheckIns: number;
  peakHour: OwnerAttendanceHour | null;
  valleyHour: OwnerAttendanceHour | null;
  busiestDay: { dayIndex: number; dayName: string; visits: number; percent: number } | null;
  hourlyBins: OwnerAttendanceHourBin[];
  dayOfWeekBins: OwnerAttendanceDayBin[];
}

interface Raw {
  period: { from: string; to: string; branch_id: string; timezone: string };
  gym_capacity: number;
  live_occupancy_count: number;
  live_occupancy_percent: number;
  total_check_ins: number;
  member_check_ins: number;
  class_sample_check_ins: number;
  peak_hour: OwnerAttendanceHour | null;
  valley_hour: OwnerAttendanceHour | null;
  busiest_day: { day_index: number; day_name: string; visits: number; percent: number } | null;
  hourly_bins: { hour: number; hour_label: string; time_range: string; raw_visits: number; is_peak: boolean; is_valley: boolean }[];
  day_of_week_bins: { day_index: number; day_name: string; short_name: string; raw_visits: number; percent: number; is_busiest: boolean }[];
}

export async function getOwnerAttendance(request: AuthenticatedRequest, period?: { from: string; to: string; branchId?: string }): Promise<OwnerAttendance> {
  const params = new URLSearchParams();
  if (period) {
    params.set('from', period.from);
    params.set('to', period.to);
    if (period.branchId) params.set('branch_id', period.branchId);
  }
  const query = params.toString();
  const response = await request(`/api/v1/owner/attendance${query ? `?${query}` : ''}`);
  if (response.status === 403) throw new Error('No tienes permiso para ver la afluencia de esta sucursal.');
  if (response.status === 422) throw new Error('El periodo seleccionado no es válido.');
  if (!response.ok) throw new Error('No se pudo cargar la afluencia del gimnasio.');
  const raw = await response.json() as Raw;
  return {
    period: { from: raw.period.from, to: raw.period.to, branchId: raw.period.branch_id, timezone: raw.period.timezone },
    gymCapacity: raw.gym_capacity,
    liveOccupancyCount: raw.live_occupancy_count,
    liveOccupancyPercent: raw.live_occupancy_percent,
    totalCheckIns: raw.total_check_ins,
    memberCheckIns: raw.member_check_ins,
    classSampleCheckIns: raw.class_sample_check_ins,
    peakHour: raw.peak_hour,
    valleyHour: raw.valley_hour,
    busiestDay: raw.busiest_day && { dayIndex: raw.busiest_day.day_index, dayName: raw.busiest_day.day_name,
      visits: raw.busiest_day.visits, percent: raw.busiest_day.percent },
    hourlyBins: raw.hourly_bins.map(bin => ({ hour: bin.hour, hourLabel: bin.hour_label, timeRange: bin.time_range,
      rawVisits: bin.raw_visits, isPeak: bin.is_peak, isValley: bin.is_valley })),
    dayOfWeekBins: raw.day_of_week_bins.map(bin => ({ dayIndex: bin.day_index, dayName: bin.day_name, shortName: bin.short_name,
      rawVisits: bin.raw_visits, percent: bin.percent, isBusiest: bin.is_busiest })),
  };
}
