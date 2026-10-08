import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import type { DemoState } from '../domain/models';
import { createDemoState } from './adapter';
import type { Transaction } from './operations';

interface DemoContextValue {
  state: DemoState;
  update: (operation: (current: DemoState) => DemoState) => void;
  reset: () => void;
  transact: <T>(operation: (current: DemoState) => Transaction<T>) => T;
  resetVersion: number;
}
const DemoContext = createContext<DemoContextValue | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(createDemoState);
  const current = useRef(state);
  const [resetVersion, setResetVersion] = useState(0);
  function replace(next: DemoState) { current.current = next; setState(next); }
  function transact<T>(operation: (state: DemoState) => Transaction<T>): T {
    const transaction = operation(current.current);
    replace(transaction.state);
    return transaction.result;
  }
  return <DemoContext.Provider value={{ state, transact, resetVersion,
    update: operation => replace(operation(current.current)),
    reset: () => { replace(createDemoState()); setResetVersion(version => version + 1); } }}>
    {children}
  </DemoContext.Provider>;
}

export function useDemo() {
  const context = useContext(DemoContext);
  if (!context) throw new Error('useDemo requires DemoProvider');
  return context;
}
