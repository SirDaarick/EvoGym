import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AdminAuthClient } from '../../api/adminAuthApi';
import { AdminAccessApp } from './AdminAccessApp';

const branchA = '123e4567-e89b-42d3-a456-426614174000';
const branchB = '123e4567-e89b-42d3-a456-426614174010';
const profileA = '123e4567-e89b-42d3-a456-426614174001';
const profileA2 = '123e4567-e89b-42d3-a456-426614174003';
const profileB = '123e4567-e89b-42d3-a456-426614174011';
const staffId = '123e4567-e89b-42d3-a456-426614174002';
const staffId2 = '123e4567-e89b-42d3-a456-426614174004';

function response(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' } });
}

function makeFetch(overrides: { profilesLinked?: boolean; delayedPin?: Promise<Response>; isOwner?: boolean } = {}) {
  let linked = overrides.profilesLinked ?? false;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/v1/auth/refresh') return response(200, {
      access_token: 'admin-session-secret', token_type: 'bearer', expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    if (url.pathname === '/api/v1/admin/role-management/me') return response(200, {
      staff_id: staffId, is_owner: overrides.isOwner ?? false, can_manage_employees: !overrides.isOwner,
    });
    if (url.pathname === '/api/v1/admin/role-management/staff') return response(200, { staff: [
      { id: staffId, login_identifier: 'owner@example.test', is_admin: true, can_be_admin: true, reception_branch_ids: [], is_owner: true },
      { id: staffId2, login_identifier: 'employee@example.test', is_admin: false, can_be_admin: true, reception_branch_ids: [], is_owner: false },
    ] });
    if (url.pathname === '/api/v1/admin/role-management/branches') return response(200, { branches: [
      { id: branchA, code: 'north', name: 'North' },
    ] });
    if (url.pathname === '/api/v1/admin/role-management/bundles') return response(200, { bundles: [], permissions: ['members:read'] });
    if (url.pathname === '/api/v1/admin/role-management/assignments') return response(200, { assignments: [] });
    if (url.pathname === '/api/v1/admin/security-alerts') return response(200, { alerts: [], next_cursor: null });
    if (url.pathname.endsWith('/acknowledge')) return response(200, {
      id: url.pathname.split('/').at(-2), acknowledged_at: new Date().toISOString(), acknowledged_by: staffId,
    });
    if (url.pathname === '/api/v1/admin/staff-accounts/branches') return response(200, { branches: [
      { id: branchA, code: 'north', name: 'North' }, { id: branchB, code: 'south', name: 'South' },
    ] });
    if (url.pathname === '/api/v1/admin/staff-accounts/reception-stations') return response(200, { stations: [] });
    if (url.pathname.endsWith('/roster-profiles')) {
      const isSouth = url.searchParams.get('branch_id') === branchB;
      return response(200, { profiles: isSouth ? [{ id: profileB,
        full_name: 'Employee South', position: 'Coach', is_active: true, staff_user_id: staffId }] : [{ id: profileA,
        full_name: isSouth ? 'Employee South' : 'Employee North', position: 'Coach', is_active: true,
        staff_user_id: linked ? staffId : null }, { id: profileA2, full_name: 'Employee North Two', position: 'Coach',
        is_active: true, staff_user_id: linked ? staffId2 : null }] });
    }
    if (url.pathname === '/api/v1/admin/staff-accounts' && init?.method !== 'POST') return response(200, { accounts: [
      { id: staffId, login_identifier: 'employee@example.test', is_active: true,
        link_state: linked ? 'linked' : 'unlinked', linked_profile_id: linked ? profileA : null },
      { id: staffId2, login_identifier: 'employee.two@example.test', is_active: true,
        link_state: linked ? 'linked' : 'unlinked', linked_profile_id: linked ? profileA2 : null },
    ] });
    if (url.pathname.endsWith('/link')) {
      linked = true;
      return response(200, { profile_id: profileA, staff_user_id: staffId, link_state: 'linked' });
    }
    if (url.pathname.endsWith('/initial-pin')) return overrides.delayedPin ?? response(200, { initial_pin: '004207' });
    if (url.pathname === '/api/v1/auth/logout') return response(204);
    throw new Error(`Unexpected synthetic request: ${url.pathname}`);
  });
}

function mount(fetchImpl: ReturnType<typeof makeFetch>) {
  const client = new AdminAuthClient({ apiOrigin: 'https://api.example.test', fetchImpl });
  return render(<MemoryRouter><AdminAccessApp client={client} /></MemoryRouter>);
}

