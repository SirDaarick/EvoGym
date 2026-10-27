import { createElement, useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoProvider, useDemo } from '../../demo/DemoProvider';
import { createDemoState } from '../../demo/adapter';
import { ShiftCloseDialog } from './ShiftCloseDialog';

const originalShowModal = HTMLDialogElement.prototype.showModal;
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
    await user.click(screen.getByRole('button', { name: 'Revisar cierre' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar cierre' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/solicitud falló|revisa los datos/i);
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
});

