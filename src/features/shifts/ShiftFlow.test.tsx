import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from '../../app/App';
import { DemoProvider } from '../../demo/DemoProvider';

function mount(path: string) {
  render(<MemoryRouter initialEntries={[path]}><DemoProvider><App /></DemoProvider></MemoryRouter>);
}
describe('operational demo screens', () => {
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
