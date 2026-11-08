import { describe, expect, it } from 'vitest';
import { buildRentalTender } from './rentalPayments';

describe('buildRentalTender', () => {
  it('defaults to full cash without a breakdown', () => {
    expect(buildRentalTender(2500)).toEqual({ components: [{ method: 'cash', amount_minor: 2500 }], cardMinor: 0, shortfallMinor: 0, creditMinor: 0 });
  });

  it('keeps single-method behavior without credit', () => {
    expect(buildRentalTender(2500, { mode: 'single', method: 'cash', tenderedMinor: 1000, shortfallMinor: 1500 })).toMatchObject({
      components: [{ method: 'cash', amount_minor: 1000 }], shortfallMinor: 1500, creditMinor: 0,
    });
  });

  it('treats credit as neither component nor shortfall', () => {
    expect(buildRentalTender(2500, { mode: 'single', method: 'cash', tenderedMinor: 1500, shortfallMinor: 0, creditAppliedMinor: 1000 })).toEqual({
      components: [{ method: 'cash', amount_minor: 1500 }], cardMinor: 0, shortfallMinor: 0, creditMinor: 1000,
    });
  });

  it('sends nothing but credit when credit covers the total', () => {
    expect(buildRentalTender(2500, { mode: 'single', method: 'cash', tenderedMinor: 0, shortfallMinor: 0, creditAppliedMinor: 2500 })).toEqual({
      components: [], cardMinor: 0, shortfallMinor: 0, creditMinor: 2500,
    });
  });

  it('moves the card portion into shortfall after credit', () => {
    expect(buildRentalTender(2500, { mode: 'single', method: 'card', tenderedMinor: 1500, shortfallMinor: 0, creditAppliedMinor: 1000 })).toEqual({
      components: [], cardMinor: 1500, shortfallMinor: 1500, creditMinor: 1000,
    });
  });
});