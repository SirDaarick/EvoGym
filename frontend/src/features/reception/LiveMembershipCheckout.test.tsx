import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveMembershipCheckout } from './LiveMembershipCheckout';

const api = vi.hoisted(() => ({
  plans: vi.fn(), registers: vi.fn(), shift: vi.fn(), cash: vi.fn(), transfer: vi.fn(),
}));
vi.mock('../../api/membershipCheckoutApi', () => ({
  getActiveMembershipPlans: api.plans,
  getRegisters: api.registers,
  getCurrentRegisterShift: api.shift,
  submitMembershipCashSale: api.cash,
  submitMembershipTransferSale: api.transfer,
}));

const member = { id: 'member-live-uuid', name: 'Socio Real' };
const plan = { id: 'plan-live-id', name: 'Mensual', current_version: { id: 'version-live-id', name: 'Mensual v2', price_minor: 50000 }, versions: [] };
const register = { id: 'register-live-id', name: 'Caja recepción', has_open_shift: true };
const shift = { id: 'shift-live-id', cash_register_id: register.id };

beforeEach(() => {
  vi.clearAllMocks();
  api.plans.mockResolvedValue([plan]);
  api.registers.mockResolvedValue([register]);
  api.shift.mockResolvedValue(shift);
  api.cash.mockResolvedValue({ order: { id: 'order-1' }, item: {}, payment: { status: 'confirmed' }, membership: null });
  api.transfer.mockResolvedValue({ order: { id: 'order-2' }, item: {}, payment: { status: 'under_review' }, membership: null });
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
});
