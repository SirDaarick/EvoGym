import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { History } from './History';

const item = (id: string, over = {}) => ({
  id, occurred_at: '2026-10-01T15:00:00Z', category: 'membership', branch_id: 'b1', shift_id: null, description: `Mov ${id}`,
  detail: 'Detalle', status: 'confirmed', amount_minor: 50000, method: 'cash', actor_id: 'a', actor_name: 'Ana',
  member_id: null, member_name: null, ...over,
});
const period = { from: '2026-10-01', to: '2026-10-02', timezone: 'America/Mexico_City' };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('live history', () => {
  it('loads, paginates by cursor and filters without a demo provider', async () => {
    const request = vi.fn(async (path: string) => {
      const url = new URL(path, 'http://x');
      if (url.searchParams.get('cursor') === 'c1') return json({ period, items: [item('p2')], next_cursor: null });
      if (url.searchParams.get('category') === 'shift') return json({ period, items: [], next_cursor: null });
      return json({ period, items: [item('p1')], next_cursor: 'c1' });
    });
    render(<MemoryRouter><History apiRequest={request} /></MemoryRouter>);
    expect(await screen.findByText('Mov p1')).toBeVisible();
    expect(String(request.mock.calls[0][0])).not.toContain('from=');
    expect(screen.getByLabelText('Desde')).toHaveValue('2026-10-01');
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(await screen.findByText('Mov p2')).toBeVisible();
    expect(screen.getByText('Mov p1')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument();
    const loadMoreCall = new URL(String(request.mock.calls[1][0]), 'http://x');
    expect(loadMoreCall.searchParams.get('cursor')).toBe('c1');
    expect(loadMoreCall.searchParams.get('from')).toBe('2026-10-01');
    fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: 'shift' } });
    expect(await screen.findByText('Sin movimientos para estos filtros')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Método'), { target: { value: 'card' } });
    await waitFor(() => expect(request.mock.calls.some(call => String(call[0]).includes('method=card'))).toBe(true));
  });

  it('reports failures and invalid periods', async () => {
    const request = vi.fn(async () => new Response(null, { status: 503 }));
    render(<MemoryRouter><History apiRequest={request} /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar el historial');
  });

  it('does not query for an invalid period', async () => {
    const request = vi.fn(async () => json({ period, items: [item('p1')], next_cursor: null }));
    render(<MemoryRouter><History apiRequest={request} /></MemoryRouter>);
    await screen.findByText('Mov p1');
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-09-01' } });
    expect(screen.getByText(/Selecciona fechas válidas/)).toBeVisible();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
