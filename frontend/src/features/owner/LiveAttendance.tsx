import type { AttendancePeriod } from '@/domain/attendance';
import { useEffect, useState } from 'react';
import type { AuthenticatedRequest } from '../../api/membershipCheckoutApi';
import { getOwnerAttendance, type OwnerAttendance } from '../../api/ownerAttendanceApi';
import type { AttendanceAnalyticsSummary } from '@/domain/attendance';
import { addDays, businessDate, DEFAULT_BUSINESS_TIME_ZONE } from '../../shared/formatters/date';
import { Notice, PageHeader } from '../../shared/ui';
import { AttendanceAnalyticsView } from './AttendanceAnalytics';

const FIRST_HOUR = 6;
const LAST_HOUR = 21;
const DAYS_BACK: Record<AttendancePeriod, number> = { today: 0, week: 6, month: 29 };

/** from/to in the branch business date (never UTC). */
export function attendanceRange(period: AttendancePeriod, timeZone: string, now = new Date()) {
  const to = businessDate(now, timeZone);
  return { from: addDays(to, -DAYS_BACK[period]), to };
}

function extreme(value: { hour: number; label: string; visits: number } | null) {
  return value ? { ...value, occupancyPercent: 0 } : { hour: -1, label: 'Sin datos', visits: 0, occupancyPercent: 0 };
}

export function toAttendanceSummary(data: OwnerAttendance, period: AttendancePeriod): AttendanceAnalyticsSummary {
  const day = data.busiestDay;
  return {
    period,
    gymCapacity: data.gymCapacity,
    liveOccupancyCount: data.liveOccupancyCount,
    liveOccupancyPercent: data.liveOccupancyPercent,
    totalVisits: data.totalCheckIns,
    rawVisitsCount: data.totalCheckIns,
    averageDurationMinutes: 0,
    peakHour: extreme(data.peakHour),
    valleyHour: extreme(data.valleyHour),
    busiestDay: day ?? { dayIndex: -1, dayName: 'Sin datos', visits: 0, percent: 0 },
    hourlyBins: data.hourlyBins.filter(bin => bin.hour >= FIRST_HOUR && bin.hour <= LAST_HOUR).map(bin => ({
      hour: bin.hour, hourLabel: bin.hourLabel, timeRange: bin.timeRange, visits: bin.rawVisits, rawVisits: bin.rawVisits,
      occupancyPercent: 0, isPeak: bin.isPeak, isValley: bin.isValley,
    })),
    dayOfWeekBins: data.dayOfWeekBins.map(bin => ({
      dayIndex: bin.dayIndex, dayName: bin.dayName, shortName: bin.shortName, visits: bin.rawVisits,
      rawVisits: bin.rawVisits, percent: bin.percent, isBusiest: bin.isBusiest,
    })),
    timeSlots: [],
    liveOccupants: [],
    recommendations: [],
  };
}

export function LiveAttendance({ apiRequest }: { apiRequest: AuthenticatedRequest }) {
  const [period, setPeriod] = useState<AttendancePeriod>('week');
  const [timeZone, setTimeZone] = useState(DEFAULT_BUSINESS_TIME_ZONE);
  const [data, setData] = useState<OwnerAttendance | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void getOwnerAttendance(apiRequest, attendanceRange(period, timeZone)).then(result => {
      if (!active) return;
      // The branch zone is only known from the response; refetch once if it differs from the assumed one.
      if (result.period.timezone && result.period.timezone !== timeZone) { setTimeZone(result.period.timezone); return; }
      setData(result);
      setLoading(false);
    }).catch(err => {
      if (!active) return;
      setError(err instanceof Error ? err.message : 'No se pudo cargar la afluencia del gimnasio.');
      setLoading(false);
    });
    return () => { active = false; };
  }, [apiRequest, period, timeZone]);

  if (!data) return <div className="attendance-analytics-page">
    <PageHeader eyebrow="PROPIETARIO · AFLUENCIA Y AFORO" title="Afluencia y capacidad del gimnasio"
      description="Ocupación en vivo, horas pico y patrones semanales de tráfico." />
    {loading && <p role="status">Cargando afluencia…</p>}
    {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
  </div>;
  return <>
    {loading && <p role="status">Actualizando afluencia…</p>}
    {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
    <AttendanceAnalyticsView live analytics={toAttendanceSummary(data, period)} period={period} setPeriod={setPeriod} />
  </>;
}
