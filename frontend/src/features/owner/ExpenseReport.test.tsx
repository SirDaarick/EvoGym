import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../../api/membershipCheckoutApi';
import type { PendingMoneyItemDTO } from '../../api/pendingMoneyApi';
import { ExpenseReport } from './ExpenseReport';

const transferItemCentro: PendingMoneyItemDTO = {
  item_type: 'pending_transfer',
  source_event_id: 'pay-tx-101',
  source_event_at: '2026-10-28T10:00:00Z',
  order_id: 'ord-tx-101',
  member_id: 'mem-101',
  member_number: 'EVO-0101',
  member_name: 'Sofía Delgado',
  branch_id: 'branch-centro',
  branch_name: 'EvoGym Centro',
  amount_minor: 75000,
  initial_amount_minor: null,
  paid_amount_minor: null,
  currency: 'MXN',
  status: 'under_review',
  status_event_id: null,
  status_event_at: null,
};

const debtItemNorte: PendingMoneyItemDTO = {
  item_type: 'membership_debt',
  source_event_id: 'debt-202',
  source_event_at: '2026-10-28T09:00:00Z',
  order_id: 'ord-202',
  member_id: 'mem-202',
  member_number: 'EVO-0202',
  member_name: 'Carlos Rivera',
  branch_id: 'branch-norte',
  branch_name: 'EvoGym Norte',
  amount_minor: 30000,
  initial_amount_minor: 50000,
  paid_amount_minor: 20000,
  currency: 'MXN',
  status: 'open',
  status_event_id: null,
  status_event_at: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ExpenseReport live pending money integration (F07-F02, F07-F03)', () => {
  it('F07-F02: renders pending transfers and membership debts, filters by branch, and confirms transfer updating total', async () => {
    const user = userEvent.setup();
    let currentItems: PendingMoneyItemDTO[] = [transferItemCentro, debtItemNorte];
    const requestedPaths: string[] = [];

    const apiRequestMock = vi.fn(async (path: string, init?: RequestInit) => {
      requestedPaths.push(`${init?.method ?? 'GET'} ${path}`);
      if (path.startsWith('/api/v1/admin/pending-money')) {
        const url = new URL(path, 'http://localhost');
        const branchId = url.searchParams.get('branch_id');
        const filtered = branchId
          ? currentItems.filter(item => item.branch_id === branchId)
          : currentItems;
        return jsonResponse({
          items: filtered,
          total_pending_minor: filtered.reduce((sum, item) => sum + item.amount_minor, 0),
          currency: 'MXN',
        });
      }
      if (path === '/api/v1/registers/transfer-payments/pay-tx-101/review' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { status: string };
        expect(body.status).toBe('confirmed');
        currentItems = [debtItemNorte];
        return jsonResponse({
          payment_id: 'pay-tx-101',
          order_id: 'ord-tx-101',
          payment_status: 'confirmed',
          order_status: 'paid',
          subscription_status: 'active',
          replayed: false,
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <MemoryRouter initialEntries={['/owner/expenses?tab=cobros']}>
        <ExpenseReport apiRequest={apiRequestMock as unknown as AuthenticatedRequest} />
      </MemoryRouter>,
    );

    const pendingHeading = await screen.findByRole('heading', { name: 'Transferencias pendientes' });
    const pendingPanel = pendingHeading.closest('section')!;

    await waitFor(() => {
      expect(within(pendingPanel).getByText('$1,050.00 MXN')).toBeInTheDocument();
    });
    expect(within(pendingPanel).getByText(/Sofía Delgado \(EVO-0101\)/i)).toBeInTheDocument();
    expect(within(pendingPanel).getByText(/Carlos Rivera \(EVO-0202\)/i)).toBeInTheDocument();
    expect(within(pendingPanel).getByText('En revisión')).toBeInTheDocument();
    expect(within(pendingPanel).getByText('Adeudo pendiente')).toBeInTheDocument();

    const branchSelect = within(pendingPanel).getByLabelText('Sucursal');
    await user.selectOptions(branchSelect, 'branch-centro');

    await waitFor(() => {
      expect(requestedPaths).toContain('GET /api/v1/admin/pending-money?branch_id=branch-centro');
      expect(within(pendingPanel).queryByText(/Carlos Rivera/i)).not.toBeInTheDocument();
    });
    expect(within(pendingPanel).getAllByText('$750.00 MXN')).toHaveLength(2);

    await user.selectOptions(branchSelect, 'ALL');
    await waitFor(() => {
      expect(within(pendingPanel).getByText('$1,050.00 MXN')).toBeInTheDocument();
    });

    const confirmButton = within(pendingPanel).getByRole('button', { name: 'Confirmar transferencia' });
    await user.click(confirmButton);

    await waitFor(() => {
      expect(within(pendingPanel).queryByText(/Sofía Delgado/i)).not.toBeInTheDocument();
    });
    expect(within(pendingPanel).getAllByText('$300.00 MXN')).toHaveLength(2);
    expect(within(pendingPanel).getByText(/Carlos Rivera \(EVO-0202\)/i)).toBeInTheDocument();
  });

  it('F07-F03: flags missing funds (under_review -> pending), allows subsequent confirmation, and surfaces 409 Conflict errors', async () => {
    const user = userEvent.setup();
    let transferStatus: 'under_review' | 'pending' | 'confirmed' = 'under_review';
    let shouldFailNextReview = false;

    const apiRequestMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/api/v1/admin/pending-money')) {
        const items: PendingMoneyItemDTO[] =
          transferStatus === 'confirmed'
            ? []
            : [{ ...transferItemCentro, status: transferStatus }];
        return jsonResponse({
          items,
          total_pending_minor: items.reduce((sum, item) => sum + item.amount_minor, 0),
          currency: 'MXN',
        });
      }
      if (path === '/api/v1/registers/transfer-payments/pay-tx-101/review' && init?.method === 'POST') {
        if (shouldFailNextReview) {
          return jsonResponse({ detail: 'Transfer payment has already been confirmed' }, 409);
        }
        const body = JSON.parse(String(init.body)) as { status: 'confirmed' | 'pending' };
        transferStatus = body.status;
        return jsonResponse({
          payment_id: 'pay-tx-101',
          order_id: 'ord-tx-101',
          payment_status: body.status,
          order_status: body.status === 'confirmed' ? 'paid' : 'pending_payment',
          subscription_status: body.status === 'confirmed' ? 'active' : 'pending_activation',
          replayed: false,
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <MemoryRouter initialEntries={['/owner/expenses']}>
        <ExpenseReport apiRequest={apiRequestMock as unknown as AuthenticatedRequest} />
      </MemoryRouter>,
    );

    const pendingHeading = await screen.findByRole('heading', { name: 'Transferencias pendientes' });
    const pendingPanel = pendingHeading.closest('section')!;

    await waitFor(() => {
      expect(within(pendingPanel).getByText('En revisión')).toBeInTheDocument();
    });

    const flagMissingButton = within(pendingPanel).getByRole('button', { name: 'Marcar sin fondos' });
    await user.click(flagMissingButton);

    await waitFor(() => {
      expect(within(pendingPanel).getByText('Fondos pendientes')).toBeInTheDocument();
    });
    expect(within(pendingPanel).queryByRole('button', { name: 'Marcar sin fondos' })).not.toBeInTheDocument();
    expect(within(pendingPanel).getAllByText('$750.00 MXN')).toHaveLength(2);

    shouldFailNextReview = true;
    const confirmButton = within(pendingPanel).getByRole('button', { name: 'Confirmar transferencia' });
    await user.click(confirmButton);

    const alert = await within(pendingPanel).findByRole('alert');
    expect(alert).toHaveTextContent('Transfer payment has already been confirmed');

    shouldFailNextReview = false;
    await user.click(confirmButton);

    await waitFor(() => {
      expect(within(pendingPanel).getByText('$0.00 MXN')).toBeInTheDocument();
      expect(within(pendingPanel).getByText('No hay transferencias pendientes con estos filtros.')).toBeInTheDocument();
    });
  });
});
