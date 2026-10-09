import type { CashDenominationCount } from '../domain/models';

// Illustrative MXN set for owner discussion, not an approved cash policy.
export const demoDenominations = [
  ...[1000, 500, 200, 100, 50, 20].map(value => ({ valueMinor: value * 100, kind: 'Billete' })),
  ...[10, 5, 2, 1, 0.5].map(value => ({ valueMinor: value * 100, kind: 'Moneda' })),
];

export function parseCashQuantity(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  if (!/^\d+$/.test(trimmed)) return null;
  const quantity = Number(trimmed);
  return Number.isSafeInteger(quantity) ? quantity : null;
}

export function cashCountTotal(rows: readonly CashDenominationCount[]): number | null {
  const seen = new Set<number>();
  let total = 0;
  for (const row of rows) {
    if (!demoDenominations.some(item => item.valueMinor === row.valueMinor) || seen.has(row.valueMinor)
      || !Number.isSafeInteger(row.quantity) || row.quantity < 0) return null;
    seen.add(row.valueMinor);
    const subtotal = row.valueMinor * row.quantity;
    if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(total + subtotal)) return null;
    total += subtotal;
  }
  return total;
}
