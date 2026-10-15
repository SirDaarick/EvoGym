import type { DemoState, LedgerEvent, PaymentMethod, SupplementProduct, SupplementSale } from '../domain/models';
import type { Transaction } from './operations';

export interface SupplementCartLine {
  supplementId: string;
  scoops: number;
}

export interface SupplementCartRequest {
  id: string;
  method: PaymentMethod;
  memberId?: string | null;
  lines: SupplementCartLine[];
}

export interface SupplementQuoteLine {
  supplementId: string;
  name: string;
  flavor?: string;
  scoops: number;
  unitPriceMinor: number;
  amountMinor: number;
}

export interface SupplementQuote {
  lines: SupplementQuoteLine[];
  totalMinor: number;
}

export type SupplementCartResult =
  | { status: 'confirmed' | 'pending'; sales: SupplementSale[] }
  | { status: 'error'; message: string };

export function quoteSupplementCart(
  state: DemoState,
  lines: SupplementCartLine[]
): SupplementQuote | null {
  if (!lines.length) return null;
  const supplements = state.supplements ?? [];

  const validLines: SupplementQuoteLine[] = [];
  let totalMinor = 0;

  for (const line of lines) {
    if (!Number.isSafeInteger(line.scoops) || line.scoops <= 0) return null;
    const sup = supplements.find(s => s.id === line.supplementId);
    if (!sup) return null;

    const amountMinor = sup.scoopPriceMinor * line.scoops;
    totalMinor += amountMinor;

    validLines.push({
      supplementId: sup.id,
      name: sup.name,
      flavor: sup.flavor,
      scoops: line.scoops,
      unitPriceMinor: sup.scoopPriceMinor,
      amountMinor,
    });
  }

  return { lines: validLines, totalMinor };
}

export function registerSupplementCart(
  state: DemoState,
  request: SupplementCartRequest
): Transaction<SupplementCartResult> {
  const fail = (message: string): Transaction<SupplementCartResult> => ({
    state,
    result: { status: 'error', message },
  });

  const quote = quoteSupplementCart(state, request.lines);
  if (!request.id?.trim() || !quote || !['cash', 'card', 'transfer'].includes(request.method)) {
    return fail('Revisa suplementos, porciones y método de cobro.');
  }

  const openShift = state.shifts.find(s => s.id === state.currentShiftId && s.status === 'open');
  if (!openShift) {
    return fail('Abre un turno antes de registrar una venta.');
  }

  const supplements = state.supplements ?? [];
  // Check available scoops
  for (const line of request.lines) {
    const sup = supplements.find(s => s.id === line.supplementId);
    if (!sup || line.scoops > sup.availableScoops) {
      return fail(`Porciones insuficientes para ${sup?.name ?? 'suplemento'}.`);
    }
  }

  const status: 'confirmed' | 'pending' = request.method === 'transfer' ? 'pending' : 'confirmed';
  const recordedAt = new Date().toISOString();
  const member = request.memberId ? state.members.find(m => m.id === request.memberId) : null;

  const sales: SupplementSale[] = quote.lines.map((line, index) => ({
    id: `${request.id}:line:${index}`,
    cartId: request.id,
    supplementId: line.supplementId,
    name: `${line.name}${line.flavor ? ` (${line.flavor})` : ''}`,
    scoops: line.scoops,
    unitPriceMinor: line.unitPriceMinor,
    amountMinor: line.amountMinor,
    memberId: member?.id ?? null,
    memberName: member?.name ?? null,
    method: request.method,
    status,
    shiftId: state.currentShiftId,
    recordedAt,
  }));

  // Decrement scoop stock on confirmed or pending
  const updatedSupplements = supplements.map(sup => {
    const matchedLine = request.lines.find(l => l.supplementId === sup.id);
    if (matchedLine) {
      return {
        ...sup,
        availableScoops: sup.availableScoops - matchedLine.scoops,
      };
    }
    return sup;
  });

  const ledgerEvents: LedgerEvent[] = status === 'confirmed' ? sales.map(sale => ({
    id: `sup-event-${sale.id}`,
    paymentId: sale.id,
    memberId: member?.id,
    shiftId: state.currentShiftId,
    kind: 'product',
    amountMinor: sale.amountMinor,
    method: request.method as 'cash' | 'card',
    recordedAt,
  })) : [];

  return {
    state: {
      ...state,
      revision: state.revision + 1,
      supplements: updatedSupplements,
      supplementSales: [...(state.supplementSales ?? []), ...sales],
      ledger: [...state.ledger, ...ledgerEvents],
    },
    result: {
      status,
      sales,
    },
  };
}
