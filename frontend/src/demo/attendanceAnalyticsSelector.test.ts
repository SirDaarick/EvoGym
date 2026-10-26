import { describe, expect, it } from 'vitest';
import type { AttendanceVisit, Member } from '../domain/models';
import {
  formatTimeInGymTz,
  getDayOfWeekInGymTz,
  getHourInGymTz,
  getAttendanceAnalytics,
  filterVisitsByPeriod,
  generateAttendanceRecommendations,
  GYM_CAPACITY,
} from './attendanceAnalyticsSelector';

const mockMembers: Member[] = [
  {
    id: 'm-1',
    name: 'Mariana López',
    phone: '5551234567',
    creditMinor: 0,
    membership: { planName: 'Gym mensual', startsOn: '2026-10-01', endsOn: '2026-11-01' },
  },
  {
    id: 'm-2',
    name: 'Carlos Rivera',
    phone: '5559876543',
    creditMinor: 0,
    membership: { planName: 'Gym + Box mensual', startsOn: '2026-10-01', endsOn: '2026-11-01' },
  },
  {
    id: 'm-3',
    name: 'Sofía Delgado',
    phone: '5553334444',
    creditMinor: 0,
    membership: null,
  },
];

describe('attendanceAnalyticsSelector timezone and date helpers', () => {
  it('extracts hour correctly in America/Mexico_City', () => {
    // 2026-10-08T08:30:00-06:00 -> hour 8
    expect(getHourInGymTz('2026-10-08T08:30:00-06:00')).toBe(8);
    // 2026-10-08T19:00:00-06:00 -> hour 19
    expect(getHourInGymTz('2026-10-08T19:00:00-06:00')).toBe(19);
    // UTC string matching 18:00 Mexico City (UTC-6)
    expect(getHourInGymTz('2026-10-09T00:00:00Z')).toBe(18);
    // Invalid string
    expect(getHourInGymTz('invalid-date')).toBe(0);
  });

  it('extracts day of week in America/Mexico_City (0=Lunes..6=Domingo)', () => {
    // 2026-10-05 was Monday in Mexico City
    expect(getDayOfWeekInGymTz('2026-10-05T12:00:00-06:00')).toBe(0);
    // 2026-10-08 was Thursday
    expect(getDayOfWeekInGymTz('2026-10-08T12:00:00-06:00')).toBe(3);
    // 2026-10-11 was Sunday
    expect(getDayOfWeekInGymTz('2026-10-11T12:00:00-06:00')).toBe(6);
  });

  it('formats time string in Mexico City', () => {
    expect(formatTimeInGymTz('2026-10-08T08:15:00-06:00')).toBe('08:15 hrs');
    expect(formatTimeInGymTz('invalid')).toBe('—');
  });

  it('filters visits by period relative to currentClock', () => {
    const clock = '2026-10-08T12:00:00-06:00';
    const visits: AttendanceVisit[] = [
      // Today (2026-10-08)
      { id: 'v-today', memberId: 'm-1', observedCheckIn: '2026-10-08T08:00:00-06:00', observedCheckOut: null, autoClosedAt: null },
      // 3 days ago (2026-10-05)
      { id: 'v-3d', memberId: 'm-2', observedCheckIn: '2026-10-05T18:00:00-06:00', observedCheckOut: '2026-10-05T19:00:00-06:00', autoClosedAt: null },
      // 15 days ago (2026-09-23)
      { id: 'v-15d', memberId: 'm-1', observedCheckIn: '2026-09-23T10:00:00-06:00', observedCheckOut: '2026-09-23T11:00:00-06:00', autoClosedAt: null },
      // 40 days ago
      { id: 'v-40d', memberId: 'm-1', observedCheckIn: '2026-08-20T10:00:00-06:00', observedCheckOut: '2026-08-20T11:00:00-06:00', autoClosedAt: null },
    ];

    const todayVisits = filterVisitsByPeriod(visits, clock, 'today');
    expect(todayVisits.map(v => v.id)).toEqual(['v-today']);

    const weekVisits = filterVisitsByPeriod(visits, clock, 'week');
    expect(weekVisits.map(v => v.id)).toEqual(['v-today', 'v-3d']);

    const monthVisits = filterVisitsByPeriod(visits, clock, 'month');
    expect(monthVisits.map(v => v.id)).toEqual(['v-today', 'v-3d', 'v-15d']);
  });
});

