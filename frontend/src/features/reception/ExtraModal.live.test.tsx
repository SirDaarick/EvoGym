import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ExtraModal } from './ExtraModal';

it('records a live cash contribution and refreshes the current shift history', async () => {
  const user = userEvent.setup();
  let recorded = false;
  const request = vi.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method === 'POST') { recorded = true; return new Response('{}', { status: 201 }); }
    return new Response(JSON.stringify({ items: recorded ? [{ id: '1', shift_id: 's', concept: 'Fund', contributor_name: 'Admin', amount_minor: 80000, recorded_by_name: 'Cashier', recorded_at: '2026-10-30T12:00:00Z' }] : [], total_minor: recorded ? 80000 : 0 }));
  });
  render(<ExtraModal isOpen onClose={() => {}} apiRequest={request} registerId="register" />);
  await user.type(screen.getByLabelText('Concepto *'), 'Fund');
  await user.type(screen.getByLabelText('Nombre *'), 'Admin');
  await user.type(screen.getByLabelText('Saldo / Monto *'), '800');
  await user.click(screen.getByRole('button', { name: 'Agregar' }));
  expect(await screen.findByText('Fund')).toBeInTheDocument();
  const post = request.mock.calls.find(([, init]) => init?.method === 'POST');
  expect(post?.[0]).toBe('/api/v1/registers/register/cash-contributions');
  expect(JSON.parse(String(post?.[1]?.body))).toEqual({ concept: 'Fund', contributor_name: 'Admin', amount_minor: 80000 });
  expect((post?.[1]?.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
});

it('reuses the same key and payload after an uncertain submission', async () => {
  const calls: RequestInit[] = [];
  const request = vi.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      calls.push(init);
      if (calls.length === 1) throw new Error('network');
      return new Response('{}', { status: 201 });
    }
    return new Response(JSON.stringify({ items: [], total_minor: 0 }));
  });
  render(<ExtraModal isOpen onClose={() => {}} apiRequest={request} registerId="register" />);
  await userEvent.type(screen.getByLabelText('Concepto *'), 'Fund');
  await userEvent.type(screen.getByLabelText('Nombre *'), 'Admin');
  await userEvent.type(screen.getByLabelText('Saldo / Monto *'), '800');
  await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));
  await screen.findByText('network');
  await userEvent.type(screen.getByLabelText('Concepto *'), ' changed');
  await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));
  expect(calls).toHaveLength(1);
  await userEvent.clear(screen.getByLabelText('Concepto *'));
  await userEvent.type(screen.getByLabelText('Concepto *'), 'Fund');
  await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));
  await vi.waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[1].body).toBe(calls[0].body);
  expect(calls[1].headers).toEqual(calls[0].headers);
});
