/**
 * Calculates 1 calendar month expiry, clamping to the last day of next month if day overflows.
 */
export function calculateNextMonthExpiry(fromDate: Date = new Date()): string {
  const year = fromDate.getFullYear();
  const month = fromDate.getMonth();
  const day = fromDate.getDate();
  const hours = fromDate.getHours();
  const minutes = fromDate.getMinutes();
  const seconds = fromDate.getSeconds();

  const nextMonth = month + 1;
  const targetYear = year + Math.floor(nextMonth / 12);
  const targetMonth = nextMonth % 12;

  // Find last day of target month
  const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);

  const expiry = new Date(targetYear, targetMonth, clampedDay, hours, minutes, seconds);
  return expiry.toISOString();
}
