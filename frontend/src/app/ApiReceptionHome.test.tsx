import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiReceptionHome } from './ApiReceptionHome';

describe('live reception cash checkout', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('allows cash sales without an open shift and asks for the first shift when required', async () => {
    const request = vi.fn(async (path: string) => {
      if (path === '/api/v1/registers/product-sale-intent') return new Response('null');
      if (path.endsWith('/product-sale-intent')) return new Response('{}');
      if (path === '/api/v1/registers') return new Response(JSON.stringify([{ id: 'register', branch_id: 'branch', code: 'front', name: 'Front', status: 'active', has_open_shift: false }]));
      if (path === '/api/v1/inventory/branches') return new Response(JSON.stringify([{ id: 'branch', name: 'Central' }]));
      if (path.startsWith('/api/v1/inventory/branches/')) return new Response(JSON.stringify({ items: [{ product_id: 'product', name: 'Water', price_minor: 500, quantity: 5, initialized: true, is_active: true }], total: 1 }));
      if (path.endsWith('/product-sales/resolve')) return new Response(JSON.stringify({ status: 'cancelled' }));
      if (path.endsWith('/product-sales')) return new Response(JSON.stringify({ error: { code: 'first_shift_required' } }), { status: 409 });
      throw new Error(path);
    });
    render(<ApiReceptionHome request={request} actorId="actor" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Seleccionar Water' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cobro' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Realizar cobro' }));
    expect(await screen.findByText(/Abre el primer turno/)).toBeVisible();
    expect(sessionStorage.getItem('evogym:product-sale:actor')).toBeNull();
  }, 15000);

  it('distinguishes same-named registers by branch', async () => {
    const request = vi.fn(async (path: string) => {
      if (path === '/api/v1/registers/product-sale-intent') return new Response('null');
      if (path.endsWith('/product-sale-intent')) return new Response('{}');
      if (path === '/api/v1/registers') return new Response(JSON.stringify([
        { id: 'a', branch_id: 'a', code: 'front', name: 'Caja', status: 'active', has_open_shift: true },
        { id: 'b', branch_id: 'b', code: 'front', name: 'Caja', status: 'active', has_open_shift: true },
      ]));
      if (path === '/api/v1/inventory/branches') return new Response(JSON.stringify([{ id: 'a', name: 'Norte' }, { id: 'b', name: 'Sur' }]));
      if (path.startsWith('/api/v1/inventory/branches/')) return new Response(JSON.stringify({ items: [], total: 0 }));
      throw new Error(path);
    });
    render(<ApiReceptionHome request={request} actorId="actor" />);
    expect(await screen.findByRole('option', { name: 'Norte · Caja · front' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'Sur · Caja · front' })).toBeVisible();
    expect(screen.getByLabelText('Caja')).toHaveValue('');
  });

  it.each([403, 409])('unlocks a first-attempt %s rejection so the cart can be corrected', async status => {
    const request = vi.fn(async (path: string) => {
      if (path === '/api/v1/registers/product-sale-intent') return new Response('null');
      if (path.endsWith('/product-sale-intent')) return new Response('{}');
      if (path === '/api/v1/registers') return new Response(JSON.stringify([{ id: 'register', branch_id: 'branch', code: 'front', name: 'Front', status: 'active', has_open_shift: true }]));
      if (path === '/api/v1/inventory/branches') return new Response(JSON.stringify([{ id: 'branch', name: 'Central' }]));
      if (path.startsWith('/api/v1/inventory/branches/')) return new Response(JSON.stringify({ items: [{ product_id: 'product', name: 'Water', price_minor: 500, quantity: 5, initialized: true, is_active: true }], total: 1 }));
      if (path.endsWith('/product-sales/resolve')) return new Response(JSON.stringify({ status: 'cancelled' }));
      if (path.endsWith('/product-sales')) return new Response(JSON.stringify({ error: { code: 'product_sale_rejected' } }), { status });
      throw new Error(path);
    });
    render(<ApiReceptionHome request={request} actorId="actor" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Seleccionar Water' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cobro' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Realizar cobro' }));
    expect(await screen.findByText(/La compra fue rechazada/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Reintentar compra pendiente' })).toBeNull();
    expect(sessionStorage.getItem('evogym:product-sale:actor')).toBeNull();
  }, 15000);

  it('completes a live card sale via Point terminal integration', async () => {
    const request = vi.fn(async (path: string) => {
      if (path === '/api/v1/registers/product-sale-intent') return new Response('null');
      if (path.endsWith('/product-sale-intent')) return new Response('{}');
      if (path === '/api/v1/registers') return new Response(JSON.stringify([{ id: 'register', branch_id: 'branch', code: 'front', name: 'Front', status: 'active', has_open_shift: true }]));
      if (path === '/api/v1/inventory/branches') return new Response(JSON.stringify([{ id: 'branch', name: 'Central' }]));
      if (path.startsWith('/api/v1/inventory/branches/')) return new Response(JSON.stringify({ items: [{ product_id: 'product', name: 'Water', price_minor: 500, quantity: 5, initialized: true, is_active: true }], total: 1 }));
      if (path.endsWith('/card-intent')) return new Response(JSON.stringify({
        id: 'intent-point-123',
        payment_intent_id: 'intent-point-123',
        device_id: 'POINT-001',
        status: 'OPEN',
        amount_minor: 500,
      }), { status: 201 });
      if (path.includes('/card-intent/intent-point-123')) return new Response(JSON.stringify({
        id: 'intent-point-123',
        payment_intent_id: 'intent-point-123',
        device_id: 'POINT-001',
        status: 'PROCESSED',
        amount_minor: 500,
      }));
      if (path.endsWith('/product-sales/card')) return new Response(JSON.stringify({
        order: {
          id: 'order-123',
          register_id: 'register',
          total_minor: 500,
        },
        items: [
          { id: 'item-1', product_id: 'product', quantity: 1, line_total_minor: 500 },
        ],
        payment: {
          id: 'pay-123',
          order_id: 'order-123',
          method: 'card',
          status: 'confirmed',
          amount_minor: 500,
          terminal_id: 'POINT-001',
          mp_payment_intent_id: 'intent-point-123',
        },
      }), { status: 201 });
      if (path.endsWith('/product-sales/resolve')) return new Response(JSON.stringify({
        status: 'completed',
        order_id: 'order-123',
        total_minor: 500,
      }));
      throw new Error(path);
    });
    render(<ApiReceptionHome request={request} actorId="actor" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Seleccionar Water' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cobro' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Tarjeta' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cobrar con Tarjeta' }));
    expect(await screen.findByText('Compra con tarjeta registrada.')).toBeVisible();
    expect(request.mock.calls.some(([path]) => path.endsWith('/card-intent'))).toBe(true);
    expect(request.mock.calls.some(([path]) => path.endsWith('/product-sales/card'))).toBe(true);
    expect(sessionStorage.getItem('evogym:product-sale:actor')).toBeNull();
  }, 15000);

  it('preserves an uncertain sale without retrying into a different shift', async () => {
    sessionStorage.setItem('evogym:product-sale:actor', JSON.stringify({ key: 'saved', registerId: 'register', payload: {
      member_id: null, items: [{ product_id: 'product', quantity: 1 }], expected_total_minor: 500,
    } }));
    const request = vi.fn(async (path: string) => {
      if (path === '/api/v1/registers/product-sale-intent') return new Response('null');
      if (path.endsWith('/product-sale-intent')) return new Response('{}');
      if (path === '/api/v1/registers') return new Response(JSON.stringify([{ id: 'register', branch_id: 'branch', code: 'front', name: 'Front', status: 'active', has_open_shift: false }]));
      if (path === '/api/v1/inventory/branches') return new Response(JSON.stringify([{ id: 'branch', name: 'Central' }]));
      if (path.startsWith('/api/v1/inventory/branches/')) return new Response(JSON.stringify({ items: [], total: 0 }));
      throw new Error(path);
    });
    render(<ApiReceptionHome request={request} actorId="actor" />);
    expect(await screen.findByText(/compra está pendiente de confirmación/)).toBeVisible();
    expect(request.mock.calls.some(([path]) => path.endsWith('/product-sales'))).toBe(false);
    expect(sessionStorage.getItem('evogym:product-sale:actor')).not.toBeNull();
  });

  it.each(['completed', 'cancelled'])('resolves a pending %s intent without creating another sale', async status => {
    const saved = { key: 'saved', registerId: 'register', payload: {
      member_id: null, items: [{ product_id: 'product', quantity: 1 }], expected_total_minor: 500,
    } };
    sessionStorage.setItem('evogym:product-sale:actor', JSON.stringify(saved));
    const request = vi.fn(async (path: string) => {
      if (path === '/api/v1/registers/product-sale-intent') return new Response('null');
      if (path.endsWith('/product-sale-intent')) return new Response('{}');
      if (path === '/api/v1/registers') return new Response(JSON.stringify([{ id: 'register', branch_id: 'branch', code: 'front', name: 'Front', status: 'active' }]));
      if (path === '/api/v1/inventory/branches') return new Response(JSON.stringify([{ id: 'branch', name: 'Central' }]));
      if (path.startsWith('/api/v1/inventory/branches/')) return new Response(JSON.stringify({ items: [], total: 0 }));
      if (path.endsWith('/product-sales/resolve')) return new Response(JSON.stringify({ status, order_id: 'order', total_minor: 500 }));
      throw new Error(path);
    });
    render(<ApiReceptionHome request={request} actorId="actor" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Resolver compra pendiente' }));
    expect(await screen.findByText(status === 'completed' ? 'Compra registrada.' : 'La compra no se registró y fue cancelada.')).toBeVisible();
    expect(sessionStorage.getItem('evogym:product-sale:actor')).toBeNull();
    expect(request.mock.calls.some(([path]) => path.endsWith('/product-sales'))).toBe(false);
  });

  it('recovers an unresolved server intent in a fresh tab', async () => {
    const saved = { key: 'remote', registerId: 'register', payload: {
      member_id: null, items: [{ product_id: 'product', quantity: 1 }], expected_total_minor: 500,
    } };
    const request = vi.fn(async (path: string) => {
      if (path === '/api/v1/registers/product-sale-intent') return new Response(JSON.stringify(saved));
      if (path === '/api/v1/registers') return new Response(JSON.stringify([{ id: 'register', branch_id: 'branch', code: 'front', name: 'Front', status: 'active' }]));
      if (path === '/api/v1/inventory/branches') return new Response(JSON.stringify([{ id: 'branch', name: 'Central' }]));
      if (path.startsWith('/api/v1/inventory/branches/')) return new Response(JSON.stringify({ items: [], total: 0 }));
      throw new Error(path);
    });
    render(<ApiReceptionHome request={request} actorId="actor" />);
    expect(await screen.findByRole('button', { name: 'Resolver compra pendiente' })).toBeVisible();
    expect(screen.getByText(/Compra pendiente de confirmar/)).toBeVisible();
  });

  it('resolves a legacy tab intent before a different server intent without losing either', async () => {
    const payload = { member_id: null, items: [{ product_id: 'product', quantity: 1 }], expected_total_minor: 500 };
    sessionStorage.setItem('evogym:product-sale:actor', JSON.stringify({ key: 'legacy', registerId: 'register', payload }));
    const saved = { key: 'server', registerId: 'register', payload };
    let serverPending = true;
    const resolved: string[] = [];
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/v1/registers/product-sale-intent') return new Response(JSON.stringify(serverPending ? saved : null));
      if (path === '/api/v1/registers') return new Response(JSON.stringify([{ id: 'register', branch_id: 'branch', code: 'front', name: 'Front', status: 'active' }]));
      if (path === '/api/v1/inventory/branches') return new Response(JSON.stringify([{ id: 'branch', name: 'Central' }]));
      if (path.startsWith('/api/v1/inventory/branches/')) return new Response(JSON.stringify({ items: [], total: 0 }));
      if (path.endsWith('/product-sales/resolve')) {
        const key = (init?.headers as Record<string, string>)['Idempotency-Key'];
        resolved.push(key);
        if (key === 'server') serverPending = false;
        return new Response(JSON.stringify({ status: 'cancelled' }));
      }
      throw new Error(path);
    });
    render(<ApiReceptionHome request={request} actorId="actor" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Resolver compra pendiente' }));
    expect(await screen.findByRole('button', { name: 'Resolver compra pendiente' })).toBeVisible();
    expect(JSON.parse(sessionStorage.getItem('evogym:product-sale:actor')!).key).toBe('server');
    await userEvent.click(screen.getByRole('button', { name: 'Resolver compra pendiente' }));
    expect(await screen.findByText('La compra no se registró y fue cancelada.')).toBeVisible();
    expect(resolved).toEqual(['legacy', 'server']);
    expect(sessionStorage.getItem('evogym:product-sale:actor')).toBeNull();
  });

  it('opens devoluciones modal and submits a product return refreshing inventory', async () => {
    let inventoryFetchedCount = 0;
    const request = vi.fn(async (path: string) => {
      if (path === '/api/v1/registers/product-sale-intent') return new Response('null');
      if (path === '/api/v1/registers') return new Response(JSON.stringify([{ id: 'reg-1', branch_id: 'branch-1', code: 'front', name: 'Front', status: 'active', has_open_shift: true }]));
      if (path === '/api/v1/inventory/branches') return new Response(JSON.stringify([{ id: 'branch-1', name: 'Central' }]));
      if (path.startsWith('/api/v1/inventory/branches/')) {
        inventoryFetchedCount++;
        return new Response(JSON.stringify({ items: [{ product_id: 'prod-1', name: 'Water', price_minor: 500, quantity: 5, initialized: true, is_active: true }], total: 1 }));
      }
      if (path.includes('/eligible-product-returns')) {
        return new Response(JSON.stringify([
          {
            order_item_id: 'item-1',
            order_id: 'order-1',
            product_id: 'prod-1',
            product_name: 'Water',
            quantity: 1,
            unit_amount_minor: 500,
            line_total_minor: 500,
            original_payment_method: 'cash',
            created_at: '2026-10-31T01:00:00Z',
          },
        ]));
      }
      if (path.startsWith('/api/v1/members')) {
        return new Response(JSON.stringify({ items: [{ id: 'm-1', full_name: 'John Doe', phone: '5551234' }] }));
      }
      if (path.endsWith('/product-returns')) {
        return new Response(JSON.stringify({
          id: 'refund-1',
          order_item_id: 'item-1',
          branch_id: 'branch-1',
          register_id: 'reg-1',
          shift_id: 'shift-1',
          financial_shift_id: 'shift-1',
          actor_id: 'actor',
          reason: 'Defective product',
          disposition: 'restock',
          payout_method: 'cash',
          amount_minor: 500,
          quantity: 1,
          idempotency_key: 'key',
          created_at: '2026-10-31T01:00:00Z',
        }), { status: 201 });
      }
      throw new Error(path);
    });

    render(<ApiReceptionHome request={request} actorId="actor" />);
    const devolucionesBtn = await screen.findByRole('button', { name: 'Devoluciones' });
    expect(devolucionesBtn).not.toBeDisabled();
    await userEvent.click(devolucionesBtn);

    expect(await screen.findByRole('heading', { name: 'Registrar devolución' })).toBeVisible();

    const searchInput = screen.getByPlaceholderText(/Buscar cliente/);
    await userEvent.type(searchInput, 'John');

    const memberBtn = await screen.findByRole('option', { name: /John Doe/ });
    await userEvent.click(memberBtn);

    const itemRadio = await screen.findByRole('radio', { name: /Seleccionar Water/ });
    await userEvent.click(itemRadio);

    await userEvent.click(screen.getByRole('button', { name: 'Siguiente →' }));

    const reasonInput = screen.getByPlaceholderText(/Ej. Producto dañado/);
    await userEvent.type(reasonInput, 'Defective product');

    const initialFetchCount = inventoryFetchedCount;
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar devolución' }));

    expect(await screen.findByText(/Devolución registrada por \$5\.00 MXN/)).toBeVisible();
    expect(inventoryFetchedCount).toBeGreaterThan(initialFetchCount);
  });
});
