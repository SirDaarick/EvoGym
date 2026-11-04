/** Pure date helpers anchored to the gym's business time zone. */
export const DEFAULT_BUSINESS_TIME_ZONE = 'America/Mexico_City';
/** Alias of DEFAULT_BUSINESS_TIME_ZONE. */
export const GYM_TIME_ZONE = DEFAULT_BUSINESS_TIME_ZONE;

const dateKeyFormatters = new Map<string, Intl.DateTimeFormat>();
function dateKeyFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = dateKeyFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dateKeyFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** YYYY-MM-DD of `now` in the given time zone (default: gym zone). */
export function businessDate(now: Date = new Date(), timeZone: string = DEFAULT_BUSINESS_TIME_ZONE): string {
  const parts = dateKeyFormatter(timeZone).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Adds `days` to a YYYY-MM-DD date using UTC arithmetic. */
export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** YYYY-MM-DD in the gym zone for a timestamp; '' when the timestamp is invalid. */
export function localDateKey(timestamp: string | Date): string {
  const dateObj = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  if (Number.isNaN(dateObj.getTime())) return '';
  return businessDate(dateObj);
}

/** Like localDateKey but returns null for an invalid timestamp. */
export function getMexicoCityDateKey(timestamp: string): string | null {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : businessDate(date);
}

/** Local hour (0..23) in the gym zone. */
export function getHourInGymTz(dateStr: string): number {
  const d = new Date(dateStr);
  if (!Number.isFinite(d.getTime())) return 0;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: GYM_TIME_ZONE,
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(d);
  const hourPart = parts.find(p => p.type === 'hour')?.value ?? '0';
  return parseInt(hourPart, 10);
}

/** 0 for Monday (Lunes) ... 6 for Sunday (Domingo) in the gym zone. */
export function getDayOfWeekInGymTz(dateStr: string): number {
  const d = new Date(dateStr);
  if (!Number.isFinite(d.getTime())) return 0;
  const weekdayShort = new Intl.DateTimeFormat('en-US', {
    timeZone: GYM_TIME_ZONE,
    weekday: 'short',
  }).format(d);
  const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return map[weekdayShort] ?? 0;
}

/** Formats a time in the gym zone as 'HH:mm hrs'. */
export function formatTimeInGymTz(dateStr: string): string {
  const d = new Date(dateStr);
  if (!Number.isFinite(d.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('es-MX', {
    timeZone: GYM_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const hour = parts.find(p => p.type === 'hour')?.value ?? '00';
  const minute = parts.find(p => p.type === 'minute')?.value ?? '00';
  return `${hour}:${minute} hrs`;
}

const displayDateFormatter = new Intl.DateTimeFormat('es-MX', {
  timeZone: GYM_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const displayTimeFormatter = new Intl.DateTimeFormat('es-MX', {
  timeZone: GYM_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatExpenseDate(timestamp: string): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  return displayDateFormatter.format(d);
}

export function formatExpenseTime(timestamp: string): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  return `${displayTimeFormatter.format(d)} hrs`;
}
