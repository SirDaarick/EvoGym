import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveMembershipCheckout } from './LiveMembershipCheckout';

const api = vi.hoisted(() => ({
  plans: vi.fn(),
  registers: vi.fn(),
  shift: vi.fn(),
  cash: vi.fn(),
  transfer: vi.fn(),
  openDebts: vi.fn(),
  debtPayment: vi.fn(),
}));
vi.mock('../../api/membershipCheckoutApi', () => ({
  getActiveMembershipPlans: api.plans,
  getRegisters: api.registers,
  getCurrentRegisterShift: api.shift,
  submitMembershipCashSale: api.cash,
  submitMembershipTransferSale: api.transfer,
  listRegisterMemberOpenDebts: api.openDebts,
  submitMembershipDebtPayment: api.debtPayment,
}));

const member = { id: 'member-live-uuid', name: 'Socio Real' };
const plan = { id: 'plan-live-id', name: 'Mensual', current_version: { id: 'version-live-id', name: 'Mensual v2', price_minor: 50000 }, versions: [] };
const register = { id: 'register-live-id', name: 'Caja recepción', has_open_shift: true };
const shift = { id: 'shift-live-id', cash_register_id: register.id };
const sampleDebt = {
  debt_id: 'debt-live-1',
  order_id: 'order-debt-live-1',
  member_id: member.id,
  branch_id: 'branch-live-1',
  currency: 'MXN',
  description_snapshot: 'Mensual v2',
  initial_outstanding_minor: 30000,
  paid_amount_minor: 5000,
  remaining_balance_minor: 25000,
  created_at: '2026-10-28T10:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  api.plans.mockResolvedValue([plan]);
  api.registers.mockResolvedValue([register]);
  api.shift.mockResolvedValue(shift);
  api.cash.mockResolvedValue({ order: { id: 'order-1' }, item: {}, payment: { status: 'confirmed' }, membership: null });
  api.transfer.mockResolvedValue({ order: { id: 'order-2' }, item: {}, payment: { status: 'under_review' }, membership: null });
  api.openDebts.mockResolvedValue([sampleDebt]);
  api.debtPayment.mockResolvedValue({
    id: 'receipt-live-1',
    debt_id: sampleDebt.debt_id,
    order_id: sampleDebt.order_id,
    member_id: member.id,
    branch_id: sampleDebt.branch_id,
    register_id: register.id,
    shift_id: shift.id,
    amount_minor: 10000,
    remaining_balance_minor: 15000,
    received_by: 'staff-1',
    received_at: '2026-10-28T11:00:00Z',
  });
});

