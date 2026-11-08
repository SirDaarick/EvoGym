import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as creditApi from '../../api/memberCreditApi';
import * as checkoutApi from '../../api/membershipCheckoutApi';
import { MemberCreditPanel } from './MemberCreditPanel';

const request = vi.fn();

function movement(id: string, kind: 'deposit' | 'apply', amount: number, after: number): creditApi.MemberCreditMovement {
  return { id, member_id: 'm1', branch_id: 'b1', register_id: 'r1', shift_id: 's1', kind, amount_minor: amount, balance_after_minor: after,
    order_id: null, debt_id: null, rental_charge_id: null, received_by: 'u1', created_at: '2026-11-01T18:00:00Z' };
}

function renderPanel(props: Partial<React.ComponentProps<typeof MemberCreditPanel>> = {}) {
  const onRefresh = vi.fn();
  render(<MemberCreditPanel memberId="m1" memberName="Ana" creditMinor={15050} pendingMinor={20000} hasPendingBalance apiRequest={request} onRefresh={onRefresh} {...props} />);
  return onRefresh;
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  vi.spyOn(creditApi, 'listMemberCreditMovements').mockResolvedValue({ total_items: 0, items: [] });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('member credit panel', () => {
  it('shows debt amount and saldo a favor to admins', async () => {
    renderPanel();
    expect(screen.getByText('Deuda pendiente').nextElementSibling).toHaveTextContent('$200.00');
    expect(screen.getByText('Saldo a favor').nextElementSibling).toHaveTextContent('$150.50');
    expect(await screen.findByText('Sin movimientos de saldo')).toBeVisible();
  });

  it('hides the debt amount from receptionists but keeps saldo a favor', async () => {
    renderPanel({ pendingMinor: null });
    expect(screen.getByText('Deuda pendiente').nextElementSibling).toHaveTextContent('Con saldo pendiente');
    expect(screen.queryByText(/\$200\.00/)).not.toBeInTheDocument();
    expect(screen.getByText('Saldo a favor').nextElementSibling).toHaveTextContent('$150.50');
    await screen.findByText('Sin movimientos de saldo');
  });

  it('says there is no pending balance when none exists', async () => {
    renderPanel({ pendingMinor: null, hasPendingBalance: false });
    expect(screen.getByText('Deuda pendiente').nextElementSibling).toHaveTextContent('Sin saldo pendiente');
    await screen.findByText('Sin movimientos de saldo');
  });

  it('deposits to the only open register, keeps the key on retry and refreshes after success', async () => {
    vi.spyOn(checkoutApi, 'getRegisters').mockResolvedValue([
      { id: 'r-closed', has_open_shift: false, name: 'Cerrada' }, { id: 'r1', has_open_shift: true, name: 'Recepción' },
    ]);
    const deposit = vi.spyOn(creditApi, 'depositMemberCredit')
      .mockRejectedValueOnce(new Error('No se pudo conectar con el servidor.'))
      .mockResolvedValueOnce(movement('mv1', 'deposit', 10010, 25060));
    const onRefresh = renderPanel();
    await screen.findByText('Sin movimientos de saldo');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar saldo a favor' }));
    const dialog = await screen.findByRole('dialog', { name: 'Agregar saldo a favor' });
    await waitFor(() => expect(within(dialog).getByLabelText('Caja')).toHaveValue('r1'));
    expect(within(dialog).queryByRole('option', { name: 'Cerrada' })).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Monto en pesos'), '100.10');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar saldo' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('No se pudo conectar con el servidor.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar saldo' }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(deposit).toHaveBeenNthCalledWith(1, request, 'r1', { member_id: 'm1', amount_minor: 10010 }, expect.any(String));
    expect(deposit.mock.calls[1][3]).toBe(deposit.mock.calls[0][3]);
    expect(creditApi.listMemberCreditMovements).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog', { name: 'Agregar saldo a favor' })).not.toBeInTheDocument();
  });

  it('rejects more than two decimals and explains when no register has an open shift', async () => {
    vi.spyOn(checkoutApi, 'getRegisters').mockResolvedValue([{ id: 'r1', has_open_shift: false }]);
    const deposit = vi.spyOn(creditApi, 'depositMemberCredit');
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Agregar saldo a favor' }));
    const dialog = await screen.findByRole('dialog', { name: 'Agregar saldo a favor' });
    expect(await within(dialog).findByText(/No hay una caja con turno abierto/)).toBeVisible();
    await userEvent.type(within(dialog).getByLabelText('Monto en pesos'), '1.234');
    expect(within(dialog).getByText(/máximo 2 decimales/)).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Agregar saldo' })).toBeDisabled();
    expect(deposit).not.toHaveBeenCalled();
  });

  it('lists movements and loads more using total_items', async () => {
    const list = vi.spyOn(creditApi, 'listMemberCreditMovements')
      .mockResolvedValueOnce({ total_items: 2, items: [movement('a', 'deposit', 5000, 5000)] })
      .mockResolvedValueOnce({ total_items: 2, items: [movement('b', 'apply', 2000, 3000)] });
    renderPanel();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Depósito')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(await within(table).findByText('Aplicado en compra/abono')).toBeVisible();
    expect(list).toHaveBeenLastCalledWith(request, 'm1', 1, 20);
    expect(within(table).getByText(/\$30\.00/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument();
  });
});
