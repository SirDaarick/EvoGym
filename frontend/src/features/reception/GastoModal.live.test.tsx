import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { GastoModal } from './GastoModal';
vi.mock('../../shared/compressToWebp', () => ({ compressToWebp: async () => new Blob(['image'], { type: 'image/webp' }) }));

it('records a categorized expense on the current register', async () => {
  let recorded = false;
  const request = vi.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method === 'POST') { recorded = true; return new Response('{}', { status: 201 }); }
    return new Response(JSON.stringify({ items: recorded ? [{ id: '1', branch_id: 'b', shift_id: 's', category: 'limpieza', concept: 'Soap', payee_name: 'Shop', amount_minor: 15000, payment_method: 'cash', recorded_by_name: 'Cashier', recorded_at: '2026-10-30T12:00:00Z', voucher_reference: 'T-1', evidence_url: null, voided_at: null, voided_by_name: null, void_reason: null }] : [], total_minor: recorded ? 15000 : 0 }));
  });
  render(<GastoModal isOpen onClose={() => {}} apiRequest={request} registerId="r" branchId="b" />);
  await userEvent.type(screen.getByLabelText('Concepto *'), 'Soap');
  await userEvent.type(screen.getByLabelText('Nombre *'), 'Shop');
  await userEvent.type(screen.getByLabelText('Saldo / Monto *'), '150');
  await userEvent.selectOptions(screen.getByLabelText('Categoría *'), 'limpieza');
  await userEvent.type(screen.getByLabelText('Folio o ticket'), 'T-1');
  await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));
  expect(await screen.findByText('Soap')).toBeInTheDocument();
  const post = request.mock.calls.find(([, init]) => init?.method === 'POST');
  expect(post?.[0]).toBe('/api/v1/registers/r/expenses');
  expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ category: 'limpieza', concept: 'Soap', payee_name: 'Shop', amount_minor: 15000, voucher_reference: 'T-1' });
});

it('requires a reason to void an expense and removes it from the active total', async () => {
  let voided = false;
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/void') && init?.method === 'POST') { voided = true; return new Response('{}'); }
    return new Response(JSON.stringify({ items: [{ id: '1', branch_id: 'b', shift_id: 's', category: 'limpieza', concept: 'Soap', payee_name: 'Shop', amount_minor: 15000, payment_method: 'cash', recorded_by_name: 'Cashier', recorded_at: '2026-10-30T12:00:00Z', voucher_reference: 'T-1', evidence_url: null, voided_at: voided ? '2026-10-30T13:00:00Z' : null, voided_by_name: null, void_reason: voided ? 'Duplicate' : null }], total_minor: voided ? 0 : 15000 }));
  });
  render(<GastoModal isOpen onClose={() => {}} apiRequest={request} registerId="r" branchId="b" />);
  await userEvent.click(await screen.findByRole('button', { name: 'Anular' }));
  await userEvent.type(screen.getByLabelText('Motivo *'), 'Duplicate');
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar anulación' }));
  expect(await screen.findByText('Anulado')).toBeInTheDocument();
  expect(screen.getByText('$0.00 MXN')).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('/api/v1/expenses/1/void', expect.objectContaining({ method: 'POST', body: JSON.stringify({ reason: 'Duplicate' }) }));
});

it('records an expense paid by transfer outside a shift', async () => {
  const request = vi.fn(async (_path: string, _init?: RequestInit) => new Response('{}', { status: 201 }));
  const onSaved = vi.fn();
  render(<GastoModal isOpen onClose={() => {}} apiRequest={request} mode="business" branches={[{ id: 'b', name: 'Central' }]} onSaved={onSaved} />);
  await userEvent.type(screen.getByLabelText('Concepto *'), 'Repair');
  await userEvent.type(screen.getByLabelText('Nombre *'), 'Shop');
  await userEvent.type(screen.getByLabelText('Saldo / Monto *'), '2500');
  await userEvent.selectOptions(screen.getByLabelText('Categoría *'), 'mantenimiento_cardio');
  await userEvent.selectOptions(screen.getByLabelText('Sucursal *'), 'b');
  await userEvent.selectOptions(screen.getByLabelText('Método de pago *'), 'transfer');
  await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));
  await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  const call = request.mock.calls.find(([path]) => path === '/api/v1/admin/expenses');
  expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ branch_id: 'b', payment_method: 'transfer', amount_minor: 250000, category: 'mantenimiento_cardio' });
});