describe('LiveMembershipCheckout', () => {
  it('submits cash against live identifiers and does not claim membership activation when period is null', async () => {
    render(<LiveMembershipCheckout member={member} onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Plan de membresía'), { target: { value: plan.id } });
    fireEvent.change(screen.getByLabelText('Caja abierta'), { target: { value: register.id } });
    await waitFor(() => expect(api.shift).toHaveBeenCalledWith(register.id));
    fireEvent.click(screen.getByRole('button', { name: 'Cobrar en efectivo' }));

    await waitFor(() => expect(api.cash).toHaveBeenCalledTimes(1));
    const [, request, key] = api.cash.mock.calls[0];
    expect(request).toEqual({ member_id: member.id, plan_version_id: 'version-live-id' });
    expect(typeof key).toBe('string');
    expect(screen.getByText(/Pago confirmado/)).toBeInTheDocument();
    expect(screen.getByText(/Sin periodo de membresía devuelto/)).toBeInTheDocument();
    expect(screen.queryByText(/Membresía activada/i)).not.toBeInTheDocument();
  });

  it('keeps the exact transfer request and idempotency key for retry after an unknown outcome', async () => {
    api.transfer.mockRejectedValueOnce(Object.assign(new Error('network unavailable'), { kind: 'network' }));
    render(<LiveMembershipCheckout member={member} onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Plan de membresía'), { target: { value: plan.id } });
    fireEvent.change(screen.getByLabelText('Caja abierta'), { target: { value: register.id } });
    await waitFor(() => expect(api.shift).toHaveBeenCalledWith(register.id));
    fireEvent.click(screen.getByRole('button', { name: 'Transferencia bancaria' }));
    await screen.findByRole('alert');
    expect(api.transfer).toHaveBeenCalledTimes(1);
    const originalCall = api.transfer.mock.calls[0];
    expect(originalCall[1]).toEqual({ member_id: member.id, plan_version_id: 'version-live-id' });

    api.transfer.mockResolvedValueOnce({ order: { id: 'order-2' }, item: {}, payment: { status: 'under_review' }, membership: null });
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar la misma solicitud' }));
    await waitFor(() => expect(api.transfer).toHaveBeenCalledTimes(2));
    expect(api.transfer.mock.calls[1]).toEqual(originalCall);
    expect(screen.getByText(/Transferencia pendiente de revisión/)).toBeInTheDocument();
    expect(screen.getByText(/Sin periodo de membresía devuelto/)).toBeInTheDocument();
  });

  it('warns when cash paid is below the published plan price', async () => {
    render(<LiveMembershipCheckout member={member} onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Plan de membresía'), { target: { value: plan.id } });
    fireEvent.change(screen.getByLabelText('Efectivo recibido en MXN (opcional; vacío cobra el precio completo)'), { target: { value: '200' } });
    expect(screen.getByText(/El monto en efectivo es menor al precio publicado/)).toBeInTheDocument();
  });

  it('blocks a cash amount above the published price', async () => {
    render(<LiveMembershipCheckout member={member} onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Plan de membresía'), { target: { value: plan.id } });
    fireEvent.change(screen.getByLabelText('Efectivo recibido en MXN (opcional; vacío cobra el precio completo)'), { target: { value: '501' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/no superar el precio publicado/);
    expect(screen.getByRole('button', { name: 'Cobrar en efectivo' })).toBeDisabled();
    expect(api.cash).not.toHaveBeenCalled();
  });

  it.each(['different-register', null])('does not enable sale without a matching current shift (%s)', async (cashRegisterId) => {
    if (cashRegisterId === null) api.shift.mockRejectedValueOnce(new Error('No current shift'));
    else api.shift.mockResolvedValueOnce({ id: 'other-shift', cash_register_id: cashRegisterId });
    render(<LiveMembershipCheckout member={member} onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Plan de membresía'), { target: { value: plan.id } });
    fireEvent.change(screen.getByLabelText('Caja abierta'), { target: { value: register.id } });
    await waitFor(() => expect(api.shift).toHaveBeenCalledWith(register.id));
    await waitFor(() => expect(screen.queryByText('Consultando turno…')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Cobrar en efectivo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Transferencia bancaria' })).toBeDisabled();
    expect(api.cash).not.toHaveBeenCalled();
    expect(api.transfer).not.toHaveBeenCalled();
  });

  it('does not fall back to a historical version for an unpublished plan', async () => {
    api.plans.mockResolvedValueOnce([{ ...plan, current_version: null, versions: [plan.current_version] }]);
    render(<LiveMembershipCheckout member={member} onClose={vi.fn()} />);
    await screen.findByLabelText('Plan de membresía');
    expect(screen.queryByRole('option', { name: 'Mensual' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cobrar en efectivo' })).toBeDisabled();
  });

  it('keeps a published free single-entry plan selectable without a period duration', async () => {
    api.plans.mockResolvedValueOnce([{
      ...plan,
      current_version: { ...plan.current_version, price_minor: 0, entitlement_mode: 'single_entry', duration_value: null, duration_unit: null },
    }]);
    render(<LiveMembershipCheckout member={member} onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Plan de membresía'), { target: { value: plan.id } });
    fireEvent.change(screen.getByLabelText('Caja abierta'), { target: { value: register.id } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cobrar en efectivo' })).toBeEnabled());
    expect(screen.getByText('Precio publicado: $0.00')).toBeInTheDocument();
  });

  it('passes apiRequest through to catalog, registers, shift and cash sale', async () => {
    const mockApiRequest = vi.fn();
    render(<LiveMembershipCheckout member={member} onClose={vi.fn()} apiRequest={mockApiRequest} />);
    expect(api.plans).toHaveBeenCalledWith(mockApiRequest);
    expect(api.registers).toHaveBeenCalledWith(mockApiRequest);
    fireEvent.change(await screen.findByLabelText('Plan de membresía'), { target: { value: plan.id } });
    fireEvent.change(screen.getByLabelText('Caja abierta'), { target: { value: register.id } });
    await waitFor(() => expect(api.shift).toHaveBeenCalledWith(register.id, mockApiRequest));
    fireEvent.click(screen.getByRole('button', { name: 'Cobrar en efectivo' }));
    await waitFor(() => expect(api.cash).toHaveBeenCalledTimes(1));
    expect(api.cash).toHaveBeenCalledWith(register.id, expect.any(Object), expect.any(String), mockApiRequest);
  });

  it('locks inputs on cash sale network drop and retries with exact same idempotency key and body', async () => {
    api.cash.mockRejectedValueOnce(Object.assign(new Error('network unavailable'), { kind: 'network' }));
    render(<LiveMembershipCheckout member={member} onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Plan de membresía'), { target: { value: plan.id } });
    fireEvent.change(screen.getByLabelText('Caja abierta'), { target: { value: register.id } });
    await waitFor(() => expect(api.shift).toHaveBeenCalledWith(register.id));
    fireEvent.click(screen.getByRole('button', { name: 'Cobrar en efectivo' }));

    await screen.findByRole('alert');
    expect(screen.getByRole('combobox', { name: 'Plan de membresía' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Caja abierta' })).toBeDisabled();
    const retryButton = screen.getByRole('button', { name: 'Reintentar la misma solicitud' });
    expect(retryButton).toBeInTheDocument();

    const originalCall = api.cash.mock.calls[0];
    api.cash.mockResolvedValueOnce({
      order: { id: 'order-1' },
      item: {},
      payment: { status: 'confirmed' },
      membership: { starts_on: '2026-10-28', ends_on: '2026-11-28' },
    });
    fireEvent.click(retryButton);
    await waitFor(() => expect(api.cash).toHaveBeenCalledTimes(2));
    expect(api.cash.mock.calls[1]).toEqual(originalCall);
    expect(await screen.findByText(/Pago confirmado/)).toBeInTheDocument();
    expect(screen.getByText(/Membresía activada por el backend: 2026-10-28 a 2026-11-28/)).toBeInTheDocument();
  });

  it('displays sample entitlement confirmation instead of missing membership period notice', async () => {
    api.cash.mockResolvedValueOnce({
      order: { id: 'order-sample' },
      item: { entitlement_mode: 'single_entry' },
      payment: { status: 'confirmed' },
      membership: null,
      sample_entitlement: { id: 'sample-ent-1', member_id: member.id },
    });
    render(<LiveMembershipCheckout member={member} onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Plan de membresía'), { target: { value: plan.id } });
    fireEvent.change(screen.getByLabelText('Caja abierta'), { target: { value: register.id } });
    await waitFor(() => expect(api.shift).toHaveBeenCalledWith(register.id));
    fireEvent.click(screen.getByRole('button', { name: 'Cobrar en efectivo' }));

    expect(await screen.findByText(/Pago confirmado/)).toBeInTheDocument();
    expect(screen.getByText(/Acceso de clase de muestra activado por el backend/i)).toBeInTheDocument();
    expect(screen.queryByText(/Sin periodo de membresía devuelto/)).not.toBeInTheDocument();
  });

  it('F06-F02: loads open branch debts in debt_payment mode, enforces open shift gate, submits centavos with stable Idempotency-Key, renders receipt, and calls onSaleCompleted', async () => {
    const onSaleCompleted = vi.fn();
    const { unmount } = render(
      <LiveMembershipCheckout
        member={member}
        initialOperation="debt_payment"
        onClose={vi.fn()}
        onSaleCompleted={onSaleCompleted}
      />,
    );

    const debtSelect = await screen.findByLabelText('Adeudo pendiente');
    expect(debtSelect).toHaveValue(sampleDebt.order_id);
    expect(api.openDebts).toHaveBeenCalledWith(register.id, member.id);

    const amountInput = screen.getByLabelText('Monto a abonar (MXN)') as HTMLInputElement;
    expect(amountInput.value).toBe('250.00');

    fireEvent.change(amountInput, { target: { value: '100.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar abono en efectivo' }));

    await waitFor(() => expect(api.debtPayment).toHaveBeenCalledTimes(1));
    const [calledRegisterId, payload, idempKey] = api.debtPayment.mock.calls[0];
    expect(calledRegisterId).toBe(register.id);
    expect(payload).toEqual({ order_id: sampleDebt.order_id, amount_minor: 10000 });
    expect(typeof idempKey).toBe('string');
    expect(idempKey.length).toBeGreaterThan(0);

    expect(await screen.findByRole('heading', { name: 'Abono registrado' })).toBeInTheDocument();
    expect(screen.getByText(/Abono en efectivo confirmado por \$100\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Saldo restante del pedido: \$150\.00 MXN/)).toBeInTheDocument();
    expect(onSaleCompleted).toHaveBeenCalledTimes(1);
    unmount();

    // Also verify shift gate disables debt repayment when register has no open shift
    api.shift.mockRejectedValueOnce(new Error('No current shift'));
    render(
      <LiveMembershipCheckout
        member={member}
        initialOperation="debt_payment"
        onClose={vi.fn()}
      />,
    );
    await screen.findByLabelText('Adeudo pendiente');
    await waitFor(() => expect(screen.queryByText('Consultando turno…')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Registrar abono en efectivo' })).toBeDisabled();
  });

  it('F06-F03: blocks zero or overpayment amounts client-side, surfaces backend 409 error, and rotates Idempotency-Key when amount changes', async () => {
    render(
      <LiveMembershipCheckout
        member={member}
        initialOperation="debt_payment"
        onClose={vi.fn()}
      />,
    );

    await screen.findByLabelText('Adeudo pendiente');
    const amountInput = screen.getByLabelText('Monto a abonar (MXN)');
    const submitBtn = screen.getByRole('button', { name: 'Registrar abono en efectivo' });

    // 1. Zero amount blocked
    fireEvent.change(amountInput, { target: { value: '0' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/mayor a cero y no superar el saldo pendiente/);
    expect(submitBtn).toBeDisabled();

    // 2. Overpayment (> 250.00) blocked
    fireEvent.change(amountInput, { target: { value: '250.01' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/mayor a cero y no superar el saldo pendiente/);
    expect(submitBtn).toBeDisabled();
    expect(api.debtPayment).not.toHaveBeenCalled();

    // 3. Valid amount (150.00) hits backend 409 conflict
    api.debtPayment.mockRejectedValueOnce(new Error('La solicitud entra en conflicto con el estado actual.'));
    fireEvent.change(amountInput, { target: { value: '150.00' } });
    expect(submitBtn).toBeEnabled();
    fireEvent.click(submitBtn);

    expect(await screen.findByRole('alert')).toHaveTextContent('La solicitud entra en conflicto con el estado actual.');
    expect(api.debtPayment).toHaveBeenCalledTimes(1);
    const firstKey = api.debtPayment.mock.calls[0][2];

    // 4. Changing amount to 250.00 and retrying rotates Idempotency-Key and succeeds
    fireEvent.change(amountInput, { target: { value: '250.00' } });
    fireEvent.click(submitBtn);
    await waitFor(() => expect(api.debtPayment).toHaveBeenCalledTimes(2));
    const secondKey = api.debtPayment.mock.calls[1][2];
    expect(secondKey).not.toBe(firstKey);
    expect(api.debtPayment.mock.calls[1][1]).toEqual({ order_id: sampleDebt.order_id, amount_minor: 25000 });
  });

  it('disables "Liquidar adeudo" button in modal header when selected member has no open debts', async () => {
    api.openDebts.mockResolvedValueOnce([]);
    render(
      <LiveMembershipCheckout
        member={member}
        initialOperation="sale"
        onClose={vi.fn()}
      />,
    );

    const debtButton = screen.getByRole('button', { name: 'Liquidar adeudo' });
    await waitFor(() => expect(debtButton).toBeDisabled());
  });
});
