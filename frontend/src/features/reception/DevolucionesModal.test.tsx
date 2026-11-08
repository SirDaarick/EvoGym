import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { DevolucionesModal } from './DevolucionesModal';

it('fixes the refund method to the original card payment and submits it', async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.includes('/eligible-product-returns')) {
      return new Response(JSON.stringify([{
        order_item_id: 'item-1', order_id: 'order-1', product_id: 'prod-1', product_name: 'Water', quantity: 1,
        unit_amount_minor: 500, line_total_minor: 500, original_payment_method: 'card', created_at: '2026-10-31T01:00:00Z',
      }]));
    }
    if (path.startsWith('/api/v1/members')) {
      return new Response(JSON.stringify({ items: [{ id: 'm-1', full_name: 'John Doe', phone: '5551234' }] }));
    }
    if (path.endsWith('/product-returns')) {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: 'refund-1', amount_minor: 500, payout_method: 'card' }), { status: 201 });
    }
    throw new Error(path);
  });

  render(<DevolucionesModal isOpen onClose={() => {}} onSuccess={() => {}} apiRequest={request as never} registerId="reg-1" />);
  await userEvent.type(screen.getByPlaceholderText(/Buscar cliente/), 'John');
  await userEvent.click(await screen.findByRole('option', { name: /John Doe/ }));
  await userEvent.click(await screen.findByRole('radio', { name: /Seleccionar Water/ }));
  await userEvent.click(screen.getByRole('button', { name: /Siguiente/ }));

  const toggles = screen.getAllByRole('button').filter(b => /Efectivo \(Caja\)|Tarjeta \(Reverso\)/.test(b.textContent ?? ''));
  expect(toggles).toHaveLength(2);
  toggles.forEach(b => expect(b).toBeDisabled());

  await userEvent.type(screen.getByPlaceholderText(/Ej\. Producto/), 'Defective product');
  await userEvent.click(screen.getByRole('button', { name: /Confirmar devoluci/ }));
  await vi.waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0].payout_method).toBe('card');
});
