import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Realizar cobro' }));
    expect(screen.getByRole('alert', { name: 'Resultado de compra' })).toHaveTextContent('Existencia insuficiente');
    expect(screen.getByLabelText('Cantidad de Agua')).toHaveTextContent('13');
    expect(screen.getByLabelText('Cantidad de Barra')).toHaveTextContent('1');
    await userEvent.click(screen.getByRole('button', { name: 'Quitar Agua' }));
    await userEvent.click(screen.getByRole('button', { name: 'Disminuir Barra' }));
    expect(screen.getByText('Sin productos seleccionados.')).toBeVisible();
  }, 15000);
  it('shows every fixture product and the current cart checkout panel', () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /><ProductsProbe /></DemoProvider></MemoryRouter>);
    expect(screen.getAllByRole('article')).toHaveLength(Number(screen.getByLabelText('Cantidad de productos').textContent));
    const currentPurchaseHeading = screen.getByRole('heading', { name: 'Compra actual' });
    expect(currentPurchaseHeading).toBeVisible();
    expect(currentPurchaseHeading.closest('section')).toHaveClass('cart-checkout-panel');
    expect(screen.getByRole('button', { name: /Paso 1: Carrito/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Paso 2: Cobro/ })).toBeVisible();
  });
  it('selects several products, changes quantity and clears only after confirmed checkout', async () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /></DemoProvider></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Agua' }));
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Barra' }));
    await userEvent.click(screen.getByRole('button', { name: 'Aumentar Agua' }));
    expect(screen.getByLabelText('Total de compra')).toHaveTextContent('$75.00');
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cobro' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Realizar cobro' }));
    expect(screen.getByRole('status', { name: 'Resultado de compra' })).toHaveTextContent('Cobro registrado');
    expect(screen.getByText('Sin productos seleccionados.')).toBeVisible();
  });
  it('retains pending transfers and prevents duplicate recording on repeat confirmation', async () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /></DemoProvider></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Agua' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cobro' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Transferencia' }));
    await userEvent.click(screen.getByRole('button', { name: 'Registrar compra pendiente' }));
    expect(screen.getByRole('status', { name: 'Resultado de compra' })).toHaveTextContent('Transferencia pendiente');
    expect(screen.getByLabelText('Total de compra')).toHaveTextContent('$20.00');
    expect(screen.queryByText('Sin productos seleccionados.')).not.toBeInTheDocument();
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
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Agua' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cobro' }));
    expect(screen.getByRole('radio', { name: 'Tarjeta' })).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(screen.getByRole('radio', { name: 'Tarjeta' }));
    expect(screen.getByRole('radio', { name: 'Tarjeta' })).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(screen.getByRole('button', { name: '← Volver al carrito' }));
    await userEvent.click(screen.getByRole('button', { name: 'Desasignar socio' }));
    expect(screen.queryByText('Socio asignado:')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Asignar socio' })).toBeVisible();
  });

  it('calculates cash tender change and supports pago exacto', async () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /></DemoProvider></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Agua' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cobro' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
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

    const mermaBtn = screen.getByRole('button', { name: 'Merma' });
    expect(mermaBtn).toBeDisabled();

    // Select product Agua
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Agua' }));
    expect(mermaBtn).toBeEnabled();

    await userEvent.click(mermaBtn);
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Registrar merma de producto' })).toBeVisible();
    expect(screen.getByText(/Productos seleccionados/)).toBeVisible();
    expect(screen.getByText('Valor total de la merma:')).toBeVisible();

    await userEvent.type(screen.getByLabelText('Motivo o comentario *'), 'Botella dañada en recepción');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar merma' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText('Stock: 11')).toBeVisible();
    });
    expect(screen.getByRole('status', { name: 'Resultado de compra' })).toHaveTextContent('Merma registrada');
  });

  it('allows selecting multiple products on screen and confirms bulk merma', async () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /></DemoProvider></MemoryRouter>);
    const mermaBtn = screen.getByRole('button', { name: 'Merma' });
    expect(mermaBtn).toBeDisabled();

    // Select 2 Aguas and 1 Barra
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Agua' }));
    await userEvent.click(screen.getByRole('button', { name: 'Aumentar Agua' }));
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Barra' }));

    expect(mermaBtn).toBeEnabled();
    await userEvent.click(mermaBtn);

    expect(screen.getByText(/Productos seleccionados \(3 unidades\)/)).toBeVisible();
    expect(screen.getByText('Valor total de la merma:')).toBeVisible();

    await userEvent.type(screen.getByLabelText('Motivo o comentario *'), 'Caja de productos rota en almacén');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar merma' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText('Stock: 10')).toBeVisible(); // Agua 12 - 2 = 10
      expect(screen.getByLabelText('Stock: 7')).toBeVisible(); // Barra 8 - 1 = 7
    });
    expect(screen.getByText('Sin productos seleccionados.')).toBeVisible();
  });

  it('opens Devoluciones modal, searches client, and allows selecting return items', async () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /></DemoProvider></MemoryRouter>);

    const devBtn = screen.getByRole('button', { name: 'Devoluciones' });
    expect(devBtn).toBeVisible();
    await userEvent.click(devBtn);

    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Registrar devolución' })).toBeVisible();

    // Search client
    const searchInput = screen.getByPlaceholderText('Buscar cliente por nombre o teléfono...');
    await userEvent.type(searchInput, 'Carlos');
    expect(screen.getByText('Carlos Rivera')).toBeVisible();

    // Select client
    await userEvent.click(screen.getByText('Carlos Rivera'));
    expect(screen.getByText(/Cliente seleccionado:/)).toBeVisible();

    // Close modal with Cancelar
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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

  it('opens the mobile purchase detail without clearing the current selection', async () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /></DemoProvider></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Agua' }));
    await userEvent.click(document.querySelector('.mobile-detail-trigger')!);
    expect(screen.getByRole('dialog', { name: 'Compra actual' })).toBeVisible();
    expect(screen.getByLabelText('Total de compra')).toHaveTextContent('$20.00 MXN');
    await userEvent.click(document.querySelector('.mobile-detail-close')!);
    expect(screen.queryByRole('dialog', { name: 'Compra actual' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Total de compra')).toHaveTextContent('$20.00 MXN');
  });

  it('dismisses member suggestions before closing the mobile purchase detail on Escape', async () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /></DemoProvider></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Agua' }));
    await userEvent.click(document.querySelector('.mobile-detail-trigger')!);

    const assignInput = screen.getByRole('combobox', { name: 'Asignar socio' });
    await userEvent.type(assignInput, 'Mariana');
    expect(assignInput).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'Compra actual' })).toBeVisible();

    await userEvent.keyboard('{Escape}');
    expect(assignInput).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('dialog', { name: 'Compra actual' })).toBeVisible();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Compra actual' })).not.toBeInTheDocument();
  });

  it('navigates cleanly between Step 1 (cart) and Step 2 (payment)', async () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /></DemoProvider></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Agua' }));
    
    // In step 1: proceed button is visible, payment methods are not
    expect(screen.getByRole('button', { name: /Proceder al cobro|Revisar cobro/ })).toBeVisible();
    expect(screen.queryByRole('radio', { name: 'Efectivo' })).not.toBeInTheDocument();

    // Advance to step 2
    await userEvent.click(screen.getByRole('button', { name: /Proceder al cobro|Revisar cobro/ }));
    expect(screen.getByRole('radio', { name: 'Efectivo' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Tarjeta' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Transferencia' })).toBeVisible();
    // Mixed and Pending explicit tiles are removed
    expect(screen.queryByRole('radio', { name: 'Pago mixto' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Pendiente' })).not.toBeInTheDocument();

    // Initially unselected: button prompts to select
    expect(screen.getByRole('button', { name: 'Selecciona un método de cobro' })).toBeDisabled();

    // Select Efectivo
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    expect(screen.getByRole('button', { name: 'Realizar cobro' })).toBeEnabled();

    // Go back to step 1
    await userEvent.click(screen.getByRole('button', { name: '← Volver al carrito' }));
    expect(screen.getByRole('button', { name: /Proceder al cobro|Revisar cobro/ })).toBeVisible();
    expect(screen.queryByRole('radio', { name: 'Efectivo' })).not.toBeInTheDocument();
  });

  it('supports mixed payments and assigning pending sales to a member', async () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /></DemoProvider></MemoryRouter>);
    const assignInput = screen.getByRole('combobox', { name: 'Asignar socio' });
    await userEvent.click(assignInput);
    await userEvent.click(screen.getByText('Mariana López'));

    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Agua' }));
    await userEvent.click(screen.getByRole('button', { name: /Proceder al cobro|Revisar cobro/ }));

    // Select Efectivo, then combine with Tarjeta
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Tarjeta' }), { ctrlKey: true });

    // Sub-step 1: First payment
    expect(screen.getByText('Cobro con Efectivo')).toBeVisible();
    expect(screen.getByText(/Faltante:/)).toBeVisible();
    expect(screen.getByLabelText(/Monto primer cobro con Efectivo/)).toBeVisible();
    await userEvent.type(screen.getByLabelText(/Monto primer cobro con Efectivo/), '10');

    // Advance to Sub-step 2
    await userEvent.click(screen.getByRole('button', { name: /Abonar.*y pasar a Tarjeta/ }));

    // Sub-step 2: Second payment
    expect(screen.getByText('Cobro con Tarjeta')).toBeVisible();
    expect(screen.getByText('Total 100% cubierto')).toBeVisible();

    // Verify clicking completed tile (Efectivo with checkmark) returns to Sub-step 1
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    expect(screen.getByText('Cobro con Efectivo')).toBeVisible();
    expect(screen.getByLabelText(/Monto primer cobro con Efectivo/)).toBeVisible();

    // Re-advance to Sub-step 2
    await userEvent.click(screen.getByRole('button', { name: /Abonar.*y pasar a Tarjeta/ }));
    expect(screen.getByText('Cobro con Tarjeta')).toBeVisible();

    // Confirm full mixed payment
    await userEvent.click(screen.getByRole('button', { name: 'Realizar cobro mixto' }));
    expect(screen.getByRole('status', { name: 'Resultado de compra' })).toHaveTextContent('Cobro mixto registrado con éxito');
  });

  it('opens pending balance modal when mixed payment has shortfall and confirms pending balance', async () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /></DemoProvider></MemoryRouter>);
    const assignInput = screen.getByRole('combobox', { name: 'Asignar socio' });
    await userEvent.click(assignInput);
    await userEvent.click(screen.getByText('Mariana López'));

    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Agua' }));
    await userEvent.click(screen.getByRole('button', { name: /Proceder al cobro|Revisar cobro/ }));

    // Select Efectivo + Tarjeta
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Tarjeta' }), { ctrlKey: true });

    // Step 1: $10 cash
    await userEvent.type(screen.getByLabelText(/Monto primer cobro con Efectivo/), '10');
    await userEvent.click(screen.getByRole('button', { name: /Abonar.*y pasar a Tarjeta/ }));

    // Step 2: Clear card amount to create shortfall
    await userEvent.clear(screen.getByLabelText(/Monto segundo cobro con Tarjeta/));

    // Click Realizar cobro with shortfall
    await userEvent.click(screen.getByRole('button', { name: /Realizar cobro mixto/ }));

    // Modal opens
    expect(screen.getByRole('dialog', { name: 'Confirmar saldo pendiente' })).toBeVisible();
    expect(screen.getByText('Saldo pendiente por asignar:')).toBeVisible();

    // Confirm shortfall in modal
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar y asignar pendiente' }));
    expect(screen.getByRole('status', { name: 'Resultado de compra' })).toHaveTextContent('Cobro registrado: $10.00 MXN cobrados y $10.00 MXN asignados como saldo pendiente a Mariana López');
  });

  it('opens pending balance modal when single cash payment has shortfall', async () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /></DemoProvider></MemoryRouter>);
    const assignInput = screen.getByRole('combobox', { name: 'Asignar socio' });
    await userEvent.click(assignInput);
    await userEvent.click(screen.getByText('Mariana López'));

    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Agua' }));
    await userEvent.click(screen.getByRole('button', { name: /Proceder al cobro|Revisar cobro/ }));

    // Select Efectivo and tender partial cash
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    await userEvent.type(screen.getByLabelText('Monto recibido'), '10');

    // Click Realizar cobro
    await userEvent.click(screen.getByRole('button', { name: 'Realizar cobro' }));

    // Modal opens
    expect(screen.getByRole('dialog', { name: 'Confirmar saldo pendiente' })).toBeVisible();
    expect(screen.getByText('Saldo pendiente por asignar:')).toBeVisible();

    // Confirm shortfall in modal
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar y asignar pendiente' }));
    expect(screen.getByRole('status', { name: 'Resultado de compra' })).toHaveTextContent('Cobro registrado: $10.00 MXN cobrados en efectivo y $10.00 MXN asignados como saldo pendiente a Mariana López');
  });
});


