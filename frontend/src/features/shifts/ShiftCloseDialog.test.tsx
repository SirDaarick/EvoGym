import { createElement, useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoProvider, useDemo } from '../../demo/DemoProvider';
import { createDemoState } from '../../demo/adapter';
import { ShiftCloseDialog } from './ShiftCloseDialog';

const offline = vi.hoisted(() => ({ on: false, dispatch: vi.fn(async () => ({})) }));
vi.mock('../../offline/connectivity', async orig => ({ ...(await orig<object>()), isOnlineHint: () => !offline.on }));
vi.mock('../../offline/dispatcher', async orig => ({ ...(await orig<object>()), dispatch: offline.dispatch }));
vi.mock('../../offline/db', async orig => ({ ...(await orig<object>()), openLocalDb: () => ({}) }));

const originalShowModal =HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterAll(() => {
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
});
beforeEach(() => {
  offline.on = false;
  offline.dispatch.mockClear();
  localStorage.clear();
  vi.stubGlobal('navigator', Object.create(window.navigator, { locks: { value: { request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<void>) => callback({}) } } }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function Harness({ onClose = vi.fn(), onSuccess = vi.fn() }: { onClose?: () => void; onSuccess?: () => void }) {
  const demo = useDemo();
  useEffect(() => {
    if (demo.persistenceStatus !== 'ready') return;
  }, [demo.persistenceStatus]);
  return <><span data-testid="persistence-status">{demo.persistenceStatus}</span><span data-testid="shift-status">{demo.state.shifts[0].status}</span>
    <ShiftCloseDialog isOpen shiftId={demo.state.currentShiftId} shiftName="Matutino" expectedCashMinor={50000} onClose={onClose} onSuccess={onSuccess} /></>;
}
function renderDialog(props: Parameters<typeof Harness>[0] = {}) {
  return render(createElement(DemoProvider, null, createElement(Harness, props)));
}
function RecoveryHarness() {
  const demo = useDemo();
  const [open, setOpen] = useState(false);
  return <><span data-testid="recovery-status">{demo.persistenceStatus}</span>
    <button onClick={() => setOpen(true)}>Open close flow</button>
    <ShiftCloseDialog isOpen={open} shiftId={demo.state.currentShiftId} shiftName="Matutino" expectedCashMinor={50000}
      onClose={() => setOpen(false)} onSuccess={() => setOpen(false)} /></>;
}

describe('ShiftCloseDialog', () => {
  it('submits manual total and notes through the API without a DemoProvider', async () => {
    const apiRequest = vi.fn(async (_path: string, _init?: RequestInit) => new Response(JSON.stringify({ status: 'closed' }), { status: 200 }));
    const onSuccess = vi.fn();
    const user = userEvent.setup();
    render(createElement(ShiftCloseDialog as ComponentType<any>, { isOpen: true, shiftId: 'shift-1', shiftName: 'Matutino', expectedCashMinor: 1000, apiRequest, onClose: vi.fn(), onSuccess }));
    await screen.findByRole('dialog', { name: 'Cerrar turno · Matutino' });
    await user.selectOptions(await screen.findByLabelText('Forma de conteo'), 'manual');
    await user.type(await screen.findByLabelText('Efectivo contado (MXN)'), '0');
    await user.type(await screen.findByLabelText('Observaciones del cierre'), 'conteo manual');
    await user.click(screen.getByRole('button', { name: 'Revisar cierre' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar cierre' }));
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/shifts/shift-1/close', expect.objectContaining({ method: 'POST', body: JSON.stringify({ counted_cash_minor: 0, closing_notes: 'conteo manual' }) }));
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it.each([0, 1000])('queues an offline manual total of %i as counted_cash_minor, not a fabricated denomination', async minor => {
    offline.on = true;
    offline.dispatch.mockClear();
    const user = userEvent.setup();
    render(createElement(ShiftCloseDialog as ComponentType<any>, { isOpen: true, shiftId: 'shift-1', shiftName: 'Matutino', expectedCashMinor: 1000, apiRequest: vi.fn(), onClose: vi.fn(), onSuccess: vi.fn() }));
    await screen.findByRole('dialog', { name: 'Cerrar turno · Matutino' });
    await user.selectOptions(await screen.findByLabelText('Forma de conteo'), 'manual');
    await user.type(await screen.findByLabelText('Efectivo contado (MXN)'), String(minor / 100));
    await user.click(screen.getByRole('button', { name: 'Revisar cierre' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar cierre' }));
    offline.on = false;
    const calls = offline.dispatch.mock.calls as unknown as [unknown, { type: string; payload: unknown }][];
    expect(calls[0][1]).toEqual({ type: 'shift.arqueo_close', payload: { shift_ref: 'shift-1', denomination_counts: [], counted_cash_minor: minor, voucher_count: 0, closing_notes: null } });
  });

  it('submits denomination counts from the shared amount-per-denomination control', async () => {
    const apiRequest = vi.fn(async (_path: string, _init?: RequestInit) => new Response(JSON.stringify({ status: 'closed' }), { status: 200 }));
    const user = userEvent.setup();
    render(createElement(ShiftCloseDialog as ComponentType<any>, { isOpen: true, shiftId: 'shift-1', shiftName: 'Matutino', expectedCashMinor: 150000, apiRequest, onClose: vi.fn(), onSuccess: vi.fn() }));
    await screen.findByRole('dialog', { name: 'Cerrar turno · Matutino' });
    await user.click(await screen.findByRole('radio', { name: /Por importe en dinero/ }));
    await user.type(await screen.findByLabelText('Billete $500.00 · importe ($)'), '1500');
    await user.click(screen.getByRole('button', { name: 'Revisar cierre' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar cierre' }));
    const body = JSON.parse(String(apiRequest.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ denomination_counts: expect.arrayContaining([{ denomination_minor: 50000, quantity: 3 }]) });
    expect(body).not.toHaveProperty('counted_cash_minor');
  });

  it('keeps an API close open and retryable after a server error', async () => {
    const apiRequest = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'invalid close' }), { status: 422 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'shift-1', status: 'open', counted_cash_minor: null, closing_notes: null, closing_denomination_counts: [] }), { status: 200 }));
    const onSuccess = vi.fn();
    const user = userEvent.setup();
    render(createElement(ShiftCloseDialog as ComponentType<any>, { isOpen: true, shiftId: 'shift-1', shiftName: 'Matutino', expectedCashMinor: 0, apiRequest, onClose: vi.fn(), onSuccess }));
    await screen.findByRole('dialog', { name: 'Cerrar turno · Matutino' });
    await user.selectOptions(await screen.findByLabelText('Forma de conteo'), 'manual');
    await user.type(await screen.findByLabelText('Efectivo contado (MXN)'), '10');
    await user.type(await screen.findByLabelText('Observaciones del cierre'), 'Ajuste de caja');
    await user.click(screen.getByRole('button', { name: 'Revisar cierre' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar cierre' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/solicitud falló|revisa los datos|invalid close/i);
    expect(screen.getByRole('dialog', { name: 'Cerrar turno · Matutino' })).toHaveAttribute('open');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('opens a native dialog with denomination-first counting and focused controls', async () => {
    renderDialog();
    const dialog = await screen.findByRole('dialog', { name: 'Cerrar turno · Matutino' });
    await waitFor(() => expect(dialog).toHaveAttribute('open'));
    await screen.findByLabelText('Forma de conteo');
    expect(screen.getByLabelText('Forma de conteo')).toHaveValue('denominations');
    await waitFor(() => expect(screen.getByLabelText('Billete $1,000.00 · cantidad')).toHaveFocus());
  });

  it('autosaves raw values and notes while preserving both count modes', async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByRole('dialog', { name: 'Cerrar turno · Matutino' });
    const denomination = await screen.findByLabelText('Billete $500.00 · cantidad');
    await user.type(denomination, '2');
    await user.selectOptions(screen.getByLabelText('Forma de conteo'), 'manual');
    await user.type(screen.getByLabelText('Efectivo contado (MXN)'), '1250.50');
    await user.click(screen.getByLabelText('Observaciones del cierre'));
    await user.type(screen.getByLabelText('Observaciones del cierre'), 'Revisar fondo');
    await user.selectOptions(screen.getByLabelText('Forma de conteo'), 'denominations');

    const saved = JSON.parse(localStorage.getItem('evogym.demo.operational.v1')!);
    expect(saved.drafts['demo-shift-01']).toMatchObject({
      mode: 'denominations',
      manualTotal: '1250.50',
      'quantity-50000': '2',
      closingNotes: 'Revisar fondo',
    });
    expect(screen.getByLabelText('Billete $500.00 · cantidad')).toHaveValue('2');
    expect(screen.getByRole('status')).toHaveTextContent('Guardado');
  });

  it('reviews and atomically confirms the saved count', async () => {
    const onSuccess = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onSuccess });
    await screen.findByRole('dialog', { name: 'Cerrar turno · Matutino' });
    await user.type(await screen.findByLabelText('Billete $500.00 · cantidad'), '1');
    await user.type(screen.getByLabelText('Observaciones del cierre'), 'Corte realizado');
    await user.click(screen.getByRole('button', { name: 'Revisar cierre' }));
    expect(screen.getByRole('region', { name: 'Resumen de revisión' })).toHaveTextContent('Efectivo esperado');
    expect(screen.getByRole('button', { name: 'Confirmar cierre' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Confirmar cierre' }));
    expect(onSuccess).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByTestId('shift-status')).toHaveTextContent('closed'));
  });

  it('keeps the dialog open and disables confirmation when autosave fails', async () => {
    const state = createDemoState();
    localStorage.setItem('evogym.demo.operational.v1', JSON.stringify({ version: 1, datasetId: 'dialog-failure', state, drafts: {} }));
    renderDialog();
    await screen.findByRole('dialog', { name: 'Cerrar turno · Matutino' });
    await screen.findByLabelText('Forma de conteo');
    await waitFor(() => expect(screen.getByTestId('persistence-status')).toHaveTextContent('ready'));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await userEvent.type(screen.getByLabelText('Billete $500.00 · cantidad'), '1');
    expect(screen.getByRole('alert')).toHaveTextContent(/No se pudo guardar/);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revisar cierre' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Confirmar cierre' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Cerrar turno · Matutino' })).toHaveAttribute('open');
  });

  it('restores raw input after a failed save, close, and reopen, then retries when storage recovers', async () => {
    const state = createDemoState();
    localStorage.setItem('evogym.demo.operational.v1', JSON.stringify({ version: 1, datasetId: 'dialog-retry', state, drafts: {} }));
    render(createElement(DemoProvider, null, createElement(RecoveryHarness)));
    await waitFor(() => expect(screen.getByTestId('recovery-status')).toHaveTextContent('ready'));
    await userEvent.click(screen.getByText('Open close flow'));
    await screen.findByRole('dialog', { name: 'Cerrar turno · Matutino' });
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await userEvent.type(await screen.findByLabelText('Billete $500.00 · cantidad'), '7');
    await userEvent.click(screen.getByRole('button', { name: 'Volver al turno' }));
    await userEvent.click(screen.getByText('Open close flow'));
    expect(await screen.findByLabelText('Billete $500.00 · cantidad')).toHaveValue('7');
    expect(screen.getByRole('button', { name: 'Reintentar guardado' })).toBeInTheDocument();
    write.mockRestore();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar guardado' }));
    await waitFor(() => expect(screen.getByTestId('recovery-status')).toHaveTextContent('ready'));
    expect(JSON.parse(localStorage.getItem('evogym.demo.operational.v1')!).drafts['demo-shift-01']['quantity-50000']).toBe('7');
  });

  it('closes through the return action without discarding saved input', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onClose });
    await screen.findByRole('dialog', { name: 'Cerrar turno · Matutino' });
    await user.type(await screen.findByLabelText('Billete $500.00 · cantidad'), '3');
    await user.click(screen.getByRole('button', { name: 'Volver al turno' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem('evogym.demo.operational.v1')!).drafts['demo-shift-01']['quantity-50000']).toBe('3');
  });

  it('closes through Escape without discarding saved input', async () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    const dialog = await screen.findByRole('dialog', { name: 'Cerrar turno · Matutino' });
    await screen.findByLabelText('Forma de conteo');
    fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem('evogym.demo.operational.v1')!).drafts['demo-shift-01']).toBeTruthy();
  });

  it('closes through the close control without discarding saved input', async () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    await screen.findByRole('dialog', { name: 'Cerrar turno · Matutino' });
    await screen.findByLabelText('Forma de conteo');
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar diálogo' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem('evogym.demo.operational.v1')!).drafts['demo-shift-01']).toBeTruthy();
  });

  it('supports click to add and right-click to subtract denominations', async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByRole('dialog', { name: 'Cerrar turno · Matutino' });
    await screen.findByLabelText('Forma de conteo');
    const billBtn = await screen.findByRole('button', { name: 'Agregar 1 Billete de $500.00' });

    // Left-click adds 1
    await user.click(billBtn);
    expect(screen.getByLabelText('Billete $500.00 · cantidad')).toHaveValue('1');
    expect(screen.getByText('Subtotal $500.00 MXN')).toBeInTheDocument();

    // Left-click adds another 1 -> 2
    await user.click(billBtn);
    expect(screen.getByLabelText('Billete $500.00 · cantidad')).toHaveValue('2');
    expect(screen.getByText('Subtotal $1,000.00 MXN')).toBeInTheDocument();

    // Right-click (contextmenu) subtracts 1 -> 1
    fireEvent.contextMenu(screen.getByText('Billete $500.00 · cantidad').closest('.shift-close-denomination')!);
    expect(screen.getByLabelText('Billete $500.00 · cantidad')).toHaveValue('1');
    expect(screen.getByText('Subtotal $500.00 MXN')).toBeInTheDocument();
  });

  it('allows counting by money amount with segmented toggle', async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByRole('dialog', { name: 'Cerrar turno · Matutino' });
    await screen.findByLabelText('Forma de conteo');

    // Switch to money amount mode
    await user.click(await screen.findByRole('radio', { name: /Por importe en dinero/ }));
    const billAmountInput = await screen.findByLabelText('Billete $500.00 · importe ($)');

    // Type 1500 (representing $1,500 in $500 bills = 3 bills)
    await user.type(billAmountInput, '1500');
    expect(screen.getByText('3 billetes')).toBeInTheDocument();
    expect(screen.getByText('Subtotal $1,500.00 MXN')).toBeInTheDocument();

    const saved = JSON.parse(localStorage.getItem('evogym.demo.operational.v1')!);
    expect(saved.drafts['demo-shift-01']['quantity-50000']).toBe('3');
    expect(saved.drafts['demo-shift-01']['amount-50000']).toBe('1500');
  });

  it('persists progressive close draft via PUT /close-draft while keeping the shift open', async () => {
    const updatedShift = {
      id: 'shift-draft-1',
      status: 'open',
      closing_draft: {
        mode: 'manual',
        entry_mode: 'units',
        denomination_counts: [],
        manual_total: '500',
        closing_notes: 'Mitad de conteo',
        updated_at: '2026-11-11T18:00:00Z',
      },
    };
    const apiRequest = vi.fn(async () => new Response(JSON.stringify(updatedShift), { status: 200 }));
    const onDraftSaved = vi.fn();
    const user = userEvent.setup();

    render(
      <ShiftCloseDialog
        isOpen
        shiftId="shift-draft-1"
        shiftName="Matutino"
        expectedCashMinor={50000}
        apiRequest={apiRequest}
        onDraftSaved={onDraftSaved}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByLabelText('Forma de conteo'), 'manual');
    await user.type(screen.getByLabelText('Efectivo contado (MXN)'), '500');
    await user.type(screen.getByLabelText(/Observaciones del cierre/), 'Mitad de conteo');
    await user.click(screen.getByRole('button', { name: 'Guardar avance' }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        '/api/v1/shifts/shift-draft-1/close-draft',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            mode: 'manual',
            entry_mode: 'units',
            denomination_counts: [],
            manual_total: '500',
            closing_notes: 'Mitad de conteo',
          }),
        }),
      ),
    );
    expect(onDraftSaved).toHaveBeenCalledWith(updatedShift);
    expect(await screen.findByText('Avance guardado en el servidor. El turno sigue abierto y puedes seguir vendiendo.')).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem('evogym.shift.closeDraft.v1.shift-draft-1')!);
    expect(stored.synced).toBe(true);
    expect(stored.draft.manualTotal).toBe('500');
  });

  it('syncs dirty draft on Volver al turno and restores server draft against updated expected cash on reopen', async () => {
    const serverDraft = {
      mode: 'manual' as const,
      entry_mode: 'units' as const,
      denomination_counts: [],
      manual_total: '500',
      closing_notes: 'Avance turno',
      updated_at: '2099-01-01T12:00:00Z',
    };
    const apiRequest = vi.fn(async () => new Response(JSON.stringify({ id: 'shift-draft-2', status: 'open', closing_draft: serverDraft }), { status: 200 }));
    const onClose = vi.fn();
    const user = userEvent.setup();

    const view = render(
      <ShiftCloseDialog
        isOpen
        shiftId="shift-draft-2"
        shiftName="Matutino"
        expectedCashMinor={50000}
        apiRequest={apiRequest}
        onClose={onClose}
        onSuccess={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByLabelText('Forma de conteo'), 'manual');
    await user.type(screen.getByLabelText('Efectivo contado (MXN)'), '500');
    await user.type(screen.getByLabelText(/Observaciones del cierre/), 'Avance turno');
    await user.click(screen.getByRole('button', { name: 'Volver al turno' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/shifts/shift-draft-2/close-draft', expect.objectContaining({ method: 'PUT' })));

    view.unmount();

    render(
      <ShiftCloseDialog
        isOpen
        shiftId="shift-draft-2"
        shiftName="Matutino"
        expectedCashMinor={75000}
        initialDraft={serverDraft}
        apiRequest={apiRequest}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Efectivo contado (MXN)')).toHaveValue('500');
    expect(screen.getByLabelText(/Observaciones del cierre/)).toHaveValue('Avance turno');
    expect(screen.getByText('$750.00 MXN')).toBeInTheDocument();
    expect(screen.getByText('-$250.00 MXN')).toBeInTheDocument();
  });

  it('saves close draft locally when offline and clears local draft after offline arqueo_close', async () => {
    offline.on = true;
    const onSuccess = vi.fn();
    const user = userEvent.setup();
    try {
      render(
        <ShiftCloseDialog
          isOpen
          shiftId="shift-off-1"
          shiftName="Matutino"
          expectedCashMinor={50000}
          apiRequest={vi.fn()}
          onClose={vi.fn()}
          onSuccess={onSuccess}
        />,
      );

      await user.selectOptions(screen.getByLabelText('Forma de conteo'), 'manual');
      await user.type(screen.getByLabelText('Efectivo contado (MXN)'), '500');
      await user.click(screen.getByRole('button', { name: 'Guardar avance' }));

      expect(await screen.findByText('Avance guardado en este navegador (sin conexión). El turno sigue abierto.')).toBeInTheDocument();
      const stored = JSON.parse(localStorage.getItem('evogym.shift.closeDraft.v1.shift-off-1')!);
      expect(stored.synced).toBe(false);
      expect(stored.draft.manualTotal).toBe('500');

      await user.click(screen.getByRole('button', { name: 'Revisar cierre' }));
      await user.click(screen.getByRole('button', { name: 'Confirmar cierre' }));

      await waitFor(() => expect(offline.dispatch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'shift.arqueo_close' }), 'offline-staff'));
      expect(localStorage.getItem('evogym.shift.closeDraft.v1.shift-off-1')).toBeNull();
      expect(onSuccess).toHaveBeenCalledTimes(1);
    } finally {
      offline.on = false;
    }
  });

  it('cancels review and notifies cashier when expectedCashMinor updates mid-review', async () => {
    const user = userEvent.setup();
    const apiRequest = vi.fn();
    const { rerender } = render(
      <ShiftCloseDialog
        isOpen
        shiftId="shift-live-rev"
        shiftName="Matutino"
        expectedCashMinor={50000}
        apiRequest={apiRequest}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByLabelText('Forma de conteo'), 'manual');
    await user.type(screen.getByLabelText('Efectivo contado (MXN)'), '500');
    await user.click(screen.getByRole('button', { name: 'Revisar cierre' }));
    expect(screen.getByRole('button', { name: 'Confirmar cierre' })).toBeInTheDocument();

    rerender(
      <ShiftCloseDialog
        isOpen
        shiftId="shift-live-rev"
        shiftName="Matutino"
        expectedCashMinor={65000}
        apiRequest={apiRequest}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirmar cierre' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Revisar cierre' })).toBeInTheDocument();
    expect(screen.getByText('El efectivo esperado se actualizó con nuevos movimientos; verifica tu conteo antes de confirmar.')).toBeInTheDocument();
  });
});

