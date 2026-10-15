import { createElement } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoProvider, useDemo } from './DemoProvider';
import { STORAGE_KEY } from './shiftPersistence';
import { createDemoState } from './adapter';

let releaseLock: (() => void) | undefined;
function Probe() {
  const demo = useDemo();
  const [actionResult, setActionResult] = React.useState('');
  return <div><span data-testid="revision">{demo.state.revision}</span><span data-testid="status">{demo.persistenceStatus}</span>
    <span data-testid="action-result">{actionResult}</span>
    <span data-testid="shift-status">{demo.state.shifts.find(shift => shift.id === demo.state.currentShiftId)?.status}</span>
    <span data-testid="draft-value">{demo.getDraft(demo.state.currentShiftId)?.['50000'] ?? ''}</span>
    <button onClick={() => setActionResult(String(demo.saveDraft(demo.state.currentShiftId, { '50000': '2' })))}>draft</button>
    <button onClick={() => demo.update(state => ({ ...state, revision: state.revision + 1 }))}>update</button>
    <button onClick={() => { try { const result = demo.transact(state => ({ state: { ...state, revision: state.revision + 1 }, result: 'committed' })); setActionResult(result); } catch { setActionResult('failed'); } }}>transact</button>
    <button onClick={() => setActionResult(String(demo.reset()))}>reset</button>
    <button onClick={() => { const result = demo.commitShiftClose({ shiftId: demo.state.currentShiftId, expectedRevision: demo.state.revision, countedCashMinor: 50000, closingNotes: 'Drawer balanced' }); setActionResult(result.status); }}>close-shift</button>
    <button onClick={() => { const result = demo.commitShiftClose({ shiftId: demo.state.currentShiftId, expectedRevision: demo.state.revision, countedCashMinor: 50000 }); setActionResult(result.status); }}>close-shift-again</button></div>;
}
import * as React from 'react';
function enableWriterLock(mode: 'acquired' | 'reject' | 'blocked' | 'pending' = 'acquired') {
  releaseLock = undefined;
  vi.stubGlobal('navigator', Object.create(window.navigator, { locks: { value: { request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<void>) => {
    if (mode === 'reject') throw new Error('lock failed');
    if (mode === 'pending') return new Promise<void>(() => {});
    await callback(mode === 'blocked' ? null as unknown as object : {});
  } } } }));
}
afterEach(() => { releaseLock?.(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('DemoProvider persistence', () => {
  it('hydrates and persists operational data while draft writes leave revision unchanged', async () => {
    enableWriterLock();
    const initial = { version: 1, datasetId: 'dataset-a', drafts: {}, state: { ...((await import('./adapter')).createDemoState()), revision: 7 } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    render(createElement(DemoProvider, null, createElement(Probe)));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(screen.getByTestId('revision')).toHaveTextContent('7');
    act(() => screen.getByText('draft').click());
    expect(screen.getByTestId('revision')).toHaveTextContent('7');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).drafts['demo-shift-01']['50000']).toBe('2');
    act(() => screen.getByText('update').click());
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).state.revision).toBe(8);
  });

  it('closes the expected shift and deletes its draft in one persisted update', async () => {
    enableWriterLock();
    const initial = { version: 1, datasetId: 'dataset-close', drafts: { 'demo-shift-01': { '50000': '2' }, 'demo-shift-unrelated': { '10000': '4' } }, state: createDemoState() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    render(createElement(DemoProvider, null, createElement(Probe)));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));

    const write = vi.spyOn(Storage.prototype, 'setItem');
    act(() => screen.getByText('close-shift').click());

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(screen.getByTestId('action-result')).toHaveTextContent('ok');
    expect(screen.getByTestId('shift-status')).toHaveTextContent('closed');
    expect(screen.getByTestId('draft-value')).toBeEmptyDOMElement();
    expect(persisted.state.shifts.find((shift: { id: string }) => shift.id === 'demo-shift-01')).toMatchObject({ closingNotes: 'Drawer balanced' });
    expect(persisted.drafts).toEqual({ 'demo-shift-unrelated': { '10000': '4' } });
    expect(write).toHaveBeenCalledTimes(1);

    act(() => screen.getByText('close-shift-again').click());
    expect(screen.getByTestId('action-result')).toHaveTextContent('error');
    expect(write).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('draft-value')).toBeEmptyDOMElement();
  });

  it('rejects a wrong-shift request without deleting any draft', async () => {
    enableWriterLock();
    const initial = { version: 1, datasetId: 'dataset-wrong-shift', drafts: { 'demo-shift-01': { '50000': '2' }, 'demo-shift-previous': { '10000': '3' } }, state: createDemoState() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    function WrongShiftProbe() {
      const demo = useDemo();
      const [result, setResult] = React.useState('');
      return <><span data-testid="wrong-persistence">{demo.persistenceStatus}</span><span data-testid="wrong-status">{demo.state.shifts[0].status}</span><span data-testid="wrong-draft">{demo.getDraft('demo-shift-01')?.['50000'] ?? ''}</span><span data-testid="wrong-result">{result}</span>
        <button onClick={() => setResult(demo.commitShiftClose({ shiftId: 'demo-shift-previous', expectedRevision: demo.state.revision, countedCashMinor: 30000 }).status)}>wrong-close</button></>;
    }
    render(createElement(DemoProvider, null, createElement(WrongShiftProbe)));
    await waitFor(() => expect(screen.getByTestId('wrong-persistence')).toHaveTextContent('ready'));

    act(() => screen.getByText('wrong-close').click());

    expect(screen.getByTestId('wrong-result')).toHaveTextContent('error');
    expect(screen.getByTestId('wrong-status')).toHaveTextContent('open');
    expect(screen.getByTestId('wrong-draft')).toHaveTextContent('2');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).drafts).toEqual(initial.drafts);
  });

  it('keeps an open shift and its draft when the expected revision is stale', async () => {
    enableWriterLock();
    const initial = { version: 1, datasetId: 'dataset-stale', drafts: { 'demo-shift-01': { '50000': '2' } }, state: createDemoState() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    function StaleProbe() {
      const demo = useDemo();
      const [result, setResult] = React.useState('');
      return <><span data-testid="stale-persistence">{demo.persistenceStatus}</span><span data-testid="stale-status">{demo.state.shifts[0].status}</span><span data-testid="stale-draft">{demo.getDraft('demo-shift-01')?.['50000'] ?? ''}</span><span data-testid="stale-result">{result}</span>
        <button onClick={() => setResult(demo.commitShiftClose({ shiftId: 'demo-shift-01', expectedRevision: -1, countedCashMinor: 50000 }).status)}>stale-close</button></>;
    }
    render(createElement(DemoProvider, null, createElement(StaleProbe)));
    await waitFor(() => expect(screen.getByTestId('stale-persistence')).toHaveTextContent('ready'));

    act(() => screen.getByText('stale-close').click());

    expect(screen.getByTestId('stale-result')).toHaveTextContent('error');
    expect(screen.getByTestId('stale-status')).toHaveTextContent('open');
    expect(screen.getByTestId('stale-draft')).toHaveTextContent('2');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).drafts['demo-shift-01']['50000']).toBe('2');
  });

  it('keeps an open shift and its draft when the durable close write fails', async () => {
    enableWriterLock();
    const initial = { version: 1, datasetId: 'dataset-write-failure', drafts: { 'demo-shift-01': { '50000': '2' } }, state: createDemoState() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    render(createElement(DemoProvider, null, createElement(Probe)));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });

    act(() => screen.getByText('close-shift').click());

    expect(screen.getByTestId('action-result')).toHaveTextContent('error');
    expect(screen.getByTestId('shift-status')).toHaveTextContent('open');
    expect(screen.getByTestId('draft-value')).toHaveTextContent('2');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).drafts['demo-shift-01']['50000']).toBe('2');
  });

  it('preserves unknown storage until explicit reset and then clears drafts', async () => {
    enableWriterLock();
    localStorage.setItem(STORAGE_KEY, '{"version":99}');
    render(createElement(DemoProvider, null, createElement(Probe)));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('recovery-required'));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('{"version":99}');
    act(() => screen.getByText('reset').click());
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).version).toBe(1);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).drafts).toEqual({});
  });

  it('allows draft persistence after an explicit reset recovers corrupt storage', async () => {
    enableWriterLock();
    localStorage.setItem(STORAGE_KEY, '{"version":99}');
    render(createElement(DemoProvider, null, createElement(Probe)));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('recovery-required'));
    act(() => screen.getByText('reset').click());
    expect(screen.getByTestId('action-result')).toHaveTextContent('true');
    expect(screen.getByTestId('status')).toHaveTextContent('ready');
    act(() => screen.getByText('draft').click());
    expect(screen.getByTestId('action-result')).toHaveTextContent('true');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).drafts['demo-shift-01']['50000']).toBe('2');
  });

  it('does not publish transaction, reset, or draft success when durable writes fail', async () => {
    enableWriterLock();
    const { createDemoState } = await import('./adapter');
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, datasetId: 'data', state: { ...createDemoState(), revision: 7 }, drafts: {} }));
    render(createElement(DemoProvider, null, createElement(Probe)));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    act(() => screen.getByText('transact').click());
    expect(screen.getByTestId('action-result')).toHaveTextContent('failed');
    expect(screen.getByTestId('revision')).toHaveTextContent('7');
    act(() => screen.getByText('draft').click());
    expect(screen.getByTestId('action-result')).toHaveTextContent('false');
    act(() => screen.getByText('reset').click());
    expect(screen.getByTestId('action-result')).toHaveTextContent('false');
    expect(screen.getByTestId('revision')).toHaveTextContent('7');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).state.revision).toBe(7);
  });

  it('surfaces an asynchronously rejected Web Locks request as unavailable', async () => {
    enableWriterLock('reject');
    render(createElement(DemoProvider, null, createElement(Probe)));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unavailable'));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('retains a failed raw draft in memory and retries it after storage recovers', async () => {
    enableWriterLock();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, datasetId: 'retry-draft', state: createDemoState(), drafts: {} }));
    render(createElement(DemoProvider, null, createElement(Probe)));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    act(() => screen.getByText('draft').click());
    expect(screen.getByTestId('draft-value')).toHaveTextContent('2');
    expect(screen.getByTestId('status')).toHaveTextContent('error');
    write.mockRestore();
    act(() => screen.getByText('draft').click());
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).drafts['demo-shift-01']['50000']).toBe('2');
  });

  it('rejects transactions and reset while lock acquisition is still loading', () => {
    enableWriterLock('pending');
    render(createElement(DemoProvider, null, createElement(Probe)));
    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    act(() => screen.getByText('transact').click());
    expect(screen.getByTestId('action-result')).toHaveTextContent('failed');
    expect(screen.getByTestId('revision')).toHaveTextContent('0');
    act(() => screen.getByText('reset').click());
    expect(screen.getByTestId('action-result')).toHaveTextContent('false');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('rejects transactions and reset when another tab owns the writer lock', async () => {
    enableWriterLock('blocked');
    render(createElement(DemoProvider, null, createElement(Probe)));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('blocked'));
    act(() => screen.getByText('transact').click());
    expect(screen.getByTestId('action-result')).toHaveTextContent('failed');
    expect(screen.getByTestId('revision')).toHaveTextContent('0');
    act(() => screen.getByText('reset').click());
    expect(screen.getByTestId('action-result')).toHaveTextContent('false');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