describe('Admin employee PIN integration', () => {
  it('mounts lockout alerts only when the server reports employee-management capability', async () => {
    mount(makeFetch());
    expect(await screen.findByRole('region', { name: 'Employee lockout alerts' })).toBeTruthy();
  });

  it('does not mount lockout alerts for an Admin without employee-management capability', async () => {
    mount(makeFetch({ isOwner: true }));
    expect(await screen.findByRole('region', { name: 'Owner management' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Employee lockout alerts' })).toBeNull();
  });

  it('requires an explicit account link, then displays and dismisses the PIN once', async () => {
    const fetchImpl = makeFetch();
    mount(fetchImpl);
    await screen.findByRole('heading', { name: 'Employee PIN management' });
    await waitFor(() => expect(screen.getByRole('option', { name: 'North (north)' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: branchA } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Employee North — Coach' })).toBeInTheDocument());
    fireEvent.change(await screen.findByLabelText('Employee profile'), { target: { value: profileA } });
    expect(screen.getByText(/has no linked login account/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Link selected account' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Existing employee account'), { target: { value: staffId } });
    fireEvent.click(screen.getByRole('button', { name: 'Link selected account' }));
    expect(await screen.findByText(/Linked account: employee@example.test/)).toBeInTheDocument();
    expect(fetchImpl.mock.calls.filter(([input]) => String(input).includes('/link'))).toHaveLength(1);
    expect(screen.getByText(/ends the employee’s active sessions/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Issue or reset initial PIN' }));
    expect(await screen.findByLabelText('Temporary employee PIN')).toHaveTextContent('004207');
    expect(screen.getAllByText(/expires after 7 days/)).toHaveLength(2);
    expect(window.location.href).not.toContain('004207');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss PIN' }));
    expect(screen.queryByLabelText('Temporary employee PIN')).not.toBeInTheDocument();
  });

  it('shows owner controls only after the authenticated server reports owner status', async () => {
    const nonOwner = makeFetch();
    mount(nonOwner);
    await screen.findByRole('heading', { name: 'Employee PIN management' });
    expect(screen.queryByRole('region', { name: 'Owner management' })).not.toBeInTheDocument();

    const owner = makeFetch({ isOwner: true });
    mount(owner);
    expect(await screen.findByRole('region', { name: 'Owner management' })).toBeInTheDocument();
    expect((await screen.findAllByRole('option', { name: 'employee@example.test' })).length).toBeGreaterThan(0);
    expect(owner.mock.calls.some(([input]) => String(input).includes('/role-management/staff'))).toBe(true);
  });

  it('does not reveal a PIN returned after changing the selected branch', async () => {
    let resolvePin!: (value: Response) => void;
    const delayedPin = new Promise<Response>(resolve => { resolvePin = resolve; });
    const fetchImpl = makeFetch({ profilesLinked: true, delayedPin });
    mount(fetchImpl);
    await screen.findByRole('heading', { name: 'Employee PIN management' });
    await waitFor(() => expect(screen.getByRole('option', { name: 'North (north)' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: branchA } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Employee North — Coach' })).toBeInTheDocument());
    fireEvent.change(await screen.findByLabelText('Employee profile'), { target: { value: profileA } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue or reset initial PIN' }));
    await waitFor(() => expect(fetchImpl.mock.calls.some(([input]) => String(input).endsWith('/initial-pin'))).toBe(true));
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: branchB } });
    resolvePin(response(200, { initial_pin: '990011' }));
    await waitFor(() => expect(screen.queryByLabelText('Temporary employee PIN')).not.toBeInTheDocument());
    expect(document.body).not.toHaveTextContent('990011');
  });

  it('does not reveal a PIN returned after changing the selected profile', async () => {
    let resolvePin!: (value: Response) => void;
    const delayedPin = new Promise<Response>(resolve => { resolvePin = resolve; });
    const fetchImpl = makeFetch({ profilesLinked: true, delayedPin });
    mount(fetchImpl);
    await screen.findByRole('heading', { name: 'Employee PIN management' });
    await waitFor(() => expect(screen.getByRole('option', { name: 'North (north)' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: branchA } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Employee North Two — Coach' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Employee profile'), { target: { value: profileA } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue or reset initial PIN' }));
    await waitFor(() => expect(fetchImpl.mock.calls.some(([input]) => String(input).endsWith('/initial-pin'))).toBe(true));
    fireEvent.change(screen.getByLabelText('Employee profile'), { target: { value: profileA2 } });
    resolvePin(response(200, { initial_pin: '771122' }));
    await waitFor(() => expect(screen.queryByLabelText('Temporary employee PIN')).not.toBeInTheDocument());
    expect(document.body).not.toHaveTextContent('771122');
  });

  it('clears the one-time PIN when the Admin session ends', async () => {
    const fetchImpl = makeFetch({ profilesLinked: true });
    mount(fetchImpl);
    await screen.findByRole('heading', { name: 'Employee PIN management' });
    await waitFor(() => expect(screen.getByRole('option', { name: 'North (north)' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: branchA } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Employee North — Coach' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Employee profile'), { target: { value: profileA } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue or reset initial PIN' }));
    expect(await screen.findByLabelText('Temporary employee PIN')).toHaveTextContent('004207');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByLabelText('Username')).toBeInTheDocument();
    expect(screen.queryByLabelText('Temporary employee PIN')).not.toBeInTheDocument();
  });

  it('does not reveal a PIN response that arrives after logout', async () => {
    let resolvePin!: (value: Response) => void;
    const delayedPin = new Promise<Response>(resolve => { resolvePin = resolve; });
    const fetchImpl = makeFetch({ profilesLinked: true, delayedPin });
    mount(fetchImpl);
    await screen.findByRole('heading', { name: 'Employee PIN management' });
    await waitFor(() => expect(screen.getByRole('option', { name: 'North (north)' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: branchA } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Employee North — Coach' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Employee profile'), { target: { value: profileA } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue or reset initial PIN' }));
    await waitFor(() => expect(fetchImpl.mock.calls.some(([input]) => String(input).endsWith('/initial-pin'))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByLabelText('Username')).toBeInTheDocument();
    resolvePin(response(200, { initial_pin: '882233' }));
    await waitFor(() => expect(document.body).not.toHaveTextContent('882233'));
    expect(screen.queryByLabelText('Temporary employee PIN')).not.toBeInTheDocument();
  });
});
