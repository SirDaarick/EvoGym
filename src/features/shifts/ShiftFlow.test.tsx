import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from '../../app/App';
import { DemoProvider, useDemo } from '../../demo/DemoProvider';

function mount(path: string) {
  render(<MemoryRouter initialEntries={[path]}><DemoProvider><App /></DemoProvider></MemoryRouter>);
}
describe('operational demo screens', () => {
  it('rejects fractional quantities and keeps manual total separate', async () => {
    mount('/reception/shifts');
    await userEvent.type(screen.getByLabelText('Efectivo contado (MXN)'), '500');
    await userEvent.selectOptions(screen.getByLabelText('Forma de conteo'), 'denominations');
    await userEvent.type(screen.getByLabelText('Moneda $0.50 · cantidad'), '1.5');
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cierre' }));
    expect(screen.getByRole('alert')).toHaveTextContent('solo enteros no negativos');
    expect(screen.queryByRole('button', { name: 'Confirmar cierre de demostración' })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Forma de conteo'), 'manual');
    expect(screen.queryByLabelText('Total por denominaciones')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cierre' }));
    expect(screen.getByText('Contado: $500.00 MXN')).toBeVisible();
  });
  it('counts denominations, invalidates edits and preserves their close snapshot', async () => {
    mount('/reception/shifts');
    await userEvent.selectOptions(screen.getByLabelText('Forma de conteo'), 'denominations');
    expect(screen.queryByLabelText('Efectivo contado (MXN)')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Billete $500.00 · cantidad'), '1');
    expect(screen.getByLabelText('Total por denominaciones')).toHaveTextContent('$500.00');
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cierre' }));
    await userEvent.click(screen.getByRole('button', { name: 'Volver al conteo' }));
    await userEvent.clear(screen.getByLabelText('Billete $500.00 · cantidad'));
    await userEvent.type(screen.getByLabelText('Billete $500.00 · cantidad'), '2');
    expect(screen.queryByRole('button', { name: 'Confirmar cierre de demostración' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cierre' }));
    expect(screen.getByText('Contado: $1,000.00 MXN')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cierre de demostración' }));
    expect(screen.getByRole('region', { name: 'Conteo registrado' })).toHaveTextContent('2');
  });
  it('rejects closing a denomination preview after financial activity', async () => {
    function FinancialChange() {
      const { update } = useDemo();
      return <button onClick={() => update(state => ({ ...state, revision: state.revision + 1 }))}>Otro registro</button>;
    }
    render(<MemoryRouter initialEntries={['/reception/shifts']}><DemoProvider><App /><FinancialChange /></DemoProvider></MemoryRouter>);
    await userEvent.selectOptions(screen.getByLabelText('Forma de conteo'), 'denominations');
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cierre' }));
    await userEvent.click(screen.getByRole('button', { name: 'Otro registro' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cierre de demostración' }));
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
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar venta de demostración' }));
    expect(screen.getByRole('heading', { name: 'Venta confirmada en la demo' })).toBeVisible();
  });
  it('closes the current shift and opens another with a separate float', async () => {
    mount('/reception/shifts');
    await userEvent.type(screen.getByLabelText('Efectivo contado (MXN)'), '500');
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cierre' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cierre de demostración' }));
    expect(screen.getByText('Turno cerrado')).toBeVisible();
    await userEvent.type(screen.getByLabelText('Fondo inicial (MXN)'), '300');
    await userEvent.click(screen.getByRole('button', { name: 'Abrir turno de demostración' }));
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
    expect(screen.getByText(/sin reducción de inventario/)).toBeVisible();
  });
  it('records an observed count without changing expected stock', async () => {
    mount('/reception/inventory');
    await userEvent.type(screen.getByLabelText('Unidades'), '11');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar cantidad' }));
    expect(screen.getByText('Conteo observado registrado; existencias sin corrección.')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Conteos físicos' })).toHaveTextContent('-1');
    expect(screen.getByRole('region', { name: 'Inventario ilustrativo' })).toHaveTextContent('12');
    expect(screen.getByRole('button', { name: 'Registrar cantidad' })).toBeDisabled();
  });
});
