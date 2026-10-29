import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { DemoProvider, useDemo } from '../../demo/DemoProvider';
import { ReceptionHome } from '../reception/ReceptionHome';
import { Inventory } from './Inventory';

function StateProbe() {
  const { state } = useDemo();
  return <output aria-label="Persisted state">{JSON.stringify(state)}</output>;
}

describe('Inventory catalog preview', () => {
  it('searches products and keeps receiving actions unavailable without cost data', () => {
    render(<DemoProvider><Inventory role="RECEPTION" /></DemoProvider>);
    expect(screen.getByRole('heading', { name: 'Recepción de inventario' })).toBeVisible();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar producto' }), { target: { value: 'agua' } });
    expect(screen.getByRole('button', { name: /Seleccionar Agua/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Seleccionar Barra/ })).not.toBeInTheDocument();
    expect(screen.getByText('Costo unitario').parentElement).toHaveTextContent('No disponible');
    expect(screen.getByRole('button', { name: 'Crear producto' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirmar recepción' })).toBeDisabled();
  });

  it('matches home product markup, order, stock, price and layout classes', () => {
    const home = render(<MemoryRouter><DemoProvider><ReceptionHome /></DemoProvider></MemoryRouter>);
    const initialCards = screen.getAllByRole('article').map(card => card.outerHTML);
    fireEvent.click(screen.getByRole('button', { name: /Seleccionar Agua/ }));
    const selectedCard = screen.getByRole('button', { name: /Seleccionar Agua/ }).closest('article')?.outerHTML;
    home.unmount();
    render(<DemoProvider><Inventory role="RECEPTION" /></DemoProvider>);
    expect(screen.getAllByRole('article').map(card => card.outerHTML)).toEqual(initialCards);
    const card = screen.getByRole('button', { name: /Seleccionar Agua/ });
    expect(card.closest('.product-grid')).toHaveAttribute('class', 'product-grid');
    expect(card.closest('.product-catalog-panel')).not.toBeNull();
    expect(card.closest('.reception-products-column')).not.toBeNull();
    expect(card.closest('.reception-checkout')).not.toBeNull();
    fireEvent.click(card);
    expect(card.closest('article')?.outerHTML).toEqual(selectedCard);
  });

  it('increments and decrements with clicks and quantity controls without changing persisted state', () => {
    render(<DemoProvider><Inventory role="RECEPTION" /><StateProbe /></DemoProvider>);
    const stateBefore = screen.getByLabelText('Persisted state').textContent;
    const agua = screen.getByRole('button', { name: /Seleccionar Agua/ });
    const barra = screen.getByRole('button', { name: /Seleccionar Barra/ });
    for (let count = 0; count < 13; count++) fireEvent.click(agua);
    fireEvent.click(barra);
    expect(screen.getByLabelText(/Cantidad de Agua/)).toHaveTextContent('13');
    expect(screen.getByLabelText(/Cantidad de Barra/)).toHaveTextContent('1');
    expect(screen.getByText('Cantidad recibida').parentElement).toHaveTextContent('1');
    fireEvent.contextMenu(agua.closest('article') as HTMLElement);
    expect(screen.getByLabelText(/Cantidad de Agua/)).toHaveTextContent('12');
    expect(screen.getByText('Cantidad recibida').parentElement).toHaveTextContent('12');
    fireEvent.click(screen.getByRole('button', { name: /Aumentar Agua/ }));
    fireEvent.click(screen.getByRole('button', { name: /Disminuir Agua/ }));
    expect(screen.getByLabelText(/Cantidad de Agua/)).toHaveTextContent('12');
    fireEvent.click(screen.getByRole('button', { name: /Quitar Agua/ }));
    expect(screen.queryByLabelText(/Cantidad de Agua/)).not.toBeInTheDocument();
    expect(agua).toHaveAttribute('aria-pressed', 'false');
    fireEvent.contextMenu(barra.closest('article') as HTMLElement);
    fireEvent.contextMenu(barra.closest('article') as HTMLElement);
    expect(screen.queryByLabelText(/Cantidad de Barra/)).not.toBeInTheDocument();
    expect(screen.getByText('Cantidad recibida').parentElement).toHaveTextContent('0');
    expect(screen.getByLabelText('Persisted state').textContent).toBe(stateBefore);
  });

  it('preserves independent local quantities while filtering and shows an empty search state', () => {
    render(<DemoProvider><Inventory role="RECEPTION" /></DemoProvider>);
    fireEvent.click(screen.getByRole('button', { name: /Seleccionar Agua/ }));
    fireEvent.click(screen.getByRole('button', { name: /Seleccionar Barra/ }));
    const search = screen.getByRole('searchbox', { name: 'Buscar producto' });
    fireEvent.change(search, { target: { value: 'unknown-product' } });
    expect(screen.getByRole('status')).toHaveTextContent('No se encontraron productos.');
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    fireEvent.change(search, { target: { value: ' AGUA ' } });
    expect(screen.getByLabelText(/Cantidad de Agua/)).toHaveTextContent('1');
    expect(screen.queryByLabelText(/Cantidad de Barra/)).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByLabelText(/Cantidad de Agua/)).toHaveTextContent('1');
    expect(screen.getByLabelText(/Cantidad de Barra/)).toHaveTextContent('1');
  });

  it('opens the non-transactional receiving preview without inventing a total', async () => {
    render(<DemoProvider><Inventory role="RECEPTION" /><StateProbe /></DemoProvider>);
    fireEvent.click(screen.getByRole('button', { name: /Seleccionar Agua/ }));
    const stateBefore = screen.getByLabelText('Persisted state').textContent;
    fireEvent.click(document.querySelector('.mobile-detail-trigger')!);
    expect(screen.getByRole('dialog', { name: 'Vista previa de recepción' })).toBeVisible();
    expect(screen.getByText('Cantidad recibida').parentElement).toHaveTextContent('1');
    expect(screen.getByText('Costo unitario').parentElement).toHaveTextContent('No disponible');
    expect(screen.getByText('Total de recepción').parentElement).toHaveTextContent('No disponible');
    expect(screen.getByRole('button', { name: 'Confirmar recepción' })).toBeDisabled();
    fireEvent.click(document.querySelector('.mobile-detail-close')!);
    expect(screen.queryByRole('dialog', { name: 'Vista previa de recepción' })).not.toBeInTheDocument();
    expect(screen.getByText('Cantidad recibida').parentElement).toHaveTextContent('1');
    expect(screen.getByLabelText('Persisted state').textContent).toBe(stateBefore);
  });

  it('loads live stock and submits restock and waste movements via apiRequest', async () => {
    let stockItems = [
      {
        product_id: 'p-1',
        code: 'suero',
        name: 'Suero 500ml',
        category: 'Bebidas',
        price_minor: 3500,
        cost_minor: 1800,
        is_active: true,
        unit: 'piece',
        initialized: true,
        opening_quantity: 20,
        restocked_quantity: 0,
        waste_quantity: 0,
        quantity: 20,
        initialized_at: '2026-01-01T00:00:00Z',
      },
    ];

    const mockRequest = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/v1/inventory/branches') {
        return new Response(JSON.stringify([{ id: 'branch-1', code: 'central', name: 'Central' }]));
      }
      if (path.startsWith('/api/v1/inventory/branches/branch-1/stock')) {
        return new Response(JSON.stringify({ items: stockItems, total: stockItems.length }));
      }
      if (path === '/api/v1/inventory/branches/branch-1/movements' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        if (body.kind === 'waste' && body.quantity > 25) {
          return new Response(JSON.stringify({ detail: 'Waste quantity exceeds available stock.' }), { status: 409 });
        }
        if (body.kind === 'restock') {
          stockItems[0].quantity += body.quantity;
          stockItems[0].restocked_quantity += body.quantity;
        } else if (body.kind === 'waste') {
          stockItems[0].quantity -= body.quantity;
          stockItems[0].waste_quantity += body.quantity;
        }
        return new Response(
          JSON.stringify({
            id: 'mov-1',
            branch_id: 'branch-1',
            product_id: body.product_id,
            kind: body.kind,
            quantity: body.quantity,
            reason: body.reason || null,
            recorded_by: 'user-1',
            idempotency_key: body.idempotency_key,
            recorded_at: '2026-01-02T00:00:00Z',
            on_hand_quantity: stockItems[0].quantity,
          }),
          { status: 201 }
        );
      }
      return new Response('{}');
    });

    render(<Inventory role="RECEPTION" apiRequest={mockRequest} />);

    // Renders live product with stock 20
    expect(await screen.findByRole('button', { name: /Seleccionar Suero 500ml/ })).toBeInTheDocument();
    expect(screen.getByText('Stock: 20')).toBeInTheDocument();

    // Select product and increase quantity
    const card = screen.getByRole('button', { name: /Seleccionar Suero 500ml/ });
    fireEvent.click(card);
    fireEvent.click(screen.getByRole('button', { name: /Aumentar Suero 500ml/ }));
    fireEvent.click(screen.getByRole('button', { name: /Aumentar Suero 500ml/ }));
    fireEvent.click(screen.getByRole('button', { name: /Aumentar Suero 500ml/ }));
    fireEvent.click(screen.getByRole('button', { name: /Aumentar Suero 500ml/ }));
    // 5 units selected (1 from click + 4 increases = 5)
    expect(screen.getByLabelText(/Cantidad de Suero 500ml/)).toHaveTextContent('5');

    // Confirm restock
    const confirmBtn = screen.getByRole('button', { name: 'Confirmar recepción' });
    expect(confirmBtn).toBeEnabled();
    fireEvent.click(confirmBtn);

    expect(await screen.findByText('Recepción de 5 unidad(es) confirmada.')).toBeInTheDocument();
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/inventory/branches/branch-1/movements',
      expect.objectContaining({ method: 'POST' })
    );

    // Stock refreshed to 25
    expect(await screen.findByText('Stock: 25')).toBeInTheDocument();

    // Switch to waste
    fireEvent.click(screen.getByRole('button', { name: 'Merma' }));
    expect(screen.getByRole('button', { name: 'Confirmar merma' })).toBeDisabled();

    // Select 30 units (more than 25)
    fireEvent.click(card);
    const increaseBtn = screen.getByRole('button', { name: /Aumentar Suero 500ml/ });
    for (let i = 0; i < 29; i++) {
      fireEvent.click(increaseBtn);
    }
    expect(screen.getByLabelText(/Cantidad de Suero 500ml/)).toHaveTextContent('30');

    // Enter waste reason
    const reasonInput = screen.getByLabelText(/Motivo de merma/);
    fireEvent.change(reasonInput, { target: { value: 'Lote dañado' } });

    // Click confirm merma
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar merma' }));

    // Verifies 409 error banner
    expect(await screen.findByRole('alert')).toHaveTextContent('Waste quantity exceeds available stock.');
    expect(screen.getByText('Stock: 25')).toBeInTheDocument();
  });
});
