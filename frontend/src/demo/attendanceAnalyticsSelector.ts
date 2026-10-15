import type { AttendanceVisit, Member } from '../domain/models';
import { attendanceDay, attendanceDuration, openAttendance } from './attendanceOperations';

export type AttendancePeriod = 'today' | 'week' | 'month';

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

// Realistic commercial gym hourly distribution weights (06:00 to 22:00, 16 operating hours)
// Peak: 19:00 (15%), Valley: 11:00 (2.5%) / 13:00 (3%)
export const BASELINE_HOURLY_WEIGHTS: Record<number, number> = {
  6: 0.04,   // 06:00–07:00 (Early risers)
  7: 0.07,   // 07:00–08:00
  8: 0.09,   // 08:00–09:00 (Morning surge)
  9: 0.06,   // 09:00–10:00
  10: 0.04,  // 10:00–11:00
  11: 0.025, // 11:00–12:00 (Midday valley)
  12: 0.03,  // 12:00–13:00 (Lunch transition)
  13: 0.03,  // 13:00–14:00 (Afternoon lull)
  14: 0.035, // 14:00–15:00
  15: 0.04,  // 15:00–16:00
  16: 0.06,  // 16:00–17:00 (After school/work starts)
  17: 0.08,  // 17:00–18:00
  18: 0.13,  // 18:00–19:00 (Evening rush)
  19: 0.15,  // 19:00–20:00 (Daily peak)
  20: 0.08,  // 20:00–21:00
  21: 0.04,  // 21:00–22:00 (Closing wind-down)
};

// Realistic fitness club day of week traffic distribution weights (sum = 1.0)
export const BASELINE_DAY_WEIGHTS: Record<number, number> = {
  0: 0.22, // Lunes (Busiest)
  1: 0.19, // Martes
  2: 0.18, // Miércoles
  3: 0.16, // Jueves
  4: 0.12, // Viernes
  5: 0.08, // Sábado
  6: 0.05, // Domingo
};

/**
 * Returns the local hour (0..23) in America/Mexico_City timezone.
 */
export function getHourInGymTz(dateStr: string): number {
  const d = new Date(dateStr);
  if (!Number.isFinite(d.getTime())) return 0;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(d);
  const hourPart = parts.find(p => p.type === 'hour')?.value ?? '0';
  return parseInt(hourPart, 10);
}

/**
 * Returns 0 for Monday (Lunes) ... 6 for Sunday (Domingo) in America/Mexico_City.
 */
export function getDayOfWeekInGymTz(dateStr: string): number {
  const d = new Date(dateStr);
  if (!Number.isFinite(d.getTime())) return 0;
  const weekdayShort = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    weekday: 'short',
  }).format(d);
  const map: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  return map[weekdayShort] ?? 0;
}

/**
 * Formats a time string in Mexico City as 'HH:mm hrs'.
 */
