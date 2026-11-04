export type HistoryCategory = 'membership' | 'product' | 'visit' | 'restock' | 'waste' | 'count' | 'shift';
export interface ReportingPeriod { from: string; to: string }
export const categoryLabels: Record<HistoryCategory, string> = {
  membership: 'Membresías', product: 'Productos', visit: 'Visitas', restock: 'Reposición', waste: 'Merma', count: 'Conteo físico', shift: 'Turnos',
};
export function validPeriod(period: ReportingPeriod) {
  const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  return validDate(period.from) && validDate(period.to) && period.from <= period.to;
}
