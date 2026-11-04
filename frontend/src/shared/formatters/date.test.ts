import { describe, expect, it } from 'vitest';
import { GYM_TIME_ZONE, addDays, businessDate, getDayOfWeekInGymTz, getHourInGymTz, getMexicoCityDateKey, localDateKey } from './date';

describe('businessDate', () => {
  it('uses the gym time zone, not UTC', () => {
    expect(GYM_TIME_ZONE).toBe('America/Mexico_City');
    expect(businessDate(new Date('2026-11-04T01:30:00Z'))).toBe('2026-11-03');
    expect(businessDate(new Date('2026-11-04T07:00:00Z'))).toBe('2026-11-04');
  });

  it('accepts an explicit time zone', () => {
    expect(businessDate(new Date('2026-11-04T01:30:00Z'), 'UTC')).toBe('2026-11-04');
  });
});

describe('localDateKey', () => {
  it('handles strings and dates, and returns empty for invalid input', () => {
    expect(localDateKey('2026-11-04T01:30:00Z')).toBe('2026-11-03');
    expect(localDateKey(new Date('2026-11-04T12:00:00Z'))).toBe('2026-11-04');
    expect(localDateKey('nope')).toBe('');
    expect(getMexicoCityDateKey('nope')).toBeNull();
  });
});

describe('gym time zone helpers', () => {
  it('returns hour and weekday in the gym zone', () => {
    expect(getHourInGymTz('2026-11-04T01:30:00Z')).toBe(19);
    expect(getDayOfWeekInGymTz('2026-11-04T01:30:00Z')).toBe(1); // Tuesday Nov 3
  });
});

describe('businessDate (calendar rollover)', () => {
  it('uses the Mexico City calendar day, not UTC', () => {
    expect(businessDate(new Date('2026-11-04T01:30:00Z'))).toBe('2026-11-03');
  });

  it('rolls over at local midnight', () => {
    // CDMX is UTC-6 (no DST since 2022)
    expect(businessDate(new Date('2026-11-03T05:59:59Z'))).toBe('2026-11-02');
    expect(businessDate(new Date('2026-11-03T06:00:00Z'))).toBe('2026-11-03');
  });

  it('honours an explicit timezone', () => {
    expect(businessDate(new Date('2026-11-04T01:30:00Z'), 'UTC')).toBe('2026-11-04');
    expect(businessDate(new Date('2026-11-04T01:30:00Z'), 'Asia/Tokyo')).toBe('2026-11-04');
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
  });

  it('adds a week', () => {
    expect(addDays('2026-11-03', 7)).toBe('2026-11-10');
  });
});