export function formatTimeInGymTz(dateStr: string): string {
  const d = new Date(dateStr);
  if (!Number.isFinite(d.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const hour = parts.find(p => p.type === 'hour')?.value ?? '00';
  const minute = parts.find(p => p.type === 'minute')?.value ?? '00';
  return `${hour}:${minute} hrs`;
}

/**
 * Filter visits by selected period relative to current clock.
 */
export function filterVisitsByPeriod(
  visits: AttendanceVisit[],
  currentClock: string,
  period: AttendancePeriod
): AttendanceVisit[] {
  const nowMs = Date.parse(currentClock);
  if (!Number.isFinite(nowMs)) return visits;

  if (period === 'today') {
    const todayStr = attendanceDay(currentClock);
    if (!todayStr) return visits;
    return visits.filter(v => attendanceDay(v.observedCheckIn) === todayStr);
  }

  const daysBack = period === 'week' ? 7 : 30;
  const cutoffMs = nowMs - daysBack * 86400000;
  // Include visits up to now + 1 minute grace
  return visits.filter(v => {
    const vMs = Date.parse(v.observedCheckIn);
    return Number.isFinite(vMs) && vMs >= cutoffMs && vMs <= nowMs + 60000;
  });
}

/**
 * Computes business recommendations for the gym owner based on attendance analytics.
 */
export function generateAttendanceRecommendations(summary: {
  liveOccupancyCount: number;
  liveOccupancyPercent: number;
  peakHour: { hour: number; label: string; visits: number; occupancyPercent: number };
  valleyHour: { hour: number; label: string; visits: number; occupancyPercent: number };
  busiestDay: { dayName: string; percent: number };
  averageDurationMinutes: number;
  timeSlots: OperationalTimeSlot[];
}): BusinessInsight[] {
  const insights: BusinessInsight[] = [];

  // 1. Staffing insight for peak hours
  insights.push({
    id: 'staffing-peak',
    type: 'staffing',
    title: `Refuerzo de personal en hora pico (${summary.peakHour.label})`,
    description: `La mayor afluencia se concentra entre las 18:00 y las 20:00 hrs, con pico máximo en ${summary.peakHour.label} alcanzando ${summary.peakHour.occupancyPercent}% de aforo estimado.`,
    recommendation: 'Asignar un coach de piso exclusivo y habilitar validación rápida en recepción para agilizar torniquetes y rotación de mancuernas.',
    urgency: summary.peakHour.occupancyPercent >= 70 ? 'high' : 'medium',
    impact: 'Reduce aglomeraciones, previene cuellos de botella y mejora la satisfacción del socio (NPS).',
  });

  // 2. Off-peak promotion opportunity
  insights.push({
    id: 'off-peak-promo',
    type: 'promotion',
    title: `Campaña comercial para horario valle (${summary.valleyHour.label})`,
    description: `La afluencia desciende a su mínimo en ${summary.valleyHour.label} con solo ${summary.valleyHour.occupancyPercent}% de aforo ocupado, representando capacidad ociosa en sala.`,
    recommendation: 'Lanzar el "Plan Matutino / Home Office" o pases con descuento exclusivo de 11:00 a 14:00 hrs para atraer estudiantes y profesionistas remotos.',
    urgency: 'medium',
    impact: 'Monetiza metros cuadrados disponibles sin saturar los horarios estelares de la tarde.',
  });

  // 3. Live capacity safety & room headroom
  const isHighOccupancy = summary.liveOccupancyPercent >= 75;
  insights.push({
    id: 'capacity-monitor',
    type: 'capacity',
    title: `Monitoreo de aforo en sala (${summary.liveOccupancyCount} / ${GYM_CAPACITY} socios)`,
    description: `Ocupación actual al ${summary.liveOccupancyPercent}% de la capacidad máxima normada (50 personas simultáneas).`,
    recommendation: isHighOccupancy
      ? 'Aforo elevado: mantener supervisión continua en recepción para dosificar ingresos.'
      : 'Aforo en rango óptimo: libre circulación en áreas de cardio y peso libre.',
    urgency: isHighOccupancy ? 'high' : 'info',
    impact: 'Garantiza la seguridad de los socios y cumplimiento de normas de protección civil.',
  });

  // 4. Weekly momentum & retention
  insights.push({
    id: 'busiest-day-prep',
    type: 'retention',
    title: `Preparación para ${summary.busiestDay.dayName} (${summary.busiestDay.percent}% del volumen semanal)`,
    description: `El ${summary.busiestDay.dayName} es el día con mayor disciplina y asistencia registrada de la semana.`,
    recommendation: 'Asegurar stock completo de suplementos, toallas limpias y casilleros listos desde el primer turno matutino.',
    urgency: 'info',
    impact: 'Maximiza venta cruzada de batidos de proteína e hidratantes al iniciar la semana.',
  });

  return insights;
}

/**
 * Main pure selector function for gym attendance and traffic analytics.
 */
export function getAttendanceAnalytics(
  visits: AttendanceVisit[],
  members: Member[],
  currentClock: string,
  period: AttendancePeriod = 'week',
  options?: AttendanceAnalyticsOptions
): AttendanceAnalyticsSummary {
  const capacity = options?.gymCapacity ?? GYM_CAPACITY;
  const includeBaseline = options?.includeBaseline ?? true;

  // 1. Live Occupants (currently inside gym: open attendance)
  const nowMs = Date.parse(currentClock);
  const liveVisits = visits.filter(v => openAttendance(v));
  const memberMap = new Map<string, Member>(members.map(m => [m.id, m]));

  const liveOccupants: LiveOccupant[] = liveVisits
    .map(visit => {
      const member = memberMap.get(visit.memberId);
      const checkInMs = Date.parse(visit.observedCheckIn);
      const diffMs = Number.isFinite(nowMs) && Number.isFinite(checkInMs) ? nowMs - checkInMs : 0;
      const elapsedMinutes = Math.max(0, Math.round(diffMs / 60000));

      return {
        visitId: visit.id,
        memberId: visit.memberId,
        memberName: member?.name ?? 'Socio visitante',
        planName: member?.membership?.planName ?? 'Sin plan registrado',
        checkInTime: visit.observedCheckIn,
        checkInFormatted: formatTimeInGymTz(visit.observedCheckIn),
        elapsedMinutes,
      };
    })
    .sort((a, b) => Date.parse(b.checkInTime) - Date.parse(a.checkInTime));

  const liveOccupancyCount = liveOccupants.length;
  const liveOccupancyPercent = Math.min(100, Math.round((liveOccupancyCount / capacity) * 100));

  // 2. Filter visits for historical period metrics
  const periodVisits = filterVisitsByPeriod(visits, currentClock, period);
  const rawVisitsCount = periodVisits.length;

  // 3. Average session duration (completed visits only)
  const completedVisits = periodVisits.filter(v => v.observedCheckOut && !v.autoClosedAt);
  let totalDurationMinutes = 0;
  let validDurationCount = 0;

  for (const v of completedVisits) {
    const dur = attendanceDuration(v);
    if (dur !== null && dur > 0 && dur <= 360) {
      totalDurationMinutes += dur;
      validDurationCount++;
    }
  }

  const averageDurationMinutes =
    validDurationCount > 0
      ? Math.round(totalDurationMinutes / validDurationCount)
      : includeBaseline
      ? 65 // Realistic fitness club industry baseline (~65 min workout)
      : 0;

  // 4. Hourly traffic bins (06:00 to 22:00 = 16 hours)
  const rawHourCounts: Record<number, number> = {};
  for (let h = 6; h <= 21; h++) {
    rawHourCounts[h] = 0;
  }

  for (const v of periodVisits) {
    const h = getHourInGymTz(v.observedCheckIn);
    if (h >= 6 && h <= 21) {
      rawHourCounts[h] = (rawHourCounts[h] || 0) + 1;
    }
  }

  // Determine baseline volume if check-in samples are sparse
  const isSparse = rawVisitsCount < 15;
  const baselineScale =
    period === 'today' ? 38 : period === 'week' ? 180 : 720;

  const hourlyBins: HourlyTrafficBin[] = [];
  for (let hour = 6; hour <= 21; hour++) {
    const rawCount = rawHourCounts[hour] ?? 0;
    const hourWeight = BASELINE_HOURLY_WEIGHTS[hour] ?? 0.05;

    let visitsCount = rawCount;
    if (includeBaseline && isSparse) {
      const baselinePortion = Math.round(baselineScale * hourWeight);
      visitsCount = rawCount + baselinePortion;
    }

    // Capacity percentage calculation
    // Today: direct count vs capacity. Week: average per day vs capacity. Month: average per day vs capacity.
    const divisor = period === 'today' ? 1 : period === 'week' ? 7 : 30;
    const avgSimultaneousMembers = visitsCount / divisor;
    const occupancyPercent = Math.min(100, Math.round((avgSimultaneousMembers / capacity) * 100));

    const nextHour = hour + 1;
    const hourLabel = `${String(hour).padStart(2, '0')}:00`;
    const nextHourLabel = `${String(nextHour).padStart(2, '0')}:00`;
    const timeRange = `${hourLabel}–${nextHourLabel}`;

    hourlyBins.push({
      hour,
      hourLabel,
      timeRange,
      visits: visitsCount,
      rawVisits: rawCount,
      occupancyPercent,
      isPeak: false,
      isValley: false,
    });
  }

  // Identify Peak and Valley hours
  let maxHourlyVisits = -1;
  let peakHourIndex = 13; // default 19:00 (index 13 in 6..21)
  let minValleyVisits = Infinity;
  let valleyHourIndex = 5; // default 11:00 (index 5 in 6..21)

  hourlyBins.forEach((bin, idx) => {
    if (bin.visits > maxHourlyVisits) {
      maxHourlyVisits = bin.visits;
      peakHourIndex = idx;
    }
    // Consider daytime hours (10:00 to 16:00, indices 4 to 10) for representative valley
    if (idx >= 4 && idx <= 10) {
      if (bin.visits < minValleyVisits) {
        minValleyVisits = bin.visits;
        valleyHourIndex = idx;
      }
    }
  });

  if (hourlyBins[peakHourIndex]) hourlyBins[peakHourIndex].isPeak = true;
  if (hourlyBins[valleyHourIndex]) hourlyBins[valleyHourIndex].isValley = true;

  const peakBin = hourlyBins[peakHourIndex] ?? hourlyBins[13];
  const valleyBin = hourlyBins[valleyHourIndex] ?? hourlyBins[5];

  // 5. Day of week traffic bins (Lunes a Domingo)
  const rawDayCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const v of periodVisits) {
    const d = getDayOfWeekInGymTz(v.observedCheckIn);
    rawDayCounts[d] = (rawDayCounts[d] || 0) + 1;
  }

  const dayOfWeekBins: DayOfWeekTrafficBin[] = [];
  let totalPeriodVisitsCalc = 0;

  for (let d = 0; d < 7; d++) {
    const rawCount = rawDayCounts[d] ?? 0;
    const dayWeight = BASELINE_DAY_WEIGHTS[d] ?? (1 / 7);

    let dayVisits = rawCount;
    if (includeBaseline && isSparse) {
      const dayBaseline = Math.round(baselineScale * dayWeight);
      dayVisits = rawCount + dayBaseline;
    }
    totalPeriodVisitsCalc += dayVisits;

    dayOfWeekBins.push({
      dayIndex: d,
      dayName: DAYS_SPANISH[d],
      shortName: DAYS_SHORT_SPANISH[d],
      visits: dayVisits,
      rawVisits: rawCount,
      percent: 0, // computed below
      isBusiest: false,
    });
  }

  let busiestDayIndex = 0;
  let maxDayVisits = -1;

  dayOfWeekBins.forEach((bin, idx) => {
    bin.percent = totalPeriodVisitsCalc > 0 ? Math.round((bin.visits / totalPeriodVisitsCalc) * 100) : 0;
    if (bin.visits > maxDayVisits) {
      maxDayVisits = bin.visits;
      busiestDayIndex = idx;
    }
  });

  if (dayOfWeekBins[busiestDayIndex]) {
    dayOfWeekBins[busiestDayIndex].isBusiest = true;
  }

  const busiestDayBin = dayOfWeekBins[busiestDayIndex] ?? dayOfWeekBins[0];

  // 6. Operational Time Slots: Matutino (06:00–12:00), Vespertino (12:00–17:00), Nocturno (17:00–22:00)
  const morningVisits = hourlyBins.filter(b => b.hour >= 6 && b.hour < 12).reduce((sum, b) => sum + b.visits, 0);
  const afternoonVisits = hourlyBins.filter(b => b.hour >= 12 && b.hour < 17).reduce((sum, b) => sum + b.visits, 0);
  const nightVisits = hourlyBins.filter(b => b.hour >= 17 && b.hour < 22).reduce((sum, b) => sum + b.visits, 0);
  const sumSlotsVisits = morningVisits + afternoonVisits + nightVisits;
  const totalSlotsVisits = sumSlotsVisits || 1;

  const timeSlots: OperationalTimeSlot[] = [
    {
      slot: 'morning',
      name: 'Matutino',
      label: 'Matutino (06:00–12:00)',
      hoursRange: '06:00–12:00',
      visits: morningVisits,
      percent: Math.round((morningVisits / totalSlotsVisits) * 100),
      status: 'optimal',
      description: 'Flujo constante y regular de apertura. Ideal para entrenamientos técnicos y cardio.',
    },
    {
      slot: 'afternoon',
      name: 'Vespertino',
      label: 'Vespertino (12:00–17:00)',
      hoursRange: '12:00–17:00',
      visits: afternoonVisits,
      percent: Math.round((afternoonVisits / totalSlotsVisits) * 100),
      status: 'opportunity',
      description: 'Franja valle de menor concurrencia. Espacio óptimo para captar socios off-peak y talleres grupales.',
    },
    {
      slot: 'night',
      name: 'Nocturno',
      label: 'Nocturno (17:00–22:00)',
      hoursRange: '17:00–22:00',
      visits: nightVisits,
      percent: Math.round((nightVisits / totalSlotsVisits) * 100),
      status: 'crowded',
      description: 'Máxima concentración del día. Demanda presencia activa de entrenadores y agilidad en recepción.',
    },
  ];

  const totalVisits = sumSlotsVisits;

  // 7. Business recommendations
  const recommendations = generateAttendanceRecommendations({
    liveOccupancyCount,
    liveOccupancyPercent,
    peakHour: {
      hour: peakBin.hour,
      label: peakBin.timeRange,
      visits: peakBin.visits,
      occupancyPercent: peakBin.occupancyPercent,
    },
    valleyHour: {
      hour: valleyBin.hour,
      label: valleyBin.timeRange,
      visits: valleyBin.visits,
      occupancyPercent: valleyBin.occupancyPercent,
    },
    busiestDay: {
      dayName: busiestDayBin.dayName,
      percent: busiestDayBin.percent,
    },
    averageDurationMinutes,
    timeSlots,
  });

  return {
    period,
    gymCapacity: capacity,
    liveOccupancyCount,
    liveOccupancyPercent,
    totalVisits,
    rawVisitsCount,
    averageDurationMinutes,
    peakHour: {
      hour: peakBin.hour,
      label: peakBin.timeRange,
      visits: peakBin.visits,
      occupancyPercent: peakBin.occupancyPercent,
    },
    valleyHour: {
      hour: valleyBin.hour,
      label: valleyBin.timeRange,
      visits: valleyBin.visits,
      occupancyPercent: valleyBin.occupancyPercent,
    },
    busiestDay: {
      dayIndex: busiestDayBin.dayIndex,
      dayName: busiestDayBin.dayName,
      visits: busiestDayBin.visits,
      percent: busiestDayBin.percent,
    },
    hourlyBins,
    dayOfWeekBins,
    timeSlots,
    liveOccupants,
    recommendations,
  };
}
