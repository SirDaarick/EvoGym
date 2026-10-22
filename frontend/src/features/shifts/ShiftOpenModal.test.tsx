import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShiftOpenModal, type ShiftOpenConfirmData } from './ShiftOpenModal';
import { createRichDemoState } from '../../demo/richDemoState';

const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});

afterEach(() => {
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
});

describe('ShiftOpenModal Stepper', () => {
  const dummyState = createRichDemoState();

  it('renders Step 1 with denominations breakdown, calculates subtotal in real time', async () => {
    const handleClose = vi.fn();
    const handleConfirm = vi.fn();

    render(
      <ShiftOpenModal
        isOpen
        state={dummyState}
        onClose={handleClose}
        onConfirm={handleConfirm}
      />
    );

    expect(screen.getByRole('dialog')).toHaveAttribute('open');
    expect(screen.getByText('1. Conteo de Caja Chica')).toBeInTheDocument();
    expect(screen.getByLabelText('Recepcionista Responsable')).toBeInTheDocument();
    expect(screen.getByLabelText('Horario de Turno')).toBeInTheDocument();

    // Check denominations table exists ($500, $200, $100, etc.)
    expect(screen.getByLabelText('Billete $500.00 · cantidad')).toBeInTheDocument();
    expect(screen.getByLabelText('Billete $200.00 · cantidad')).toBeInTheDocument();
    expect(screen.getByLabelText('Moneda $10.00 · cantidad')).toBeInTheDocument();

    // Type into denomination: 2 bills of $500 = $1,000.00 MXN
    const bill500 = screen.getByLabelText('Billete $500.00 · cantidad');
    await userEvent.type(bill500, '2');

    // Real-time subtotal calculation
    expect(screen.getByText('$1,000.00 MXN')).toBeInTheDocument();

    // Add 3 coins of $10 = $30.00 MXN -> Total $1,030.00 MXN
    const coin10 = screen.getByLabelText('Moneda $10.00 · cantidad');
    await userEvent.type(coin10, '3');
    expect(screen.getByText('$1,030.00 MXN')).toBeInTheDocument();
  });

  it('allows manual count mode and validates invalid values', async () => {
    const handleClose = vi.fn();
    const handleConfirm = vi.fn();

    render(
      <ShiftOpenModal
        isOpen
        state={dummyState}
        onClose={handleClose}
        onConfirm={handleConfirm}
      />
    );

    // Switch to manual mode
    await userEvent.selectOptions(screen.getByLabelText('Forma de conteo'), 'manual');
    expect(screen.getByLabelText('Fondo inicial (MXN)')).toBeInTheDocument();

    // Type invalid float
    await userEvent.type(screen.getByLabelText('Fondo inicial (MXN)'), 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Continuar a Inventario →' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Ingresa un monto válido');

    // Fix manual float
    await userEvent.clear(screen.getByLabelText('Fondo inicial (MXN)'));
    await userEvent.type(screen.getByLabelText('Fondo inicial (MXN)'), '450.50');
    expect(screen.getByText('$450.50 MXN')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Continuar a Inventario →' }));
    expect(screen.getByText('2. Inventario Inicial')).toBeInTheDocument();
  });

  it('navigates through Step 2 (Inventory verification & waste adjustment) and Step 3 (Confirmation)', async () => {
    const handleClose = vi.fn();
    let confirmedData: ShiftOpenConfirmData | null = null;
    const handleConfirm = (data: ShiftOpenConfirmData) => {
      confirmedData = data;
    };

    render(
      <ShiftOpenModal
        isOpen
        state={dummyState}
        onClose={handleClose}
        onConfirm={handleConfirm}
      />
    );

    // Step 1: Input cash ($500 x 1 = $500.00 MXN)
    await userEvent.type(screen.getByLabelText('Billete $500.00 · cantidad'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Continuar a Inventario →' }));

    // Step 2: In inventory table
    expect(screen.getByText('2. Inventario Inicial')).toBeInTheDocument();
    expect(screen.getByText('Toalla Microfibra Gym')).toBeInTheDocument();
    expect(screen.getByText('Agua')).toBeInTheDocument();

    // Adjust a product: e.g. "Toalla Microfibra Gym" (expected 5) -> set physical to 4
    const toallaInput = screen.getByLabelText('Stock físico de Toalla Microfibra Gym');
    await userEvent.clear(toallaInput);
    await userEvent.type(toallaInput, '4');

    // Check waste badge and reason
    expect(screen.getByText('Merma (-1)')).toBeInTheDocument();
    expect(screen.getByLabelText('Motivo de merma para Toalla Microfibra Gym')).toHaveValue('Merma detectada al abrir');

    // Continue to Step 3
    await userEvent.click(screen.getByRole('button', { name: 'Continuar a Resumen →' }));

    // Step 3: Resumen y Confirmación
    expect(screen.getByText('3. Resumen y Confirmación')).toBeInTheDocument();
    expect(screen.getByText('Recepcionista Responsable')).toBeInTheDocument();
    expect(screen.getByText('Fondo Inicial de Caja')).toBeInTheDocument();
    expect(screen.getByText('$500.00 MXN')).toBeInTheDocument();
    expect(screen.getByText('Detalle de Ajustes / Mermas al Abrir')).toBeInTheDocument();
    expect(screen.getByText('Merma -1 uds')).toBeInTheDocument();
    expect(screen.getByText(/Merma detectada al abrir/)).toBeInTheDocument();

    // Back button allows going back to Step 2 to modify
    await userEvent.click(screen.getByRole('button', { name: '← Modificar' }));
    expect(screen.getByText('Stock Esperado')).toBeInTheDocument();

    // Proceed again to step 3
    await userEvent.click(screen.getByRole('button', { name: 'Continuar a Resumen →' }));

    // Confirm shift start
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar e Iniciar Turno' }));

    expect(confirmedData).not.toBeNull();
    expect((confirmedData as unknown as ShiftOpenConfirmData).openingCashMinor).toBe(50000);
    expect((confirmedData as unknown as ShiftOpenConfirmData).stockAdjustments).toEqual([
      {
        productId: 'demo-towel',
        kind: 'waste',
        quantity: 1,
        reason: 'Merma detectada al abrir',
      },
    ]);
  });

  it('closes dialog when cancel button is clicked', async () => {
    const handleClose = vi.fn();
    render(
      <ShiftOpenModal
        isOpen
        state={dummyState}
        onClose={handleClose}
        onConfirm={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(handleClose).toHaveBeenCalled();
  });

  it('allows counting by money amount with switch toggle', async () => {
    render(
      <ShiftOpenModal
        isOpen
        state={dummyState}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const toggle = screen.getByRole('switch', { name: 'Cambiar entre conteo por piezas o por importe en dinero' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    // In amount mode, input label reflects 'importe ($)'
    const bill500 = screen.getByLabelText('Billete $500.00 · importe ($)');
    await userEvent.type(bill500, '1500');

    // Subtotal reflects $1,500.00 MXN (3 bills of $500)
    expect(screen.getByText('$1,500.00 MXN')).toBeInTheDocument();
    expect(screen.getByText('3 billetes')).toBeInTheDocument();
  });
});
