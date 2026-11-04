import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { renderWithQuery } from '@/test/renderWithQuery';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ weekday: 0, request: null as unknown, session: null as unknown }));
vi.mock('../auth/AdminSessionProvider', () => ({ useAdminSession: () => state.session }));
vi.mock('../../api/payrollApi', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/payrollApi')>()),
  branchPayrollDate: () => ({ weekStart: '2026-10-26', weekday: state.weekday }),
}));
import { ApiStaffManagement } from './StaffManagement';

const branch = '00000000-0000-4000-8000-000000000001';
const profile = '11111111-1111-4111-8111-111111111111';

describe('payroll actions', () => {
  it('keeps an advance input on failure, then refreshes the remaining net', async () => {
    const user = userEvent.setup();
    state.weekday = 0;
    let advances = 0;
    let first = true;
    state.request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.endsWith('/branches')) return new Response(JSON.stringify({ branches: [{ id: branch, code: 's', name: 'Sur', timezone: 'America/Mexico_City' }] }));
      if (path.includes('/roster-profiles')) return new Response(JSON.stringify({ profiles: [{ id: profile, full_name: 'Lucia', position: 'Staff', is_active: true, staff_user_id: null, monthly_salary_minor: 1400000 }] }));
      if (path.includes('/admin/staff-accounts?')) return new Response(JSON.stringify({ accounts: [] }));
      if (path.includes('/payroll/weeks/')) return new Response(JSON.stringify({ items: [{ profile_id: profile, full_name: 'Lucia', base_minor: 350000, advances_minor: advances, net_minor: 350000 - advances, daily_minor: 70000, paid: null }] }));
      if (path.endsWith('/payroll/advances')) {
        if (first) { first = false; return new Response('{}', { status: 422 }); }
        advances = JSON.parse(init?.body as string).amount_minor;
        return new Response('{}', { status: 201 });
      }
      return new Response('', { status: 404 });
    });
    state.session = { status: 'authenticated', request: state.request };
    renderWithQuery(<MemoryRouter><ApiStaffManagement /></MemoryRouter>);
    await screen.findByText(/Sur/);
    await user.selectOptions(screen.getByLabelText('Sucursal'), branch);
    await user.click(await screen.findByRole('button', { name: 'Adelantar' }));
    await user.type(screen.getByLabelText('Importe'), '500');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('Importe')).toHaveValue('500');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(screen.getByText('Pendiente $3,000.00 netos')).toBeInTheDocument());
  });

  it('marks the week paid after confirmation', async () => {
    const user = userEvent.setup();
    state.weekday = 4;
    let paid = false;
    state.request = vi.fn(async (path: string) => {
      if (path.endsWith('/branches')) return new Response(JSON.stringify({ branches: [{ id: branch, code: 's', name: 'Sur', timezone: 'America/Mexico_City' }] }));
      if (path.includes('/roster-profiles')) return new Response(JSON.stringify({ profiles: [{ id: profile, full_name: 'Lucia', position: 'Staff', is_active: true, staff_user_id: null, monthly_salary_minor: 1400000 }] }));
      if (path.includes('/admin/staff-accounts?')) return new Response(JSON.stringify({ accounts: [] }));
      if (path.includes('/payroll/weeks/')) return new Response(JSON.stringify({ items: [{ profile_id: profile, full_name: 'Lucia', base_minor: 350000, advances_minor: 50000, net_minor: 300000, daily_minor: 70000, paid: paid ? { payment_method: 'transfer', paid_at: '2026-10-30T12:00:00Z' } : null }] }));
      if (path.endsWith('/payroll/payments')) { paid = true; return new Response('{}', { status: 201 }); }
      return new Response('', { status: 404 });
    });
    state.session = { status: 'authenticated', request: state.request };
    renderWithQuery(<MemoryRouter><ApiStaffManagement /></MemoryRouter>);
    await screen.findByText(/Sur/);
    await user.selectOptions(screen.getByLabelText('Sucursal'), branch);
    await user.click(await screen.findByRole('button', { name: 'Pagar $3,000.00' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Pagado $3,000.00 + $500.00 (adelanto)')).toBeInTheDocument();
  });
});
