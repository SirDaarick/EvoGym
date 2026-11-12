import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PurchasePanel } from './PurchasePanel';

afterEach(() => localStorage.clear());

describe('current inventory purchase', () => {
  it('records multiple products with exact line costs and a drawer selection', async () => {
    const request = vi.fn(async (path: string, _init?: RequestInit) => {
      if (path === '/api/v1/registers') return new Response(JSON.stringify([{ id: 'reg', branch_id: 'branch', name: 'Caja', status: 'active', has_open_shift: true }]));
      if (path.endsWith('/purchases')) return new Response(JSON.stringify({ id: 'purchase', total_minor: 700, expense_id: 'expense' }), { status: 201 });
      throw new Error(path);
    });
    const onSuccess = vi.fn();
    render(<PurchasePanel request={request} branchId="branch" products={[{ id: 'water', name: 'Agua', quantity: 2 }, { id: 'bar', name: 'Barra', quantity: 3 }]} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText('Costo total de Agua'), { target: { value: '2.50' } });
    fireEvent.change(screen.getByLabelText('Costo total de Barra'), { target: { value: '4.50' } });
    fireEvent.click(screen.getByLabelText('Pagar con dinero de caja'));
    const register = await screen.findByLabelText('Caja');
    fireEvent.change(register, { target: { value: 'reg' } });
    await waitFor(() => expect(register).toHaveValue('reg'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar compra' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    const call = request.mock.calls.find(([path]) => path.endsWith('/purchases'));
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({
      items: [{ product_id: 'water', quantity: 2, cost_minor: 250 }, { product_id: 'bar', quantity: 3, cost_minor: 450 }],
      pay_from_drawer: true, register_id: 'reg',
    });
  });

  it('retries an uncertain result with the same payload and idempotency key', async () => {
    let attempts = 0;
    const request = vi.fn(async (_path: string, _init?: RequestInit) => {
      attempts += 1;
      if (attempts === 1) throw new Error('connection lost');
      return new Response(JSON.stringify({ id: 'purchase', total_minor: 250, expense_id: 'expense' }));
    });
    render(<PurchasePanel request={request} branchId="branch" products={[{ id: 'water', name: 'Agua', quantity: 2 }]} onSuccess={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Costo total de Agua'), { target: { value: '2.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar compra' }));
    expect(await screen.findByRole('button', { name: 'Reintentar compra pendiente' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar compra pendiente' }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    const first = request.mock.calls[0][1] as RequestInit;
    const second = request.mock.calls[1][1] as RequestInit;
    expect(first.body).toBe(second.body);
    expect((first.headers as Record<string, string>)['Idempotency-Key']).toBe((second.headers as Record<string, string>)['Idempotency-Key']);
  });

  it('unlocks editing and preserves form lines when the server rejects drawer payment', async () => {
    const request = vi.fn(async (_path: string, _init?: RequestInit) => new Response(
      JSON.stringify({ error: { code: 'inventory_purchase_rejected' } }), { status: 409 },
    ));
    render(<PurchasePanel request={request} branchId="branch" products={[{ id: 'water', name: 'Agua', quantity: 2 }]} onSuccess={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Costo total de Agua'), { target: { value: '2.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar compra' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se registró la compra');
    expect(screen.getByRole('button', { name: 'Confirmar compra' })).toBeEnabled();
    expect(screen.getByLabelText('Costo total de Agua')).toHaveValue('2.50');
    expect(screen.getByLabelText('Cantidad de compra de Agua')).toHaveValue(2);
    expect(localStorage.getItem('evogym:inventory-purchase:branch')).toBeNull();
  });

  it('computes unit reference cost rounded to cents and exact total purchase cost', async () => {
    const request = vi.fn(async (path: string) => {
      if (path.endsWith('/purchases')) return new Response(JSON.stringify({ id: 'purchase', total_minor: 14500, expense_id: 'exp' }), { status: 201 });
      throw new Error(path);
    });
    const onQuantityChange = vi.fn();
    render(
      <PurchasePanel
        request={request}
        branchId="branch"
        products={[
          { id: 'water', name: 'Agua', quantity: 3 },
          { id: 'bar', name: 'Barra', quantity: 2 },
        ]}
        onQuantityChange={onQuantityChange}
        onSuccess={vi.fn()}
      />
    );
    // 3 units costing $100 -> unit reference cost $33.33 (cents rounded)
    fireEvent.change(screen.getByLabelText('Costo total de Agua'), { target: { value: '100.00' } });
    expect(screen.getByText('Costo unitario de referencia: $33.33')).toBeVisible();

    // 2 units costing $45 -> unit reference cost $22.50
    fireEvent.change(screen.getByLabelText('Costo total de Barra'), { target: { value: '45.00' } });
    expect(screen.getByText('Costo unitario de referencia: $22.50')).toBeVisible();

    // Exact total cost -> $145.00
    expect(screen.getByText('Total: $145.00')).toBeVisible();

    // Update quantity directly in the purchase panel
    fireEvent.change(screen.getByLabelText('Cantidad de compra de Agua'), { target: { value: '4' } });
    expect(onQuantityChange).toHaveBeenCalledWith('water', 4);
    // 4 units costing $100 -> $25.00
    expect(screen.getByText('Costo unitario de referencia: $25.00')).toBeVisible();
  });
});
