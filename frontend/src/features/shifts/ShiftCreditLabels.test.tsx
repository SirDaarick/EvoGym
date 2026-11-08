import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { Shifts } from './Shifts';

describe('shift summary with saldo a favor', () => {
  it('labels the credit method and activity family without breaking', async () => {
    const register = { id: 'register-1', branch_id: 'branch-1', code: 'front', name: 'Recepción', status: 'active', has_open_shift: true };
    const shift = {
      id: 'shift-1', cash_register_id: register.id, opened_by: 'admin-1', opened_at: '2026-10-26T14:00:00Z', closed_at: null,
      status: 'open', opening_cash_minor: 50000, denomination_counts: [], closing_denomination_counts: [], inventory_review: null,
      expected_cash_at_close_minor: null, current_expected_cash_minor: 50000, counted_cash_minor: null, difference_minor: null, closing_notes: null,
    };
    const request = vi.fn(async (path: string) => {
      if (path === '/api/v1/registers') return new Response(JSON.stringify([register]));
      if (path.startsWith('/api/v1/shifts?')) return new Response(JSON.stringify({ items: [shift], total: 1, offset: 0, limit: 100 }));
      if (path.startsWith('/api/v1/shifts/current?')) return new Response(JSON.stringify(shift));
      if (path.endsWith('/summary')) return new Response(JSON.stringify({
        shift_id: shift.id, confirmed_minor: 3000, confirmed_cash_minor: 1000, pending_transfer_minor: 0,
        payment_methods: [{ method: 'cash', count: 1, amount_minor: 1000 }, { method: 'credit', count: 1, amount_minor: 2000 }],
        activities: [{ family: 'credit', count: 1, amount_minor: 2000 }],
        payments: [{ id: 'p1', description: 'Pago con saldo', method: 'credit', status: 'confirmed', amount_minor: 2000, recorded_at: '2026-10-26T15:00:00Z' }],
        expected_cash_minor: 51000, expense_minor: 0, expense_count: 0, extra_minor: 0,
      }));
      if (path.startsWith('/api/v1/inventory/')) return new Response(JSON.stringify({ items: [], total: 0 }));
      return new Response('{}');
    });
    render(<MemoryRouter><Shifts role="OWNER" apiRequest={request} actorId="admin-1" actorName="Admin" /></MemoryRouter>);
    expect((await screen.findAllByText('Saldo a favor')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Saldo a favor recibido/).length).toBeGreaterThan(0);
  });
});
