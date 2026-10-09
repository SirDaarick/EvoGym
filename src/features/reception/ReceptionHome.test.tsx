import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DemoProvider, useDemo } from '../../demo/DemoProvider';
import { ReceptionHome } from './ReceptionHome';

function ProductsProbe() {
  const { state } = useDemo();
  return <output aria-label="Cantidad de productos">{state.products.length}</output>;
}

describe('Reception Home overview', () => {
  it('retains all quantities on insufficient stock and allows removal', async () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /></DemoProvider></MemoryRouter>);
    for (let count = 0; count < 13; count++) await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Agua · producto ilustrativo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Barra · producto ilustrativo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cobro' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cobro de demostración' }));
    expect(screen.getByRole('alert', { name: 'Resultado de compra' })).toHaveTextContent('Existencia insuficiente');
    expect(screen.getByLabelText('Cantidad de Agua · producto ilustrativo')).toHaveTextContent('13');
    expect(screen.getByLabelText('Cantidad de Barra · producto ilustrativo')).toHaveTextContent('1');
    await userEvent.click(screen.getByRole('button', { name: 'Quitar Agua · producto ilustrativo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Disminuir Barra · producto ilustrativo' }));
    expect(screen.getByText('Sin productos seleccionados.')).toBeVisible();
  });
  it('shows every fixture product and the honest existing sale route', () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /><ProductsProbe /></DemoProvider></MemoryRouter>);
    expect(screen.getAllByRole('article')).toHaveLength(Number(screen.getByLabelText('Cantidad de productos').textContent));
    expect(screen.getByRole('link', { name: 'Registrar venta' })).toHaveAttribute('href', '/reception/sales');
    expect(screen.getByRole('heading', { name: 'Compra actual' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Buscar socio' })).toHaveAttribute('href', '/reception/members');
    expect(screen.getByText('Imágenes pendientes · Los productos, precios y existencias son ilustrativos.')).toBeVisible();
  });
  it('selects several products, changes quantity and clears only after confirmed checkout', async () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /></DemoProvider></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Agua · producto ilustrativo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Barra · producto ilustrativo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Aumentar Agua · producto ilustrativo' }));
    expect(screen.getByLabelText('Total de compra')).toHaveTextContent('$75.00');
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cobro' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cobro de demostración' }));
    expect(screen.getByRole('status', { name: 'Resultado de compra' })).toHaveTextContent('Cobro confirmado');
    expect(screen.getByText('Sin productos seleccionados.')).toBeVisible();
  });
  it('retains pending transfers and prevents duplicate recording on repeat confirmation', async () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /></DemoProvider></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Agua · producto ilustrativo' }));
    await userEvent.selectOptions(screen.getByLabelText('Método de cobro'), 'transfer');
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cobro' }));
    await userEvent.click(screen.getByRole('button', { name: 'Registrar compra pendiente' }));
    expect(screen.getByRole('status', { name: 'Resultado de compra' })).toHaveTextContent('Transferencia pendiente');
    expect(screen.getByLabelText('Total de compra')).toHaveTextContent('$20.00');
    expect(screen.queryByText('Sin productos seleccionados.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Método de cobro')).toBeDisabled();
  });
});
