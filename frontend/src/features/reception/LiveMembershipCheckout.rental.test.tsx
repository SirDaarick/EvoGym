import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveMembershipCheckout } from './LiveMembershipCheckout';

const api = vi.hoisted(() => ({
  plans: vi.fn(),
  registers: vi.fn(),
  shift: vi.fn(),
  openDebts: vi.fn(),
  getMember: vi.fn(),
  receivables: vi.fn(),
  repay: vi.fn(),
}));
vi.mock('../../api/membersApi', () => ({ getMember: api.getMember }));
vi.mock('../../api/memberCreditApi', () => ({ depositMemberCredit: vi.fn() }));
vi.mock('../../api/rentalsApi', () => ({ getMemberReceivables: api.receivables, recordRentalRepayment: api.repay }));
vi.mock('../../api/membershipCheckoutApi', () => ({
  getActiveMembershipPlans: api.plans,
  getRegisters: api.registers,
  getCurrentRegisterShift: api.shift,
  submitMembershipCashSale: vi.fn(),
  submitMembershipTransferSale: vi.fn(),
  listRegisterMemberOpenDebts: api.openDebts,
  submitMembershipDebtPayment: vi.fn(),
}));

const member = { id: 'member-live-uuid', name: 'Socio Real' };
const register = { id: 'register-live-id', branch_id: 'branch-live-1', name: 'Caja recepción', has_open_shift: true };
const shift = { id: 'shift-live-id', cash_register_id: register.id };
const rental = {
  payment_id: 'pay-1', rental_id: 'rental-1', charge_id: 'charge-1', asset_id: 'asset-1', asset_code: 'L-01',
  member_id: member.id, kind: 'locker', method: 'cash', status: 'confirmed',
  amount_minor: 30000, settled_minor: 5000, outstanding_minor: 25000, created_at: '2026-10-28T10:00:00Z',
};
const repayResult = (method: string, amount: number, remaining: number) => ({
  id: `rp-${method}`, rental_id: rental.rental_id, charge_id: rental.charge_id, method, status: 'confirmed',
  amount_minor: amount, remaining_minor: remaining, allocations: [],
});

const confirmCard = () => fireEvent.click(document.querySelector('.confirm-checkout-btn') as HTMLElement);

async function openRentalCheckout(creditMinor: number) {
  api.getMember.mockResolvedValue({ id: member.id, credit_balance_minor: creditMinor });
  render(<LiveMembershipCheckout member={member} initialOperation="debt_payment" onClose={vi.fn()} />);
  await waitFor(() => expect(api.receivables).toHaveBeenCalled());
  await screen.findByLabelText('Adeudo pendiente');
  await waitFor(() => expect(api.getMember).toHaveBeenCalled());
  await waitFor(() => expect(api.shift).toHaveBeenCalled());
  fireEvent.click(await screen.findByRole('button', { name: 'Revisar cobro' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.plans.mockResolvedValue([]);
  api.registers.mockResolvedValue([register]);
  api.shift.mockResolvedValue(shift);
  api.openDebts.mockResolvedValue([]);
  api.receivables.mockResolvedValue({ items: [rental], total_outstanding_minor: 25000 });
  api.getMember.mockResolvedValue({ id: member.id, credit_balance_minor: 0 });
});

describe('LiveMembershipCheckout rental debts', () => {
  it('lists a rental receivable when the member has no membership debts', async () => {
    render(<LiveMembershipCheckout member={member} initialOperation="debt_payment" onClose={vi.fn()} />);
    expect((await screen.findAllByText(/Renta de casillero L-01/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/No hay adeudos pendientes/)).not.toBeInTheDocument();
    expect(api.receivables.mock.calls[0].slice(1)).toEqual([member.id, register.branch_id]);
  });

  it('pays a rental fully from saldo a favor with a single credit call', async () => {
    api.repay.mockResolvedValueOnce(repayResult('credit', 25000, 0));
    await openRentalCheckout(90000);
    fireEvent.click(await screen.findByLabelText('Usar saldo a favor'));
    confirmCard();

    await waitFor(() => expect(api.repay).toHaveBeenCalledTimes(1));
    expect(api.repay.mock.calls[0][1]).toBe(rental.rental_id);
    expect(api.repay.mock.calls[0][2]).toEqual({ register_id: register.id, method: 'credit', amount_minor: 25000 });
    expect(await screen.findByText(/de los cuales \$250\.00 con saldo a favor/)).toBeInTheDocument();
  });

  it('sends the credit part first and the cash remainder second, with distinct idempotency keys', async () => {
    api.repay.mockResolvedValueOnce(repayResult('credit', 10000, 15000)).mockResolvedValueOnce(repayResult('cash', 15000, 0));
    await openRentalCheckout(10000);
    fireEvent.click(await screen.findByLabelText('Usar saldo a favor'));
    fireEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    confirmCard();

    await waitFor(() => expect(api.repay).toHaveBeenCalledTimes(2));
    expect(api.repay.mock.calls[0][2]).toEqual({ register_id: register.id, method: 'credit', amount_minor: 10000 });
    expect(api.repay.mock.calls[1][2]).toEqual({ register_id: register.id, method: 'cash', amount_minor: 15000 });
    expect(api.repay.mock.calls[0][3]).not.toBe(api.repay.mock.calls[1][3]);
    expect(await screen.findByText(/Adeudo liquidado en su totalidad/)).toBeInTheDocument();
  });

  it('says the credit part was applied when the cash call fails and retries only the cash part', async () => {
    api.repay
      .mockResolvedValueOnce(repayResult('credit', 10000, 15000))
      .mockRejectedValueOnce(new Error('caja cerrada'))
      .mockResolvedValueOnce(repayResult('cash', 15000, 0));
    await openRentalCheckout(10000);
    fireEvent.click(await screen.findByLabelText('Usar saldo a favor'));
    fireEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    confirmCard();

    expect((await screen.findAllByText(/sí se aplicó/)).length).toBeGreaterThan(0);
    confirmCard();

    await waitFor(() => expect(api.repay).toHaveBeenCalledTimes(3));
    expect(api.repay.mock.calls[2][2]).toEqual({ register_id: register.id, method: 'cash', amount_minor: 15000 });
    expect(api.repay.mock.calls.filter(call => call[2].method === 'credit')).toHaveLength(1);
    expect(api.repay.mock.calls[2][3]).toBe(api.repay.mock.calls[1][3]);
  });

  it('hides the saldo a favor tick when the balance is zero', async () => {
    await openRentalCheckout(0);
    await waitFor(() => expect(document.querySelector('.confirm-checkout-btn')).not.toBeNull());
    expect(screen.queryByLabelText('Usar saldo a favor')).not.toBeInTheDocument();
  });
});
