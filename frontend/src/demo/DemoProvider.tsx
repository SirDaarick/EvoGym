import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { DemoState } from '../domain/models';
import type { CashDenominationCount } from '../domain/models';
import { createBaselineDemoState, createDemoState, createEmptyDemoState, isDemoDataDisabled, isRichDemoEnabled } from './adapter';
import { createRichDemoState } from './richDemoState';
import type { Transaction } from './operations';
import { acquireExclusiveWriter, createPersistenceRecord, hydratePersistence, savePersistenceRecord, type PersistenceRecord, type ShiftDrafts } from './shiftPersistence';
import { closeShift } from './shiftOperations';

const RICH_DATASET_ID = 'evogym-rich-demo-v1';

export type PersistenceStatus = 'loading' | 'ready' | 'blocked' | 'unavailable' | 'recovery-required' | 'error';

interface DemoContextValue {
  state: DemoState;
  update: (operation: (current: DemoState) => DemoState) => boolean;
  reset: () => boolean;
  loadSampleData: () => boolean;
  transact: <T>(operation: (current: DemoState) => Transaction<T>) => T;
  resetVersion: number;
  persistenceStatus: PersistenceStatus;
  persistenceError: string | null;
  drafts: ShiftDrafts;
  saveDraft: (shiftId: string, draft: Record<string, string>) => boolean;
  getDraft: (shiftId: string) => Record<string, string> | undefined;
  commitShiftClose: (request: { shiftId: string; expectedRevision: number; countedCashMinor: number; denominations?: readonly CashDenominationCount[]; closingNotes?: string }) => { status: 'ok' | 'error'; message?: string };
  retryPersistence: (options?: { force?: boolean }) => Promise<boolean>;
}
const DemoContext = createContext<DemoContextValue | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(createDemoState);
  const current = useRef(state);
  const [resetVersion, setResetVersion] = useState(0);
  const [persistenceStatus, setPersistenceStatus] = useState<PersistenceStatus>('loading');
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const record = useRef<PersistenceRecord>(
    createPersistenceRecord(state, {}, isRichDemoEnabled() ? RICH_DATASET_ID : undefined)
  );
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
  const acquireAndHydrate = async (force = false): Promise<boolean> => {
    if (releaseWriter.current && persistenceStatus === 'ready' && !force) {
      return true;
    }
    if (force && releaseWriter.current) {
      try { releaseWriter.current(); } catch { /* ignore */ }
      releaseWriter.current = null;
    }
    try {
      const lock = await acquireExclusiveWriter(force ? 1 : 3, 30, { steal: force });
      if (lock.status !== 'acquired') {
        setPersistenceStatus(lock.status);
        if (lock.status === 'blocked') {
          setPersistenceError('Another tab has the operational writer lock');
        }
        return false;
      }
      releaseWriter.current = lock.release;
      try {
        const hydrated = hydratePersistence(localStorage);
        if (hydrated.status === 'unsupported' || hydrated.status === 'corrupt') {
          setPersistenceStatus('recovery-required');
          return false;
        }
        if (isDemoDataDisabled()) {
          const emptyState = createEmptyDemoState();
          const cleanRecord = createPersistenceRecord(emptyState, {}, 'evogym-empty-dataset');
          savePersistenceRecord(localStorage, cleanRecord);
          record.current = cleanRecord;
          current.current = emptyState;
          setState(emptyState);
          draftsRef.current = {};
          setDrafts({});
          setPersistenceStatus('ready');
          return true;
        }
        const richEnabled = isRichDemoEnabled();
        if (hydrated.status === 'ready') {
          if (richEnabled && hydrated.record.datasetId !== RICH_DATASET_ID) {
            const richState = createRichDemoState();
            const upgraded = createPersistenceRecord(richState, {}, RICH_DATASET_ID);
            savePersistenceRecord(localStorage, upgraded);
            record.current = upgraded;
            current.current = richState;
            setState(richState);
            draftsRef.current = {};
            setDrafts({});
          } else if (!richEnabled && hydrated.record.datasetId === RICH_DATASET_ID) {
            const baselineState = createBaselineDemoState();
            const reverted = createPersistenceRecord(baselineState, {});
            savePersistenceRecord(localStorage, reverted);
            record.current = reverted;
            current.current = baselineState;
            setState(baselineState);
            draftsRef.current = {};
            setDrafts({});
          } else {
            record.current = hydrated.record;
            current.current = hydrated.record.state;
            setState(hydrated.record.state);
            draftsRef.current = hydrated.record.drafts;
            setDrafts(hydrated.record.drafts);
          }
        } else {
          const freshState = createDemoState();
          const initialRecord = createPersistenceRecord(freshState, {}, richEnabled ? RICH_DATASET_ID : undefined);
          record.current = initialRecord;
          savePersistenceRecord(localStorage, record.current);
          current.current = initialRecord.state;
          setState(initialRecord.state);
          draftsRef.current = {};
          setDrafts({});
        }
        hydratedForWrites.current = true;
        setPersistenceStatus('ready');
        setPersistenceError(null);
        return true;
      } catch (error) {
        setPersistenceError(error instanceof Error ? error.message : 'Unable to read local data');
        setPersistenceStatus('error');
        return false;
      }
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : 'Unable to acquire writer lock');
      setPersistenceStatus('unavailable');
      return false;
    }
  };

  useEffect(() => {
    let active = true;
    void acquireAndHydrate(false).then(() => {
      if (!active && releaseWriter.current) {
        releaseWriter.current();
        releaseWriter.current = null;
      }
    });
    return () => {
      active = false;
      releaseWriter.current?.();
      releaseWriter.current = null;
    };
  }, []);

  useEffect(() => {
    function handleVisibilityOrFocus() {
      if (document.visibilityState === 'visible' && (persistenceStatus === 'blocked' || persistenceStatus === 'error')) {
        void acquireAndHydrate(false);
      }
    }
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    return () => {
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [persistenceStatus]);
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
    retryPersistence: (options?: { force?: boolean }) => acquireAndHydrate(options?.force ?? false),
    update: operation => replace(operation(current.current)),
    reset: () => {
      const richEnabled = isRichDemoEnabled();
      const freshState = createDemoState();
      const fresh = createPersistenceRecord(freshState, {}, richEnabled ? RICH_DATASET_ID : undefined);
      if (!releaseWriter.current) { setPersistenceError('This tab is not authorized to reset local data'); return false; }
      try {
        savePersistenceRecord(localStorage, fresh);
        hydratedForWrites.current = true;
        record.current = fresh; draftsRef.current = {}; setDrafts({}); current.current = fresh.state; setState(fresh.state);
        setPersistenceStatus('ready'); setPersistenceError(null); setResetVersion(version => version + 1); return true;
      } catch (error) { setPersistenceError(error instanceof Error ? error.message : 'Unable to reset local data'); setPersistenceStatus('error'); return false; }
    },
    loadSampleData: () => {
      const rich = createRichDemoState();
      const ok = replace(rich);
      if (ok) setResetVersion(version => version + 1);
      return ok;
    } }}>
    {children}
  </DemoContext.Provider>;
}

export function useDemo() {
  const context = useContext(DemoContext);
  if (!context) throw new Error('useDemo requires DemoProvider');
  return context;
}
