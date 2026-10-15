import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { DemoState } from '../domain/models';
import type { CashDenominationCount } from '../domain/models';
import { createDemoState } from './adapter';
import type { Transaction } from './operations';
import { acquireExclusiveWriter, emptyPersistenceRecord, hydratePersistence, savePersistenceRecord, type PersistenceRecord, type ShiftDrafts } from './shiftPersistence';
import { closeShift } from './shiftOperations';

export type PersistenceStatus = 'loading' | 'ready' | 'blocked' | 'unavailable' | 'recovery-required' | 'error';

interface DemoContextValue {
  state: DemoState;
  update: (operation: (current: DemoState) => DemoState) => boolean;
  reset: () => boolean;
  transact: <T>(operation: (current: DemoState) => Transaction<T>) => T;
  resetVersion: number;
  persistenceStatus: PersistenceStatus;
  persistenceError: string | null;
  drafts: ShiftDrafts;
  saveDraft: (shiftId: string, draft: Record<string, string>) => boolean;
  getDraft: (shiftId: string) => Record<string, string> | undefined;
  commitShiftClose: (request: { shiftId: string; expectedRevision: number; countedCashMinor: number; denominations?: readonly CashDenominationCount[]; closingNotes?: string }) => { status: 'ok' | 'error'; message?: string };
}
const DemoContext = createContext<DemoContextValue | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(createDemoState);
  const current = useRef(state);
  const [resetVersion, setResetVersion] = useState(0);
  const [persistenceStatus, setPersistenceStatus] = useState<PersistenceStatus>('loading');
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const record = useRef<PersistenceRecord>(emptyPersistenceRecord());
  const [drafts, setDrafts] = useState<ShiftDrafts>({});
  const draftsRef = useRef<ShiftDrafts>({});
  const hydratedForWrites = useRef(false);
  const releaseWriter = useRef<(() => void) | null>(null);
  const persist = (nextState: DemoState, nextDrafts = record.current.drafts): boolean => {
    if (!releaseWriter.current || persistenceStatus !== 'ready') {
      setPersistenceError('This tab is not authorized to write local data');
      return false;
    }
    const next = { ...record.current, state: nextState, drafts: nextDrafts };
    try { savePersistenceRecord(localStorage, next); record.current = next; setPersistenceError(null); return true; }
    catch (error) { setPersistenceError(error instanceof Error ? error.message : 'Unable to save local data'); setPersistenceStatus('error'); return false; }
  };
  function replace(next: DemoState): boolean {
    if (next === current.current) return true;
    if (!persist(next)) return false;
    current.current = next; setState(next); return true;
  }
  useEffect(() => {
    let active = true;
    void acquireExclusiveWriter().then(lock => {
      if (!active) { if (lock.status === 'acquired') lock.release(); return; }
      if (lock.status !== 'acquired') { setPersistenceStatus(lock.status); return; }
      releaseWriter.current = lock.release;
      try {
        const hydrated = hydratePersistence(localStorage);
        if (hydrated.status === 'unsupported' || hydrated.status === 'corrupt') { setPersistenceStatus('recovery-required'); return; }
        if (hydrated.status === 'ready') {
          record.current = hydrated.record; current.current = hydrated.record.state;
          setState(hydrated.record.state); draftsRef.current = hydrated.record.drafts; setDrafts(hydrated.record.drafts);
        } else {
          record.current = emptyPersistenceRecord(); savePersistenceRecord(localStorage, record.current);
        }
        hydratedForWrites.current = true;
        setPersistenceStatus('ready');
      } catch (error) { setPersistenceError(error instanceof Error ? error.message : 'Unable to read local data'); setPersistenceStatus('error'); }
    }).catch(error => { if (active) { setPersistenceError(error instanceof Error ? error.message : 'Unable to acquire writer lock'); setPersistenceStatus('unavailable'); } });
    return () => { active = false; releaseWriter.current?.(); releaseWriter.current = null; };
  }, []);
  function saveDraft(shiftId: string, draft: Record<string, string>): boolean {
    const nextDrafts = { ...draftsRef.current, [shiftId]: { ...draft } };
    const next = { ...record.current, drafts: nextDrafts };
    try {
      if (!releaseWriter.current || !hydratedForWrites.current) throw new Error('This tab cannot write local data');
      savePersistenceRecord(localStorage, next); record.current = next; draftsRef.current = nextDrafts; setDrafts(nextDrafts); setPersistenceError(null); setPersistenceStatus('ready'); return true;
    } catch (error) {
      if (releaseWriter.current && hydratedForWrites.current) { draftsRef.current = nextDrafts; setDrafts(nextDrafts); }
      setPersistenceError(error instanceof Error ? error.message : 'Unable to save draft'); setPersistenceStatus('error'); return false;
    }
  }
  function getDraft(shiftId: string) { return drafts[shiftId]; }
  function commitShiftClose(request: { shiftId: string; expectedRevision: number; countedCashMinor: number; denominations?: readonly CashDenominationCount[]; closingNotes?: string }) {
    const fail = (message: string) => ({ status: 'error' as const, message });
    if (persistenceStatus !== 'ready' || !releaseWriter.current) return fail('This tab is not authorized to close the shift');
    if (current.current.revision !== request.expectedRevision) return fail('The shift changed before it could be closed');
    if (current.current.currentShiftId !== request.shiftId || !current.current.shifts.some(shift => shift.id === request.shiftId && shift.status === 'open')) {
      return fail('The requested shift is not the current open shift');
    }
    const transaction = closeShift(current.current, request.countedCashMinor, request.denominations, request.closingNotes);
    if (transaction.result.status !== 'ok') return transaction.result;
    const nextDrafts = { ...record.current.drafts };
    delete nextDrafts[request.shiftId];
    const next = { ...record.current, state: transaction.state, drafts: nextDrafts };
    try {
      savePersistenceRecord(localStorage, next);
      record.current = next; current.current = transaction.state; draftsRef.current = nextDrafts; setState(transaction.state); setDrafts(nextDrafts); setPersistenceError(null); setPersistenceStatus('ready');
      return transaction.result;
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : 'Unable to save shift close'); setPersistenceStatus('error');
      return fail('Unable to save shift close');
    }
  }
  function transact<T>(operation: (state: DemoState) => Transaction<T>): T {
    const transaction = operation(current.current);
    if (transaction.state !== current.current && !replace(transaction.state)) throw new Error(persistenceError ?? 'Unable to persist the transaction');
    if (persistenceStatus !== 'ready' || !releaseWriter.current) throw new Error(persistenceError ?? 'This tab is not authorized to write local data');
    return transaction.result;
  }
  return <DemoContext.Provider value={{ state, transact, resetVersion, persistenceStatus, persistenceError, drafts, saveDraft, getDraft, commitShiftClose,
    update: operation => replace(operation(current.current)),
    reset: () => {
      const fresh = emptyPersistenceRecord();
      if (!releaseWriter.current) { setPersistenceError('This tab is not authorized to reset local data'); return false; }
      try {
        savePersistenceRecord(localStorage, fresh);
        hydratedForWrites.current = true;
        record.current = fresh; draftsRef.current = {}; setDrafts({}); current.current = fresh.state; setState(fresh.state);
        setPersistenceStatus('ready'); setPersistenceError(null); setResetVersion(version => version + 1); return true;
      } catch (error) { setPersistenceError(error instanceof Error ? error.message : 'Unable to reset local data'); setPersistenceStatus('error'); return false; }
    } }}>
    {children}
  </DemoContext.Provider>;
}

export function useDemo() {
  const context = useContext(DemoContext);
  if (!context) throw new Error('useDemo requires DemoProvider');
  return context;
}
