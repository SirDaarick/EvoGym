import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PointPaymentModal } from './PointPaymentModal';

describe('PointPaymentModal', () => {
  it('renders sending state with terminal name, amount and cancel button', () => {
    const handleCancel = vi.fn();
    render(
      <PointPaymentModal
        isOpen={true}
        totalMinor={5000}
        terminalName="Terminal Mostrador 01"
        onCancel={handleCancel}
        onConfirm={vi.fn()}
        autoSimulateDelayMs={null}
      />
    );

    expect(screen.getByText(/Enviando cobro de \$50.00 a la terminal Point.../)).toBeInTheDocument();
    expect(screen.getByText('Terminal Mostrador 01')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar cobro en terminal' })).toBeInTheDocument();
  });

  it('allows canceling payment on terminal', async () => {
    const user = userEvent.setup();
    const handleCancel = vi.fn();
    render(
      <PointPaymentModal
        isOpen={true}
        totalMinor={5000}
        onCancel={handleCancel}
        onConfirm={vi.fn()}
        autoSimulateDelayMs={null}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Cancelar cobro en terminal' }));
    expect(handleCancel).toHaveBeenCalled();
  });

  it('completes payment simulation and displays voucher details', async () => {
    const user = userEvent.setup();
    const handleConfirm = vi.fn();
    render(
      <PointPaymentModal
        isOpen={true}
        totalMinor={5000}
        terminalName="Terminal Mostrador 01"
        onCancel={vi.fn()}
        onConfirm={handleConfirm}
        autoSimulateDelayMs={null}
      />
    );

    // Click manual approve simulation
    await user.click(screen.getByRole('button', { name: /Simulación/ }));

    // Verify voucher
    expect(screen.getByText('¡Cobro Aprobado en Terminal!')).toBeInTheDocument();
    expect(screen.getByText(/VISA \(.*4242\)/)).toBeInTheDocument();
    expect(screen.getByText(/AUTH-/)).toBeInTheDocument();

    // Finalize
    await user.click(screen.getByRole('button', { name: 'Finalizar compra con Voucher' }));
    expect(handleConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        cardBrand: 'VISA',
        lastFourDigits: '4242',
        terminalName: 'Terminal Mostrador 01',
      })
    );
  });
});
