import type { DemoState, PaymentMethod } from '../domain/models';
import { localDateKey } from '../shared/formatters/date';
import { categoryLabels, validPeriod, type HistoryCategory, type ReportingPeriod } from '../domain/reporting';
export { localDateKey, categoryLabels, validPeriod, type HistoryCategory, type ReportingPeriod };

export interface HistoryFilter extends ReportingPeriod { category?: HistoryCategory | 'all'; method?: PaymentMethod | 'all' }
export interface HistoryRecord {
  id: string;
  category: HistoryCategory;
  recordedAt: string;
  shiftId: string;
  description: string;
  detail: string;
  status: string;
  amountMinor: number | null;
  method: PaymentMethod | null;
  memberId?: string;
}
function inPeriod(timestamp: string, period: ReportingPeriod) {
  const date = localDateKey(timestamp);
  return date >= period.from && date <= period.to;
}
function allHistory(state: DemoState): HistoryRecord[] {
  const recordedMoney = (value: number | undefined) => value === undefined ? 'Sin registrar' : `${(value / 100).toFixed(2)} MXN`;
  const memberPayments: HistoryRecord[] = state.payments.map(payment => ({
    id: payment.id, category: 'membership', recordedAt: payment.recordedAt, shiftId: payment.shiftId,
    description: payment.planName, detail: `${state.members.find(member => member.id === payment.memberId)?.name ?? payment.memberId} · Fechas efectivas sin definir; crédito no aplicado.`,
    status: payment.status === 'paid' ? 'Confirmado' : 'Transferencia pendiente', amountMinor: payment.amountMinor, method: payment.method, memberId: payment.memberId,
  }));
  const sales: HistoryRecord[] = state.sales.map(sale => ({
    id: sale.id, category: sale.kind, recordedAt: sale.recordedAt, shiftId: sale.shiftId, description: sale.description,
    detail: `${sale.quantity} ${sale.quantity === 1 ? 'unidad' : 'unidades'} · Venta registrada.`,
    status: sale.status === 'confirmed' ? 'Confirmado' : 'Transferencia pendiente', amountMinor: sale.amountMinor, method: sale.method,
  }));
  const stock: HistoryRecord[] = state.stockMovements.filter(item => item.kind !== 'sale').map(item => ({
    id: item.id, category: item.kind as 'restock' | 'waste', recordedAt: item.recordedAt, shiftId: item.shiftId,
    description: state.products.find(product => product.id === item.productId)?.name ?? item.productId,
    detail: `${item.quantity} unidades · Movimiento de cantidad, no un gasto.`, status: 'Registrado', amountMinor: null, method: null,
  }));
  const counts: HistoryRecord[] = state.counts.map(item => ({
    id: item.id, category: 'count', recordedAt: item.recordedAt, shiftId: item.shiftId,
    description: state.products.find(product => product.id === item.productId)?.name ?? item.productId,
    detail: `Esperado entonces: ${item.expectedAtCount} · Contado: ${item.quantity} · Diferencia: ${item.variance}. Sin corrección de stock.`,
    status: 'Observado', amountMinor: null, method: null,
  }));
  const shifts: HistoryRecord[] = state.shifts.flatMap(shift => {
    const opening: HistoryRecord = { id: `${shift.id}-opening`, category: 'shift', recordedAt: shift.openedAt, shiftId: shift.id,
      description: `Apertura ${shift.window}`, detail: `Fondo inicial: ${(shift.openingCashMinor / 100).toFixed(2)} MXN · No es ingreso.`, status: 'Apertura', amountMinor: null, method: null };
    if (!shift.closedAt) return [opening];
    return [opening, { ...opening, id: `${shift.id}-close`, recordedAt: shift.closedAt, description: `Cierre ${shift.window}`, status: 'Cierre',
      detail: `Esperado: ${recordedMoney(shift.expectedCashAtCloseMinor)} · Contado: ${recordedMoney(shift.countedCashMinor)} · Diferencia: ${recordedMoney(shift.cashDifferenceMinor)}. Comparación manual.` }];
  });
  return [...memberPayments, ...sales, ...stock, ...counts, ...shifts].sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
}
export function defaultPeriod(state: DemoState): ReportingPeriod {
  const dates = allHistory(state).map(item => localDateKey(item.recordedAt)).sort();
  const today = localDateKey(new Date().toISOString());
  return { from: dates[0] ?? today, to: dates.at(-1) ?? today };
}
export function ownerHistory(state: DemoState, filter: HistoryFilter) {
  if (!validPeriod(filter)) return [];
  return allHistory(state).filter(item => inPeriod(item.recordedAt, filter)
    && (!filter.category || filter.category === 'all' || item.category === filter.category)
    && (!filter.method || filter.method === 'all' || item.method === filter.method));
}
export function ownerSummary(state: DemoState, period: ReportingPeriod) {
  const events = validPeriod(period) ? state.ledger.filter(item => inPeriod(item.recordedAt, period)) : [];
  const cashMinor = events.filter(item => item.method === 'cash').reduce((sum, item) => sum + item.amountMinor, 0);
  const cardMinor = events.filter(item => item.method === 'card').reduce((sum, item) => sum + item.amountMinor, 0);
  const transfers = ownerHistory(state, { ...period, method: 'transfer' });
  return {
    cashMinor, cardMinor, confirmedMinor: cashMinor + cardMinor, confirmedCount: events.length,
    transferPendingMinor: transfers.reduce((sum, item) => sum + (item.amountMinor ?? 0), 0),
    shiftDiscrepancies: state.shifts.filter(item => validPeriod(period) && item.closedAt && inPeriod(item.closedAt, period) && item.cashDifferenceMinor !== undefined && item.cashDifferenceMinor !== 0),
    countDiscrepancies: state.counts.filter(item => validPeriod(period) && inPeriod(item.recordedAt, period) && item.variance !== 0),
  };
}
