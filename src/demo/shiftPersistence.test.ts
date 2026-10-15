import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DemoState } from '../domain/models';
import { createDemoState } from './adapter';
import { createPersistenceRecord, hydratePersistence, parsePersistenceRecord, savePersistenceRecord, STORAGE_KEY } from './shiftPersistence';

describe('shift persistence', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips operational state and raw shift drafts without changing financial revision', () => {
    const state = { ...createDemoState(), revision: 8 };
    const record = createPersistenceRecord(state, { 'demo-shift-01': { '50000': '2', note: 'closing' } });
    expect(record.datasetId).toBeTruthy();
    savePersistenceRecord(localStorage, record);
    const hydrated = hydratePersistence(localStorage);
    expect(hydrated.status).toBe('ready');
    if (hydrated.status === 'ready') {
      expect(hydrated.record.state).toEqual(state);
      expect(hydrated.record.drafts['demo-shift-01']['50000']).toBe('2');
      expect(hydrated.record.state.revision).toBe(8);
    }
  });

  it('isolates unsupported versions and corrupt records instead of overwriting them', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 99 }));
    expect(hydratePersistence(localStorage).status).toBe('unsupported');
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify({ version: 99 }));
    localStorage.setItem(STORAGE_KEY, '{broken');
    expect(hydratePersistence(localStorage).status).toBe('corrupt');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('{broken');
  });

  it('rejects invalid operational data and malformed draft values', () => {
    const invalid = { ...createPersistenceRecord(createDemoState()), state: { revision: 'bad' } };
    expect(() => parsePersistenceRecord(JSON.stringify(invalid))).toThrow();
    const draft = { ...createPersistenceRecord(createDemoState()), drafts: { shift: { '50000': 3 } } };
    expect(() => parsePersistenceRecord(JSON.stringify(draft))).toThrow();
  });

  it('classifies malformed domain records as corrupt', () => {
    const state = createDemoState();
    const brokenShift = { ...state, shifts: [{ id: 's', status: 'closed' }] };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(createPersistenceRecord(brokenShift as unknown as DemoState)));
    expect(hydratePersistence(localStorage).status).toBe('corrupt');
  });

  it('rejects malformed optional financial snapshot fields on closed shifts', () => {
    const state = createDemoState();
    const closed = { ...state.shifts[0], status: 'closed' as const, closedAt: '2026-10-08T14:00:00Z' };
    const invalidShifts = [
      { ...closed, countedCashMinor: 'not-money' },
      { ...closed, expectedCashAtCloseMinor: 'not-money' },
      { ...closed, cashDifferenceMinor: 'not-money' },
      { ...closed, cashDenominations: 'not-an-array' },
      { ...closed, cashDenominations: [{ valueMinor: '50000', quantity: 2 }] },
      { ...closed, closingNotes: 42 },
    ];
    for (const shift of invalidShifts) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(createPersistenceRecord({ ...state, shifts: [shift, ...state.shifts.slice(1)] } as unknown as DemoState)));
      expect(hydratePersistence(localStorage).status).toBe('corrupt');
    }
  });

  it('rejects credential-like draft fields and invalid write envelopes before storage mutation', () => {
    const record = createPersistenceRecord(createDemoState(), { 'demo-shift-01': { pin: '1234' } });
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() } as unknown as Storage;
    expect(() => savePersistenceRecord(storage, record)).toThrow();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('does not write when storage throws', () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn(() => { throw new Error('quota'); }), removeItem: vi.fn() } as unknown as Storage;
    expect(() => savePersistenceRecord(storage, createPersistenceRecord(createDemoState()))).toThrow('quota');
  });
});
