import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoProvider } from '../../demo/DemoProvider';
import { InventoryAnalytics } from './InventoryAnalytics';
import { Inventory } from '../inventory/Inventory';

function enableWriterLock() {
  vi.stubGlobal(
    'navigator',
    Object.create(window.navigator, {
      locks: {
        value: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<void>) => {
            await callback({});
          },
        },
      },
    })
  );
}

async function renderInventoryAnalytics() {
  const result = render(
    <MemoryRouter initialEntries={['/owner/inventory']}>
      <DemoProvider>
        <InventoryAnalytics />
      </DemoProvider>
    </MemoryRouter>
  );
  // Wait for DemoProvider lock hydration to be ready
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Gestión y Análisis de Inventario' })).toBeInTheDocument();
  });
  return result;
}

async function renderInventoryOwner() {
  const result = render(
    <MemoryRouter initialEntries={['/owner/inventory']}>
      <DemoProvider>
        <Inventory role="OWNER" />
      </DemoProvider>
    </MemoryRouter>
  );
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Gestión y Análisis de Inventario' })).toBeInTheDocument();
  });
  return result;
}

describe('InventoryAnalytics owner screen', () => {
  beforeEach(() => {
    enableWriterLock();
    if (typeof window !== 'undefined') {
      window.localStorage?.clear();
      window.sessionStorage?.clear();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (typeof window !== 'undefined') {
      window.localStorage?.clear();
    }
  });

  it('renders header, title, and "Nuevo producto" button', async () => {
    await renderInventoryAnalytics();

    expect(
      screen.getByRole('heading', { name: 'Gestión y Análisis de Inventario' })
    ).toBeInTheDocument();
    expect(screen.getByText('PROPIETARIO · INVENTARIO Y CATÁLOGO')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nuevo producto' })).toBeInTheDocument();
  });

  it('displays the 3 Bento KPI cards with accurate catalog metrics', async () => {
    await renderInventoryAnalytics();

    // KPI 1: Catálogo y valor en piso
    expect(screen.getByText('Catálogo y valor en piso')).toBeInTheDocument();
    expect(screen.getByText('$760.00 MXN')).toBeInTheDocument();
    expect(screen.getByText(/3 activos de 3 en catálogo/)).toBeInTheDocument();

    // KPI 2: Ventas de productos
    expect(screen.getByText(/Ventas de productos/)).toBeInTheDocument();
    expect(screen.getByText('0 unidades vendidas')).toBeInTheDocument();

    // KPI 3: Alertas de rotación
    expect(screen.getByText('Alertas de rotación')).toBeInTheDocument();
    expect(screen.getByText(/0 con bajo stock/)).toBeInTheDocument();
    expect(screen.getByText(/3 productos sin ventas/)).toBeInTheDocument();
  });

  it('renders visual organizer with chart container and metric toggle buttons', async () => {
    await renderInventoryAnalytics();

    expect(screen.getByRole('heading', { name: 'Productos más vendidos' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ranking de rotación' })).toBeInTheDocument();

    const unitsBtn = screen.getByRole('button', { name: 'Por unidades' });
    const revBtn = screen.getByRole('button', { name: 'Por ingresos' });
    expect(unitsBtn).toBeInTheDocument();
    expect(revBtn).toBeInTheDocument();

    await userEvent.click(revBtn);
    expect(revBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders catalog table with seed products and filter pills', async () => {
    await renderInventoryAnalytics();

    expect(
      screen.getByRole('heading', { name: 'Catálogo de productos y existencias' })
    ).toBeInTheDocument();

    // Filter pills
    expect(screen.getByRole('button', { name: /Todos/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Activos/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bajo stock/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sin ventas/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Inactivos/ })).toBeInTheDocument();

    // Seed products listed in table
    expect(screen.getByText('Agua')).toBeInTheDocument();
    expect(screen.getByText('Barra')).toBeInTheDocument();
    expect(screen.getByText('Bebida')).toBeInTheDocument();
  });

  it('filters table by search query', async () => {
    await renderInventoryAnalytics();

    const searchInput = screen.getByLabelText('Buscar productos');
    await userEvent.type(searchInput, 'Agua');

    expect(screen.getByText('Agua')).toBeInTheDocument();
    expect(screen.queryByText('Barra')).not.toBeInTheDocument();
  });

  it('opens and closes "Nuevo producto" modal with form validation', async () => {
    await renderInventoryAnalytics();

    const newBtn = screen.getByRole('button', { name: 'Nuevo producto' });
    await userEvent.click(newBtn);

    // Modal is open
    expect(screen.getByRole('dialog', { name: 'Nuevo producto' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Nombre del producto/)).toBeInTheDocument();

    // Submit without name -> validation error
    const nameInput = screen.getByLabelText(/Nombre del producto/);
    await userEvent.clear(nameInput);
    const priceInput = screen.getByLabelText(/Precio de venta MXN/);
    await userEvent.type(priceInput, '45');
    const submitBtn = screen.getByRole('button', { name: 'Guardar producto' });
    await userEvent.click(submitBtn);

    // Still in modal because name is required
    expect(screen.getByRole('dialog', { name: 'Nuevo producto' })).toBeInTheDocument();

    // Fill valid data and submit
    await userEvent.type(nameInput, 'Proteína Isolate');
    const costInput = screen.getByLabelText(/Costo unitario MXN/);
    await userEvent.type(costInput, '30');
    const stockInput = screen.getByLabelText(/Stock inicial/);
    await userEvent.clear(stockInput);
    await userEvent.type(stockInput, '10');

    await userEvent.click(submitBtn);

    // Modal closes and new product appears in table
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Nuevo producto' })).not.toBeInTheDocument();
    });
    expect(screen.getByText('Proteína Isolate')).toBeInTheDocument();
  });

  it('opens edit modal and updates product details', async () => {
    await renderInventoryAnalytics();

    const editBtn = screen.getByLabelText('Editar Agua');
    await userEvent.click(editBtn);

    expect(screen.getByRole('dialog', { name: 'Editar producto' })).toBeInTheDocument();
    const nameInput = screen.getByLabelText(/Nombre del producto/);
    expect(nameInput).toHaveValue('Agua');

    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Agua Mineral 600ml');

    const saveBtn = screen.getByRole('button', { name: 'Guardar cambios' });
    await userEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Editar producto' })).not.toBeInTheDocument();
    });
    expect(screen.getByText('Agua Mineral 600ml')).toBeInTheDocument();
  });

  it('opens confirmation modal and deactivates a product', async () => {
    await renderInventoryAnalytics();

    const toggleBtn = screen.getByLabelText('Desactivar Agua');
    await userEvent.click(toggleBtn);

    expect(screen.getByRole('dialog', { name: '¿Desactivar producto?' })).toBeInTheDocument();
    const confirmBtn = screen.getByRole('button', { name: 'Confirmar desactivación' });
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '¿Desactivar producto?' })).not.toBeInTheDocument();
    });

    // Filter by Inactivos to see deactivated product
    const inactivePill = screen.getByRole('button', { name: /Inactivos/ });
    await userEvent.click(inactivePill);

    expect(screen.getByText('Agua')).toBeInTheDocument();
    expect(screen.getByText('Inactivo')).toBeInTheDocument();
  });

  it('renders InventoryAnalytics when role is OWNER in Inventory component', async () => {
    await renderInventoryOwner();

    expect(
      screen.getByRole('heading', { name: 'Gestión y Análisis de Inventario' })
    ).toBeInTheDocument();
    expect(screen.getByText('PROPIETARIO · INVENTARIO Y CATÁLOGO')).toBeInTheDocument();
  });

  it('renders live KPI totals and table rows from apiRequest without DemoProvider and wires modals', async () => {
    let stockItems = [
      {
        product_id: 'p-1',
        code: 'p1',
        name: 'Suero 500ml',
        category: 'Bebidas',
        price_minor: 3500,
        cost_minor: 1800,
        is_active: true,
        unit: 'piece',
        initialized: true,
        opening_quantity: 20,
        restocked_quantity: 5,
        waste_quantity: 1,
        quantity: 24,
        initialized_at: '2026-01-01T00:00:00Z',
      },
    ];

    const mockApiRequest = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/v1/inventory/branches') {
        return new Response(JSON.stringify([{ id: 'branch-1', code: 'central', name: 'Central' }]));
      }
      if (path.startsWith('/api/v1/inventory/branches/branch-1/stock')) {
        return new Response(JSON.stringify({ items: stockItems, total: stockItems.length }));
      }
      if (path.startsWith('/api/v1/inventory/branches/branch-1/movements')) {
        return new Response(JSON.stringify({ items: [], total: 0 }));
      }
      if (path === '/api/v1/inventory/products' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        if (body.name === 'Conflict Product') {
          return new Response(JSON.stringify({ detail: 'A product with this code already exists.' }), { status: 409 });
        }
        const created = {
          product_id: 'p-2',
          code: 'p2',
          name: body.name,
          category: body.category || 'General',
          price_minor: body.price_minor,
          cost_minor: body.cost_minor || 0,
          is_active: true,
          unit: 'piece',
          initialized: true,
          opening_quantity: body.initial_quantity || 0,
          restocked_quantity: 0,
          waste_quantity: 0,
          quantity: body.initial_quantity || 0,
          initialized_at: '2026-01-01T00:00:00Z',
        };
        stockItems.push(created);
        return new Response(JSON.stringify({ ...created, id: created.product_id }), { status: 201 });
      }
      if (path === '/api/v1/inventory/products/p-1' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        stockItems = stockItems.map(p => p.product_id === 'p-1' ? { ...p, ...body } : p);
        return new Response(JSON.stringify({ ...stockItems[0], id: 'p-1' }));
      }
      return new Response('{}');
    });

    render(
      <MemoryRouter initialEntries={['/owner/inventory']}>
        <InventoryAnalytics apiRequest={mockApiRequest} />
      </MemoryRouter>
    );

    // Live KPI 1: 24 * $35.00 = $840.00 MXN
    expect(await screen.findByText('$840.00 MXN')).toBeInTheDocument();
    expect(screen.getByText('Suero 500ml')).toBeInTheDocument();
    expect(screen.getByText('Bebidas')).toBeInTheDocument();

    // Modal 1: Create product with error retention
    const newBtn = screen.getByRole('button', { name: 'Nuevo producto' });
    await userEvent.click(newBtn);
    const nameInput = screen.getByLabelText(/Nombre del producto/);
    await userEvent.type(nameInput, 'Conflict Product');
    const priceInput = screen.getByLabelText(/Precio de venta MXN/);
    await userEvent.type(priceInput, '50');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar producto' }));

    // Verify 409 error is shown and form retains values
    expect(await screen.findByText('A product with this code already exists.')).toBeInTheDocument();
    expect(nameInput).toHaveValue('Conflict Product');
    expect(priceInput).toHaveValue(50);

    // Now fix name and submit successfully
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Proteína Shake');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar producto' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Nuevo producto' })).not.toBeInTheDocument();
    });
    expect(await screen.findByText('Proteína Shake')).toBeInTheDocument();

    // Modal 2: Edit product
    const editBtn = screen.getByLabelText('Editar Suero 500ml');
    await userEvent.click(editBtn);
    const editPriceInput = screen.getByLabelText(/Precio de venta MXN/);
    await userEvent.clear(editPriceInput);
    await userEvent.type(editPriceInput, '40');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Editar producto' })).not.toBeInTheDocument();
    });
    expect(mockApiRequest).toHaveBeenCalledWith(
      '/api/v1/inventory/products/p-1',
      expect.objectContaining({ method: 'PATCH' })
    );

    // Modal 3: Deactivate product
    const toggleBtn = screen.getByLabelText('Desactivar Suero 500ml');
    await userEvent.click(toggleBtn);
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar desactivación' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '¿Desactivar producto?' })).not.toBeInTheDocument();
    });
    expect(mockApiRequest).toHaveBeenCalledWith(
      '/api/v1/inventory/products/p-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ is_active: false }),
      })
    );
  });
});
