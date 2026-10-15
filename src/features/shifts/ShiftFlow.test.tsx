import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { DemoProvider, useDemo } from '../../demo/DemoProvider';

const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;

beforeEach(() => {
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  vi.stubGlobal('navigator', Object.create(window.navigator, { locks: { value: { request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<void>) => callback({}) } } }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
});

function mount(path: string) {
  render(<MemoryRouter initialEntries={[path]}><DemoProvider><App /></DemoProvider></MemoryRouter>);
}
async function openCloseForm() {
  await userEvent.click(screen.getByRole('button', { name: 'Cerrar turno' }));
  await screen.findByRole('dialog', { name: 'Cerrar turno · Matutino' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Revisar cierre' })).toBeEnabled());
}
describe('operational demo screens', () => {
  it('opens the native dialog and exposes an expandable expected-cash breakdown', async () => {
    mount('/reception/shifts');
    await openCloseForm();
    expect(screen.getByRole('dialog', { name: 'Cerrar turno · Matutino' })).toHaveAttribute('open');
    expect(screen.getByText('Desglose del efectivo esperado')).toBeInTheDocument();
  });
  it('rejects fractional quantities and keeps manual total separate', async () => {
    mount('/reception/shifts');
    await openCloseForm();
    await userEvent.selectOptions(screen.getByLabelText('Forma de conteo'), 'manual');
    await userEvent.type(screen.getByLabelText('Efectivo contado (MXN)'), '500');
    await userEvent.selectOptions(screen.getByLabelText('Forma de conteo'), 'denominations');
    await userEvent.type(screen.getByLabelText('Moneda $0.50 · cantidad'), '1.5');
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cierre' }));
    expect(screen.getByRole('alert')).toHaveTextContent('solo enteros no negativos');
    expect(screen.queryByRole('button', { name: 'Confirmar cierre' })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Forma de conteo'), 'manual');
    expect(screen.queryByLabelText('Total por denominaciones')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cierre' }));
    expect(screen.getByRole('region', { name: 'Resumen de revisión' })).toHaveTextContent('$500.00');
  });
  it('counts denominations, invalidates edits and preserves their close snapshot', async () => {
    mount('/reception/shifts');
    await openCloseForm();
    await userEvent.selectOptions(screen.getByLabelText('Forma de conteo'), 'denominations');
    expect(screen.queryByLabelText('Efectivo contado (MXN)')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Billete $500.00 · cantidad'), '1');
    expect(screen.getByRole('region', { name: 'Resumen del conteo' })).toHaveTextContent('$500.00');
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cierre' }));
    await userEvent.click(screen.getByRole('button', { name: 'Volver al conteo' }));
    await userEvent.clear(screen.getByLabelText('Billete $500.00 · cantidad'));
    await userEvent.type(screen.getByLabelText('Billete $500.00 · cantidad'), '2');
    expect(screen.queryByRole('button', { name: 'Confirmar cierre de demostración' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cierre' }));
    expect(screen.getByRole('region', { name: 'Resumen de revisión' })).toHaveTextContent('$1,000.00');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cierre' }));
    expect(screen.getByRole('region', { name: 'Conteo registrado' })).toHaveTextContent('2');
  });
  it('rejects closing a denomination preview after financial activity', async () => {
    function FinancialChange() {
      const { update } = useDemo();
      return <button onClick={() => update(state => ({ ...state, revision: state.revision + 1 }))}>Otro registro</button>;
    }
    render(<MemoryRouter initialEntries={['/reception/shifts']}><DemoProvider><App /><FinancialChange /></DemoProvider></MemoryRouter>);
    await openCloseForm();
    await userEvent.selectOptions(screen.getByLabelText('Forma de conteo'), 'denominations');
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cierre' }));
    await userEvent.click(screen.getByRole('button', { name: 'Otro registro' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cierre' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Los registros cambiaron');
    expect(screen.getByText('Turno abierto')).toBeVisible();
  });
  it('renders legacy total-only cash records without fabricated quantities', async () => {
    mount('/owner/shifts');
    await userEvent.selectOptions(screen.getByLabelText('Turno a consultar'), 'demo-shift-previous');
    expect(screen.getByText('Sin desglose por denominación registrado.')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Conteo registrado' })).not.toBeInTheDocument();
  });
  it('reviews and confirms an illustrative product sale', async () => {
    mount('/reception/sales');
    await userEvent.click(screen.getByRole('button', { name: 'Revisar venta' }));
    await userEvent.click(screen.getByRole('button', { name: 'Registrar venta' }));
    expect(screen.getByRole('heading', { name: 'Venta registrada' })).toBeVisible();
  });
  it('closes the current shift and opens another with a separate float', async () => {
    mount('/reception/shifts');
    await openCloseForm();
    await userEvent.selectOptions(screen.getByLabelText('Forma de conteo'), 'manual');
    await userEvent.type(screen.getByLabelText('Efectivo contado (MXN)'), '500');
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cierre' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cierre' }));
    expect(screen.getByText('Turno cerrado')).toBeVisible();
    await userEvent.type(screen.getByLabelText('Fondo inicial (MXN)'), '300');
    await userEvent.click(screen.getByRole('button', { name: 'Abrir turno' }));
    expect(screen.getByText('Turno abierto')).toBeVisible();
  });
  it('shows all shift selection only to the owner view', () => {
    mount('/owner/shifts');
    expect(screen.getByLabelText('Turno a consultar')).toBeVisible();
  });
  it('does not expose old shift selection in reception', () => {
    mount('/reception/shifts');
    expect(screen.queryByLabelText('Turno a consultar')).not.toBeInTheDocument();
    expect(screen.queryByText('demo-shift-previous')).not.toBeInTheDocument();
  });
  it('keeps a visit transfer pending rather than showing a confirmed sale', async () => {
    mount('/reception/sales');
    await userEvent.selectOptions(screen.getByLabelText('Tipo de venta'), 'visit');
    await userEvent.selectOptions(screen.getByLabelText('Área de visita'), 'COMBO');
    await userEvent.selectOptions(screen.getByLabelText('Método de venta'), 'transfer');
    await userEvent.click(screen.getByRole('button', { name: 'Revisar venta' }));
    await userEvent.click(screen.getByRole('button', { name: 'Registrar venta pendiente' }));
    expect(screen.getByRole('heading', { name: 'Venta pendiente de transferencia' })).toBeVisible();
    expect(screen.getByText(/Transferencia registrada pendiente/)).toBeVisible();
  });
  it('keeps the inventory receipt preview non-persistent', async () => {
    mount('/reception/inventory');
    expect(screen.getByRole('heading', { name: 'Recepción de inventario' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Confirmar recepción' })).toBeDisabled();
    expect(screen.getByText(/No se guardará ningún movimiento/)).toBeVisible();
  });
});
