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

    expect(screen.getByText(/Esperando tarjeta en la terminal Point.../)).toBeInTheDocument();
    expect(screen.getByText('Terminal Mostrador 01')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar cobro en terminal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pasar tarjeta/ })).toBeInTheDocument();
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

  it('completes payment simulation and displays voucher details on approval', async () => {
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

    // Click quick sufficient balance button
    await user.click(screen.getByRole('button', { name: /Saldo suficiente/ }));

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

  it('rejects card payment when simulated balance is less than total', async () => {
    const user = userEvent.setup();
    const handleReject = vi.fn();
    const handleCancel = vi.fn();
    render(
      <PointPaymentModal
        isOpen={true}
        totalMinor={5000} // $50.00 MXN
        onCancel={handleCancel}
        onConfirm={vi.fn()}
        onReject={handleReject}
        autoSimulateDelayMs={null}
      />
    );

    // Enter balance of $20.00 (less than $50.00)
    const balanceInput = screen.getByLabelText('Saldo disponible en la tarjeta');
    await user.clear(balanceInput);
    await user.type(balanceInput, '20');

    // Click "Pasar tarjeta"
    await user.click(screen.getByRole('button', { name: /Pasar tarjeta/ }));

    // Verify rejection screen
    expect(screen.getByText('Cobro Rechazado: Fondos Insuficientes')).toBeInTheDocument();
    expect(screen.getByText(/La tarjeta cuenta con \$20\.00 MXN y se requieren \$50\.00 MXN/)).toBeInTheDocument();

    // Notify rejection and exit
    await user.click(screen.getByRole('button', { name: 'Salir y cambiar método de cobro' }));
    expect(handleReject).toHaveBeenCalledWith('Fondos insuficientes en la tarjeta');
    expect(handleCancel).toHaveBeenCalled();
  });

  it('handles card declined simulation and retrying with another card', async () => {
    const user = userEvent.setup();
    render(
      <PointPaymentModal
        isOpen={true}
        totalMinor={5000}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        autoSimulateDelayMs={null}
      />
    );

    // Click quick chip/declined button
    await user.click(screen.getByRole('button', { name: /Chip dañado \/ Declinada/ }));

    expect(screen.getByText('Cobro Rechazado: Tarjeta Declinada')).toBeInTheDocument();

    // Click retry with another card
    await user.click(screen.getByRole('button', { name: '🔄 Probar con otra tarjeta' }));

    // Back to sending screen
    expect(screen.getByText(/Esperando tarjeta en la terminal Point.../)).toBeInTheDocument();
  });
});
