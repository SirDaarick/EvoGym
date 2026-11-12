import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CurrentPurchaseCard, type CurrentPurchaseCardProps } from './CurrentPurchaseCard';

const member = (creditMinor: number) => ({ id: 'member-1', name: 'Ana', creditMinor });

function renderStep2(props: Partial<CurrentPurchaseCardProps> = {}) {
  const onConfirmPayment = vi.fn();
  render(
    <CurrentPurchaseCard totalMinor={5000} step={2} onStepChange={vi.fn()} onConfirmPayment={onConfirmPayment} {...props}>
      <div />
    </CurrentPurchaseCard>,
  );
  return onConfirmPayment;
}

const confirm = () => fireEvent.click(document.querySelector('.confirm-checkout-btn') as HTMLElement);

describe('CurrentPurchaseCard saldo a favor', () => {
  it('hides the tick without balance, without member, or when credit is not allowed', () => {
    renderStep2({ allowCredit: true, assignedMember: member(0) });
    expect(screen.queryByLabelText('Usar saldo a favor')).not.toBeInTheDocument();
  });

  it('hides the tick without a member', () => {
    renderStep2({ allowCredit: true, assignedMember: null });
    expect(screen.queryByLabelText('Usar saldo a favor')).not.toBeInTheDocument();
  });

  it('hides the tick when allowCredit is false even if the member has balance', () => {
    renderStep2({ assignedMember: member(3000) });
    expect(screen.queryByLabelText('Usar saldo a favor')).not.toBeInTheDocument();
    expect(screen.queryByText(/Saldo a favor:/)).not.toBeInTheDocument();
  });

  it('shows the balance and lowers the amount to charge when ticked', () => {
    const onConfirm = renderStep2({ allowCredit: true, assignedMember: member(3000) });
    expect(screen.getByText(/Saldo a favor:/)).toHaveTextContent('Saldo a favor: $30.00');
    fireEvent.click(screen.getByLabelText('Usar saldo a favor'));
    expect(screen.getByText(/Por cobrar:/)).toHaveTextContent('Por cobrar: $20.00 MXN');
    expect(screen.getByLabelText('Total de compra')).toHaveTextContent('$50.00 MXN');

    fireEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    confirm();
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'cash', tenderedMinor: 2000, shortfallMinor: 0, creditAppliedMinor: 3000, changeToCreditMinor: 0 }),
      false,
    );
  });

  it('skips the payment methods and confirms when the credit covers the total', () => {
    const onConfirm = renderStep2({ allowCredit: true, assignedMember: member(10000) });
    fireEvent.click(screen.getByLabelText('Usar saldo a favor'));
    expect(screen.queryByRole('radiogroup', { name: 'Método de cobro' })).not.toBeInTheDocument();
    expect(screen.getByText(/saldo a favor cubre el total/i)).toBeInTheDocument();
    confirm();
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'single', method: 'cash', tenderedMinor: 0, shortfallMinor: 0, creditAppliedMinor: 5000 }),
      false,
    );
  });

  it('offers to leave the excess as saldo a favor only with an assigned member', () => {
    const onConfirm = renderStep2({ allowCredit: true, assignedMember: member(0) });
    fireEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    fireEvent.change(screen.getByLabelText('Monto recibido'), { target: { value: '80' } });
    fireEvent.click(screen.getByLabelText('Dejar $30.00 como saldo a favor'));
    confirm();
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ tenderedMinor: 8000, creditAppliedMinor: 0, changeToCreditMinor: 3000 }),
      false,
    );
  });

  it('gives change by default and offers no credit choice without a member', () => {
    const withChange = renderStep2({ allowCredit: true, assignedMember: member(0) });
    fireEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    fireEvent.change(screen.getByLabelText('Monto recibido'), { target: { value: '80' } });
    confirm();
    expect(withChange).toHaveBeenCalledWith(expect.objectContaining({ changeToCreditMinor: 0 }), false);
  });

  it('does not offer the credit choice without an assigned member', () => {
    renderStep2({ allowCredit: true, assignedMember: null });
    fireEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    fireEvent.change(screen.getByLabelText('Monto recibido'), { target: { value: '80' } });
    expect(screen.queryByLabelText(/como saldo a favor/)).not.toBeInTheDocument();
  });

  it('prevents mixed payment selection and hides mixed hints when allowMixed is false', () => {
    const onConfirm = renderStep2({ allowMixed: false, disabledMethods: ['transfer'], useLiveCardIntent: true });
    expect(screen.getByRole('radio', { name: 'Transferencia' })).toBeDisabled();
    expect(screen.queryByText(/Mantén presionado/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Tarjeta' }), { ctrlKey: true });
    expect(screen.queryByLabelText(/Parte 1/)).not.toBeInTheDocument();
    confirm();
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ mode: 'single', method: 'card' }), false);
  });
});
