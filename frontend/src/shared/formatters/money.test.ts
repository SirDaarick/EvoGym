import { describe, expect, it } from 'vitest';
import { formatMoney, parseMoney } from './money';

describe('formatMoney', () => {
  it('formats minor units as MXN currency', () => {
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(50000)).toBe('$500.00');
    expect(formatMoney(123456)).toBe('$1,234.56');
    expect(formatMoney(5)).toBe('$0.05');
  });

  it('formats negative amounts', () => {
    expect(formatMoney(-2500)).toContain('25.00');
    expect(formatMoney(-2500)).toContain('-');
  });
});

describe('parseMoney', () => {
  it('parses whole and decimal amounts into minor units', () => {
    expect(parseMoney('500')).toBe(50000);
    expect(parseMoney('12.5')).toBe(1250);
    expect(parseMoney(' 12.05 ')).toBe(1205);
  });

  it('rejects invalid input', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('-1')).toBeNull();
    expect(parseMoney('1.234')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
  });
});
