import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { RootApp } from './RootApp';

const id = '123e4567-e89b-42d3-a456-426614174000';
const response = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' } });
const identity = { id, kind: 'employee', display_name: 'Ana Perez', is_owner: false, can_manage_employees: false,
  branch_profiles: [{ profile_id: id, branch_id: id, branch_name: 'Centro' }] };
const adminId = '223e4567-e89b-42d3-a456-426614174000';

describe('RootApp product access boundary', () => {
  beforeEach(() => {
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test');
    window.history.replaceState({}, '', '/');
  });

  it('uses the existing selector for the normal route and never mounts the demo provider', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/auth/refresh') return response(401);
      if (path === '/api/v1/auth/profile-access/context') return response(200, { identities: [identity] });
      throw new Error(`Unexpected request: ${path}`);
    }));
    render(<MemoryRouter><RootApp /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Elige tu perfil' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Ana Perez/ })).toBeInTheDocument();
    expect(screen.queryByTestId('demo-provider')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mikel/ })).not.toBeInTheDocument();
  });

  it('redirects direct operational URLs to the same entry instead of inferring a role from the URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/auth/refresh') return response(401);
      if (path === '/api/v1/auth/profile-access/context') return response(401);
      throw new Error(`Unexpected request: ${path}`);
    }));
    render(<MemoryRouter initialEntries={['/owner/overview']}><RootApp /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Elige tu perfil' })).toBeInTheDocument();
    expect(screen.queryByText('Legacy app')).not.toBeInTheDocument();
  });

  it('shows P1 management navigation only from the server-returned Admin capabilities', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/auth/refresh') return response(200, { access_token: 'x'.repeat(43), token_type: 'bearer', expires_at: new Date(Date.now() + 3600000).toISOString() });
      if (path === '/api/v1/admin/profile-access/choices') return response(200, { current_identity_id: adminId, identities: [
        { id: adminId, kind: 'admin', display_name: 'Admin Evo', is_owner: false, can_manage_employees: true, branch_profiles: [] }, identity,
      ] });
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<MemoryRouter><RootApp /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Admin Evo · Admin' }));
    expect(await screen.findByRole('heading', { name: 'Resumen del negocio' })).toBeInTheDocument();
    expect(screen.getByTestId('application-shell')).toHaveClass('app-shell');
    expect(screen.getAllByLabelText('Navegación principal')[0].querySelector('.sidebar-icon')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Usar tema/ })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Personal' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Alertas' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Permisos' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Turno/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turno · No disponible' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/PIN de seis dígitos para Admin/)).not.toBeInTheDocument();
  });

  it('preserves authenticated Admin choice cards when changing profiles without logout', async () => {
    const adminChoice = { id: adminId, kind: 'admin', display_name: 'Admin Evo', is_owner: false, can_manage_employees: true, branch_profiles: [] };
    const paths: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      if (path === '/api/v1/auth/refresh') return response(200, { access_token: 'x'.repeat(43), token_type: 'bearer', expires_at: new Date(Date.now() + 3600000).toISOString() });
      if (path === '/api/v1/admin/profile-access/choices') return response(200, { current_identity_id: adminId, identities: [adminChoice, identity] });
      throw new Error(`Unexpected request: ${path}`);
    }));
    render(<MemoryRouter><RootApp /></MemoryRouter>);
    const adminCard = await screen.findByRole('button', { name: 'Admin Evo · Admin' });
    expect(screen.getByRole('button', { name: 'Ana Perez · Personal' })).toBeInTheDocument();
    fireEvent.click(adminCard);
    expect(await screen.findByRole('heading', { name: 'Resumen del negocio' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar perfil' }));
    expect(await screen.findByRole('button', { name: 'Admin Evo · Admin' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ana Perez · Personal' })).toBeInTheDocument();
    await waitFor(() => expect(paths.filter(path => path === '/api/v1/admin/profile-access/choices')).toHaveLength(2));
    expect(paths.some(path => path.includes('/logout'))).toBe(false);
  });
  it('enters a paired employee only after PIN and provides full application operational access', async () => {
    localStorage.clear(); sessionStorage.clear();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/auth/refresh') return response(401);
      if (path === '/api/v1/auth/profile-access/context') return response(200, { identities: [identity] });
      if (path === '/api/v1/auth/profile-access/sessions') return response(201, { access_token: 's'.repeat(43), token_type: 'bearer',
        expires_at: new Date(Date.now() + 1800000).toISOString(), identity: { id }, profile: { id, branch_id: id }, purpose: 'reception' });
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<MemoryRouter><RootApp /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Ana Perez/ }));
    fireEvent.change(screen.getByLabelText('Ingresa el PIN de seis dígitos para Ana Perez'), { target: { value: '123456' } });
    expect(await screen.findByRole('heading', { name: 'Función no disponible' })).toBeInTheDocument();
    expect(screen.getByText('Ana Perez')).toBeInTheDocument();
    expect(screen.queryByText('Productos disponibles')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Socios/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Socios · No disponible' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Permisos' })).not.toBeInTheDocument();
    expect(Array.from({ length: localStorage.length }, (_, index) => localStorage.getItem(localStorage.key(index)!)).join(' ')).not.toContain('s'.repeat(43));
    expect(Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.getItem(sessionStorage.key(index)!)).join(' ')).not.toContain('s'.repeat(43));
    expect(document.body).not.toHaveTextContent('s'.repeat(43));
    expect(fetchImpl.mock.calls.some(call => String(call[0]).endsWith('/admin/profile-access/sessions'))).toBe(false);
  });

  it('preserves paired proof when an employee profile exits and requires a PIN on re-entry', async () => {
    let paired = false;
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ path: url.pathname, init });
      if (url.pathname === '/api/v1/auth/refresh') return response(401);
      if (url.pathname === '/api/v1/auth/profile-access/pair') {
        paired = true;
        return response(200, { status: 'paired' });
      }
      if (url.pathname === '/api/v1/auth/profile-access/context') return response(200, { identities: paired ? [identity] : [] });
      if (url.pathname === '/api/v1/auth/profile-access/sessions') return response(201, { access_token: 's'.repeat(43), token_type: 'bearer',
        expires_at: new Date(Date.now() + 1800000).toISOString(), identity: { id }, profile: { id, branch_id: id }, purpose: 'reception' });
      if (url.pathname === '/api/v1/auth/profile-access/sessions/logout') {
        return response(204);
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<MemoryRouter><RootApp /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: 'Vincular dispositivo con código' }));
    fireEvent.change(screen.getByLabelText('Código de vinculación de seis dígitos'), { target: { value: '123456' } });
    expect(await screen.findByRole('button', { name: /Ana Perez/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mikel|Luis|Admin Evo/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ana Perez/ }));
    fireEvent.change(screen.getByLabelText('Ingresa el PIN de seis dígitos para Ana Perez'), { target: { value: '123456' } });
    expect(await screen.findByRole('heading', { name: 'Función no disponible' })).toBeInTheDocument();
    expect(screen.getByText('Ana Perez')).toBeInTheDocument();
    expect(screen.queryByText('Productos disponibles')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar perfil' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Elige tu perfil' })).toBeInTheDocument());
    expect(await screen.findByRole('button', { name: 'Ana Perez · Personal' })).toBeInTheDocument();
    const logout = calls.find(call => call.path === '/api/v1/auth/profile-access/sessions/logout');
    expect(logout?.init).toEqual(expect.objectContaining({ method: 'POST', body: '{}', headers: expect.objectContaining({ Authorization: `Bearer ${'s'.repeat(43)}` }) }));
    expect(calls.some(call => call.path === '/api/v1/auth/profile-access/logout')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Ana Perez · Personal' }));
    expect(await screen.findByLabelText('Ingresa el PIN de seis dígitos para Ana Perez')).toBeInTheDocument();
    const contextCalls = calls.filter(call => call.path === '/api/v1/auth/profile-access/context');
    expect(contextCalls.length).toBeGreaterThanOrEqual(2);
    expect(contextCalls.every(call => call.init?.credentials === 'include')).toBe(true);
    expect(calls.find(call => call.path === '/api/v1/auth/profile-access/pair')?.init).toEqual(expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify({ pairing_code: '123456' }) }));
    expect(calls.find(call => call.path === '/api/v1/auth/profile-access/sessions')?.init).toEqual(expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify({ profile_id: id, branch_id: id, pin: '123456' }) }));
  });

  it('allows seamless access to demo mode from StaffProfileSelection without a live backend', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/auth/refresh') return response(401);
      if (path === '/api/v1/auth/profile-access/context') return response(401);
      throw new Error(`Unexpected request: ${path}`);
    }));
    render(<MemoryRouter><RootApp /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Elige tu perfil' })).toBeInTheDocument();
    const demoButton = screen.getByRole('button', { name: 'Continuar con datos locales (Modo Demo)' });
    expect(demoButton).toBeInTheDocument();
    fireEvent.click(demoButton);
    expect(screen.queryByText('Productos disponibles')).not.toBeInTheDocument();
  });

  it('preserves explicit Admin email-link handling without exposing the URL token', async () => {
    const token = 'a'.repeat(43);
    window.history.replaceState({}, '', `/admin?approval_token=${token}`);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(204)));
    render(<MemoryRouter initialEntries={[`/admin?approval_token=${token}`]}><RootApp /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Approve Admin device' })).toBeInTheDocument();
    expect(window.location.search).toBe('');
    expect(document.body).not.toHaveTextContent(token);
  });

  it('keeps the public first-PIN-change flow outside the product shell', async () => {
    const fetchImpl = vi.fn(); vi.stubGlobal('fetch', fetchImpl);
    render(<MemoryRouter initialEntries={['/staff/first-pin-change']}><RootApp /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Change your initial PIN' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('missing valid branch context');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
