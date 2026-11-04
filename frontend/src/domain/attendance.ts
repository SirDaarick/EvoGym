import type { AttendanceVisit } from './models';
import { GYM_TIME_ZONE, businessDate } from '../shared/formatters/date';

export const demoGymTimezone = GYM_TIME_ZONE;
export function attendanceDay(value: string) {
  if (!Number.isFinite(Date.parse(value))) return null;
  return businessDate(new Date(value));
}
export function attendanceClosing(value: string) {
  const day = attendanceDay(value);
  // The controlled 2026 Mexico City demo uses UTC-06. Other gym zones remain Q-02.
  return day ? new Date(`${day}T22:00:00-06:00`).toISOString() : null;
}
export function attendanceDuration(visit: AttendanceVisit): number | null {
  if (!visit.observedCheckOut || visit.autoClosedAt) return null;
  const difference = Date.parse(visit.observedCheckOut) - Date.parse(visit.observedCheckIn);
  return Number.isFinite(difference) && difference >= 0 ? difference / 60000 : null;
}
export function openAttendance(visit: AttendanceVisit) { return !visit.observedCheckOut && !visit.autoClosedAt; }

export type AttendancePeriod = 'today' | 'week' | 'month';

export const GYM_CAPACITY = 50;

export const DAYS_SPANISH = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
] as const;

export const DAYS_SHORT_SPANISH = [
  'Lun',
  'Mar',
  'Mié',
  'Jue',
  'Vie',
  'Sáb',
  'Dom',
] as const;

export interface HourlyTrafficBin {
  hour: number;             // 6..21
  hourLabel: string;        // '06:00', '07:00', etc.
  timeRange: string;        // '06:00–07:00'
  visits: number;           // Total visits for display (includes realistic baseline if sparse)
  rawVisits: number;        // Direct logged check-ins
  occupancyPercent: number; // Estimated % capacity utilized during this hour
  isPeak: boolean;
  isValley: boolean;
}

export interface DayOfWeekTrafficBin {
  dayIndex: number;         // 0 = Lunes, 6 = Domingo
  dayName: string;          // 'Lunes', 'Martes', etc.
  shortName: string;        // 'Lun', 'Mar', etc.
  visits: number;
  rawVisits: number;
  percent: number;          // % of total week visits
  isBusiest: boolean;
}

export interface OperationalTimeSlot {
  slot: 'morning' | 'afternoon' | 'night';
  name: string;             // 'Matutino', 'Vespertino', 'Nocturno'
  label: string;            // 'Matutino (06:00–12:00)'
  hoursRange: string;       // '06:00–12:00'
  visits: number;
  percent: number;
  status: 'optimal' | 'crowded' | 'opportunity';
  description: string;
}

export interface LiveOccupant {
  visitId: string;
  memberId: string;
  memberName: string;
  planName: string;
  checkInTime: string;      // ISO string
  checkInFormatted: string; // '08:00 hrs'
  elapsedMinutes: number;   // Minutes spent on site
}

export interface BusinessInsight {
  id: string;
  type: 'staffing' | 'promotion' | 'capacity' | 'retention';
  title: string;
  description: string;
  recommendation: string;
  urgency: 'high' | 'medium' | 'info';
  impact: string;
}

export interface AttendanceAnalyticsSummary {
  period: AttendancePeriod;
  gymCapacity: number;              // 50
  liveOccupancyCount: number;
  liveOccupancyPercent: number;     // vs 50
  totalVisits: number;              // Period total displayed
  rawVisitsCount: number;           // Period actual logged
  averageDurationMinutes: number;   // Average session duration
  peakHour: {
    hour: number;
    label: string;
    visits: number;
    occupancyPercent: number;
  };
  valleyHour: {
    hour: number;
    label: string;
    visits: number;
    occupancyPercent: number;
  };
  busiestDay: {
    dayIndex: number;
    dayName: string;
    visits: number;
    percent: number;
  };
  hourlyBins: HourlyTrafficBin[];
  dayOfWeekBins: DayOfWeekTrafficBin[];
  timeSlots: OperationalTimeSlot[];
  liveOccupants: LiveOccupant[];
  recommendations: BusinessInsight[];
}

export interface AttendanceAnalyticsOptions {
  includeBaseline?: boolean;
  gymCapacity?: number;
}
