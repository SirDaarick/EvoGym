import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { DemoProvider, useDemo } from '../../demo/DemoProvider';
import { ReceptionHome } from './ReceptionHome';

function ProductsProbe() {
  const { state } = useDemo();
  return <output aria-label="Cantidad de productos">{state.products.length}</output>;
}

describe('Reception Home overview', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') {
      window.localStorage?.clear();
      window.sessionStorage?.clear();
    }
  });
  it('retains all quantities on insufficient stock and allows removal', async () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /></DemoProvider></MemoryRouter>);
    for (let count = 0; count < 13; count++) await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Agua' }));
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Barra' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cobro' }));
    await userEvent.click(screen.getByRole('button', { name: 'Registrar cobro' }));
    expect(screen.getByRole('alert', { name: 'Resultado de compra' })).toHaveTextContent('Existencia insuficiente');
    expect(screen.getByLabelText('Cantidad de Agua')).toHaveTextContent('13');
    expect(screen.getByLabelText('Cantidad de Barra')).toHaveTextContent('1');
    await userEvent.click(screen.getByRole('button', { name: 'Quitar Agua' }));
    await userEvent.click(screen.getByRole('button', { name: 'Disminuir Barra' }));
    expect(screen.getByText('Sin productos seleccionados.')).toBeVisible();
  });
  it('shows every fixture product and the current cart checkout panel', () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /><ProductsProbe /></DemoProvider></MemoryRouter>);
    expect(screen.getAllByRole('article')).toHaveLength(Number(screen.getByLabelText('Cantidad de productos').textContent));
    const currentPurchaseHeading = screen.getByRole('heading', { name: 'Compra actual' });
    expect(currentPurchaseHeading).toBeVisible();
    expect(currentPurchaseHeading.closest('section')).toHaveClass('cart-checkout-panel');
    expect(screen.getByRole('radio', { name: 'Efectivo' })).toBeVisible();
  });
  it('selects several products, changes quantity and clears only after confirmed checkout', async () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /></DemoProvider></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Agua' }));
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Barra' }));
    await userEvent.click(screen.getByRole('button', { name: 'Aumentar Agua' }));
    expect(screen.getByLabelText('Total de compra')).toHaveTextContent('$75.00');
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cobro' }));
    await userEvent.click(screen.getByRole('button', { name: 'Registrar cobro' }));
    expect(screen.getByRole('status', { name: 'Resultado de compra' })).toHaveTextContent('Cobro registrado');
    expect(screen.getByText('Sin productos seleccionados.')).toBeVisible();
  });
  it('retains pending transfers and prevents duplicate recording on repeat confirmation', async () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /></DemoProvider></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Agua' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Transferencia' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cobro' }));
    await userEvent.click(screen.getByRole('button', { name: 'Registrar compra pendiente' }));
    expect(screen.getByRole('status', { name: 'Resultado de compra' })).toHaveTextContent('Transferencia pendiente');
    expect(screen.getByLabelText('Total de compra')).toHaveTextContent('$20.00');
    expect(screen.queryByText('Sin productos seleccionados.')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Transferencia' })).toBeDisabled();
  });

  it('renders top clay shortcuts buttons and stock badges', () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /></DemoProvider></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Gasto' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Extra' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Guantes' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Suplementos' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Casilleros' })).toBeVisible();
    expect(screen.getByLabelText('Stock: 12')).toBeVisible();
  });

  it('assigns a member to the cart, preselects favorite payment and allows unassigning', async () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /></DemoProvider></MemoryRouter>);
    const assignInput = screen.getByRole('combobox', { name: 'Asignar socio' });
    expect(assignInput).toBeVisible();
    await userEvent.click(assignInput);
    await userEvent.click(screen.getByText('Mariana López'));
    expect(screen.getByText('Mariana López')).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Tarjeta' })).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Desasignar socio' }));
    expect(screen.queryByText('Socio asignado:')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Asignar socio' })).toBeVisible();
  });

  it('calculates cash tender change and supports pago exacto', async () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /></DemoProvider></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Agua' }));
    expect(screen.getByRole('radio', { name: 'Efectivo' })).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Pago exacto' }));
    expect(screen.getByLabelText('Monto recibido')).toHaveValue('20.00');
    expect(screen.getByText('$0.00 MXN')).toBeVisible();

    await userEvent.clear(screen.getByLabelText('Monto recibido'));
    await userEvent.type(screen.getByLabelText('Monto recibido'), '50');
    expect(screen.getByText('$30.00 MXN')).toBeVisible();
    await userEvent.clear(screen.getByLabelText('Monto recibido'));
    await userEvent.type(screen.getByLabelText('Monto recibido'), '1.234');
    expect(screen.getByText('Monto inválido')).toBeVisible();
  });

  it('registers product merma and immediately deducts stock', async () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /></DemoProvider></MemoryRouter>);
    expect(screen.getByLabelText('Stock: 12')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Merma' }));
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Registrar merma de producto' })).toBeVisible();

    await userEvent.type(screen.getByLabelText('Motivo o comentario *'), 'Botella dañada en recepción');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar merma' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText('Stock: 11')).toBeVisible();
    });
    expect(screen.getByRole('status', { name: 'Resultado de compra' })).toHaveTextContent('Merma registrada');
  });

  it('decrements and removes product on right click (context menu)', async () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /></DemoProvider></MemoryRouter>);
    const selectBtn = screen.getByRole('button', { name: 'Seleccionar Agua' });
    await userEvent.click(selectBtn);
    await userEvent.click(selectBtn);
    expect(screen.getByLabelText('Cantidad de Agua')).toHaveTextContent('2');

    // Right-click decrements by 1
    await userEvent.pointer({ keys: '[MouseRight]', target: selectBtn });
    expect(screen.getByLabelText('Cantidad de Agua')).toHaveTextContent('1');

    // Right-click again removes from cart
    await userEvent.pointer({ keys: '[MouseRight]', target: selectBtn });
    expect(screen.getByText('Sin productos seleccionados.')).toBeVisible();
  });

  it('opens and closes Guantes modal from shortcut button', async () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /></DemoProvider></MemoryRouter>);
    const guantesBtn = screen.getByRole('button', { name: 'Guantes' });
    expect(guantesBtn).toBeVisible();

    await userEvent.click(guantesBtn);
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Guantes' })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar modal de guantes' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens and closes Gasto, Extra, Suplementos, and Casilleros modals from shortcut buttons', async () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /></DemoProvider></MemoryRouter>);

    // Gasto
    await userEvent.click(screen.getByRole('button', { name: 'Gasto' }));
    expect(screen.getByRole('heading', { name: 'Registrar Gasto' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar modal de gasto' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Extra
    await userEvent.click(screen.getByRole('button', { name: 'Extra' }));
    expect(screen.getByRole('heading', { name: 'Registrar Extra' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar modal de extra' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Suplementos
    await userEvent.click(screen.getByRole('button', { name: 'Suplementos' }));
    expect(screen.getByRole('heading', { name: 'Suplementos' })).toBeVisible();
      expect(screen.queryByText(/de demostración/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar modal de suplementos' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Casilleros
    await userEvent.click(screen.getByRole('button', { name: 'Casilleros' }));
    expect(screen.getByRole('heading', { name: 'Casilleros' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar modal de casilleros' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