describe('getAttendanceAnalytics pure selector', () => {
  const clock = '2026-10-08T12:00:00-06:00';

  it('handles empty visits list gracefully', () => {
    const summary = getAttendanceAnalytics([], mockMembers, clock, 'today', { includeBaseline: false });

    expect(summary.liveOccupancyCount).toBe(0);
    expect(summary.liveOccupancyPercent).toBe(0);
    expect(summary.liveOccupants).toEqual([]);
    expect(summary.rawVisitsCount).toBe(0);
    expect(summary.totalVisits).toBe(0);
    expect(summary.averageDurationMinutes).toBe(0);
    expect(summary.hourlyBins).toHaveLength(16);
    expect(summary.dayOfWeekBins).toHaveLength(7);
    expect(summary.timeSlots).toHaveLength(3);
    expect(summary.peakHour.label).toBe('—');
    expect(summary.valleyHour.label).toBe('—');
    expect(summary.busiestDay.dayName).toBe('—');
    expect(summary.recommendations.length).toBeGreaterThan(0);
    expect(summary.recommendations[0].id).toBe('no-traffic-recorded');
  });

  it('computes live occupancy and occupants details accurately', () => {
    const visits: AttendanceVisit[] = [
      // Active 1: Check-in at 10:30 (90 min ago)
      { id: 'v-active-1', memberId: 'm-1', observedCheckIn: '2026-10-08T10:30:00-06:00', observedCheckOut: null, autoClosedAt: null },
      // Active 2: Check-in at 11:45 (15 min ago)
      { id: 'v-active-2', memberId: 'm-2', observedCheckIn: '2026-10-08T11:45:00-06:00', observedCheckOut: null, autoClosedAt: null },
      // Completed visit (already left at 11:00)
      { id: 'v-closed-1', memberId: 'm-3', observedCheckIn: '2026-10-08T09:00:00-06:00', observedCheckOut: '2026-10-08T11:00:00-06:00', autoClosedAt: null },
      // Auto-closed visit from yesterday
      { id: 'v-autoclosed', memberId: 'm-1', observedCheckIn: '2026-10-07T18:00:00-06:00', observedCheckOut: null, autoClosedAt: '2026-10-07T22:00:00-06:00' },
    ];

    const summary = getAttendanceAnalytics(visits, mockMembers, clock, 'today', { gymCapacity: 50 });

    expect(summary.liveOccupancyCount).toBe(2);
    // 2 / 50 = 4%
    expect(summary.liveOccupancyPercent).toBe(4);
    expect(summary.liveOccupants).toHaveLength(2);

    const first = summary.liveOccupants[0]; // most recent checkIn: v-active-2
    expect(first.memberId).toBe('m-2');
    expect(first.memberName).toBe('Carlos Rivera');
    expect(first.planName).toBe('Gym + Box mensual');
    expect(first.elapsedMinutes).toBe(15);
    expect(first.checkInFormatted).toBe('11:45 hrs');

    const second = summary.liveOccupants[1]; // v-active-1 (10:30)
    expect(second.memberName).toBe('Mariana López');
    expect(second.elapsedMinutes).toBe(90);
  });

  it('calculates average completed workout duration', () => {
    const visits: AttendanceVisit[] = [
      // 60 minutes
      { id: 'v1', memberId: 'm-1', observedCheckIn: '2026-10-08T08:00:00-06:00', observedCheckOut: '2026-10-08T09:00:00-06:00', autoClosedAt: null },
      // 90 minutes
      { id: 'v2', memberId: 'm-2', observedCheckIn: '2026-10-08T09:00:00-06:00', observedCheckOut: '2026-10-08T10:30:00-06:00', autoClosedAt: null },
      // 45 minutes
      { id: 'v3', memberId: 'm-3', observedCheckIn: '2026-10-08T10:00:00-06:00', observedCheckOut: '2026-10-08T10:45:00-06:00', autoClosedAt: null },
      // Still active (should not skew average)
      { id: 'v4', memberId: 'm-1', observedCheckIn: '2026-10-08T11:00:00-06:00', observedCheckOut: null, autoClosedAt: null },
      // Auto closed (should be excluded)
      { id: 'v5', memberId: 'm-2', observedCheckIn: '2026-10-08T07:00:00-06:00', observedCheckOut: null, autoClosedAt: '2026-10-08T22:00:00-06:00' },
    ];

    const summary = getAttendanceAnalytics(visits, mockMembers, clock, 'today', { includeBaseline: false });
    // (60 + 90 + 45) / 3 = 195 / 3 = 65 minutes
    expect(summary.averageDurationMinutes).toBe(65);
  });

  it('incorporates realistic fitness distribution baseline when samples are sparse', () => {
    // Only 1 visit logged
    const visits: AttendanceVisit[] = [
      { id: 'v-lone', memberId: 'm-1', observedCheckIn: '2026-10-08T08:00:00-06:00', observedCheckOut: '2026-10-08T09:00:00-06:00', autoClosedAt: null },
    ];

    const summary = getAttendanceAnalytics(visits, mockMembers, clock, 'week', { includeBaseline: true });

    // Baseline gives rich, actionable distributions
    expect(summary.totalVisits).toBeGreaterThan(100);
    // Peak hour should naturally be evening (19:00–20:00)
    expect(summary.peakHour.label).toBe('19:00–20:00');
    // Valley hour should naturally be around midday (11:00–12:00)
    expect(summary.valleyHour.label).toBe('11:00–12:00');
    // Busiest day should be Lunes
    expect(summary.busiestDay.dayName).toBe('Lunes');

    // 16 bins for 06:00 to 22:00
    expect(summary.hourlyBins).toHaveLength(16);
    expect(summary.hourlyBins[0].hourLabel).toBe('06:00');
    expect(summary.hourlyBins[15].hourLabel).toBe('21:00');
    expect(summary.hourlyBins.some(b => b.isPeak)).toBe(true);
    expect(summary.hourlyBins.some(b => b.isValley)).toBe(true);

    // Day of week bins
    expect(summary.dayOfWeekBins).toHaveLength(7);
    expect(summary.dayOfWeekBins[0].dayName).toBe('Lunes');
    expect(summary.dayOfWeekBins[6].dayName).toBe('Domingo');
    expect(summary.dayOfWeekBins.some(b => b.isBusiest)).toBe(true);
  });

  it('evaluates operational time slots (Matutino, Vespertino, Nocturno)', () => {
    const summary = getAttendanceAnalytics([], mockMembers, clock, 'week', { includeBaseline: true });

    expect(summary.timeSlots).toHaveLength(3);
    const [morning, afternoon, night] = summary.timeSlots;

    expect(morning.name).toBe('Matutino');
    expect(morning.hoursRange).toBe('06:00–12:00');
    expect(morning.visits).toBeGreaterThan(0);

    expect(afternoon.name).toBe('Vespertino');
    expect(afternoon.hoursRange).toBe('12:00–17:00');
    expect(afternoon.status).toBe('opportunity');

    expect(night.name).toBe('Nocturno');
    expect(night.hoursRange).toBe('17:00–22:00');
    expect(night.status).toBe('crowded');

    const totalPercent = morning.percent + afternoon.percent + night.percent;
    expect(totalPercent).toBeGreaterThanOrEqual(98);
    expect(totalPercent).toBeLessThanOrEqual(102);
  });

  it('generates actionable business insights for gym owner', () => {
    const insights = generateAttendanceRecommendations({
      liveOccupancyCount: 42,
      liveOccupancyPercent: 84, // high occupancy
      peakHour: { hour: 19, label: '19:00–20:00', visits: 28, occupancyPercent: 78 },
      valleyHour: { hour: 11, label: '11:00–12:00', visits: 4, occupancyPercent: 12 },
      busiestDay: { dayName: 'Lunes', percent: 24 },
      averageDurationMinutes: 68,
      timeSlots: [],
    });

    expect(insights).toHaveLength(4);
    expect(insights.some(i => i.type === 'staffing' && i.urgency === 'high')).toBe(true);
    expect(insights.some(i => i.type === 'promotion')).toBe(true);
    expect(insights.some(i => i.type === 'capacity' && i.urgency === 'high')).toBe(true);
    expect(insights.some(i => i.type === 'retention')).toBe(true);
  });
});
