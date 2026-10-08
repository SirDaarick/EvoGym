import { createContext, useContext, useState, type ReactNode } from 'react';
import type { DemoState } from '../domain/models';
import { createDemoState } from './adapter';

interface DemoContextValue {
  state: DemoState;
  update: (operation: (current: DemoState) => DemoState) => void;
  reset: () => void;
}
const DemoContext = createContext<DemoContextValue | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(createDemoState);
  return <DemoContext.Provider value={{ state, update: setState, reset: () => setState(createDemoState()) }}>
    {children}
  </DemoContext.Provider>;
}

export function useDemo() {
  const context = useContext(DemoContext);
  if (!context) throw new Error('useDemo requires DemoProvider');
  return context;
}