it('does not submit changed expense details while a previous outcome is uncertain', async () => {
  const posts: RequestInit[] = [];
  const request = vi.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method === 'POST') { posts.push(init); if (posts.length === 1) throw new Error('network'); return new Response('{}', { status: 201 }); }
    return new Response(JSON.stringify({ items: [], total_minor: 0 }));
  });
  render(<GastoModal isOpen onClose={() => {}} apiRequest={request} registerId="r" branchId="b" />);
  await userEvent.type(screen.getByLabelText('Concepto *'), 'Soap');
  await userEvent.type(screen.getByLabelText('Nombre *'), 'Shop');
  await userEvent.type(screen.getByLabelText('Saldo / Monto *'), '150');
  await userEvent.selectOptions(screen.getByLabelText('Categoría *'), 'general');
  await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));
  await screen.findByText('network');
  await userEvent.type(screen.getByLabelText('Concepto *'), ' changed');
  await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));
  expect(posts).toHaveLength(1);
  await userEvent.clear(screen.getByLabelText('Concepto *'));
  await userEvent.type(screen.getByLabelText('Concepto *'), 'Soap');
  await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));
  await vi.waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[1].body).toBe(posts[0].body);
  expect(posts[1].headers).toEqual(posts[0].headers);
});

it('continues without the photo when evidence storage is unavailable', async () => {
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/evidence-uploads')) return new Response('{}', { status: 501 });
    if (init?.method === 'POST') return new Response('{}', { status: 201 });
    return new Response(JSON.stringify({ items: [], total_minor: 0 }));
  });
  render(<GastoModal isOpen onClose={() => {}} apiRequest={request} registerId="r" branchId="b" />);
  await userEvent.type(screen.getByLabelText('Concepto *'), 'Soap');
  await userEvent.type(screen.getByLabelText('Nombre *'), 'Shop');
  await userEvent.type(screen.getByLabelText('Saldo / Monto *'), '150');
  await userEvent.selectOptions(screen.getByLabelText('Categoría *'), 'limpieza');
  await userEvent.upload(screen.getByLabelText('Foto del ticket'), new File(['photo'], 'ticket.png', { type: 'image/png' }));
  await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));
  expect(await screen.findByText('Foto no disponible; se guarda sin foto')).toBeInTheDocument();
  const create = request.mock.calls.find(([path, init]) => path === '/api/v1/registers/r/expenses' && init?.method === 'POST');
  expect(JSON.parse(String(create?.[1]?.body))).not.toHaveProperty('evidence_key');
});

it('shows inline field errors (not a toast) and skips the API when the form is invalid', async () => {
  const request = vi.fn(async () => new Response(JSON.stringify({ items: [], total_minor: 0 })));
  render(<GastoModal isOpen onClose={() => {}} apiRequest={request} registerId="r" branchId="b" />);
  await screen.findByText('No hay gastos registrados en el turno activo.');
  const callsBefore = request.mock.calls.length;
  await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));
  const amount = screen.getByLabelText('Saldo / Monto *');
  expect(amount).toHaveAttribute('aria-invalid', 'true');
  expect(amount).toHaveAccessibleDescription('Ingresa un monto numérico válido mayor a $0.00.');
  expect(screen.getByLabelText('Concepto *')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Concepto *')).toHaveFocus();
  expect(screen.getByLabelText('Categoría *')).toHaveAttribute('aria-invalid', 'true');
  expect(request.mock.calls.length).toBe(callsBefore);
  await userEvent.type(screen.getByLabelText('Saldo / Monto *'), '5');
  expect(screen.getByLabelText('Saldo / Monto *')).not.toHaveAttribute('aria-invalid');
});
