import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfileEntrySession } from '../api/profileAccessApi';
import { ProductRoutes } from './ProductRoutes';

const { access, adminSession, demoMounted } = vi.hoisted(() => ({
  access: { principal: null as null | { kind: 'admin' | 'employee'; identity: { id?: string; display_name?: string; is_owner: boolean; can_manage_employees: boolean }; session?: { purpose: string } }, loading: false, error: '', listeners: new Set<() => void>(), reload: vi.fn(async () => {}), leaveProfile: vi.fn(async () => {}), unlinkPairedDevice: vi.fn(async () => {}), exit: vi.fn(async () => {}) },
  adminSession: { status: 'unauthenticated' as string, request: vi.fn(async (_path: string, _init?: RequestInit) => new Response('{}')) },
  demoMounted: vi.fn(),
}));
const receptionSession: ProfileEntrySession = {
  accessToken: 's'.repeat(43), expiresAt: Date.now() + 3600000, purpose: 'reception',
  identityId: '223e4567-e89b-42d3-a456-426614174000',
  profileId: '323e4567-e89b-42d3-a456-426614174000',
  branchId: '423e4567-e89b-42d3-a456-426614174000',
};

vi.mock('../features/auth/ProductAccessProvider', async () => {
  const React = await import('react');
  return { useProductAccess: () => {
    const [, rerender] = React.useState(0);
    React.useEffect(() => {
      const listener = () => rerender(value => value + 1);
      access.listeners.add(listener);
      return () => { access.listeners.delete(listener); };
    }, []);
    return access;
  } };
});
vi.mock('../features/auth/AdminSessionProvider', () => ({
  useAdminSession: () => adminSession,
  useOptionalAdminSession: () => adminSession.status === 'authenticated' ? adminSession : null,
}));
vi.mock('../demo/DemoProvider', () => ({
  DemoProvider: ({ children }: { children: React.ReactNode }) => { demoMounted(); return <div data-testid="demo-provider">{children}</div>; },
}));
vi.mock('./App', () => ({ App: () => <div>Demo business app</div> }));
vi.mock('../features/staff/StaffProfileSelection', () => ({ StaffProfileSelection: () => <div>Profile selection</div> }));

describe('ProductRoutes mode boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    window.sessionStorage.clear();
    access.principal = null;
    access.reload.mockClear();
    access.leaveProfile.mockClear();
    access.exit.mockClear();
    access.unlinkPairedDevice.mockClear();
    access.loading = false;
    access.error = '';
    access.listeners.clear();
    adminSession.status = 'unauthenticated';
  });

  it('keeps stale demo storage from mounting local state for an API principal', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    window.sessionStorage.setItem('evogym:demo-mode', 'true');
    access.principal = { kind: 'admin', identity: { is_owner: true, can_manage_employees: true } };
    adminSession.status = 'authenticated';
    render(<MemoryRouter initialEntries={['/owner/overview']}><ProductRoutes /></MemoryRouter>);
    expect(await screen.findByTestId('application-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('demo-provider')).not.toBeInTheDocument();
    expect(demoMounted).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('evogym:demo-mode')).toBe('true');
  });

  it('fails closed to API entry when mode is missing or invalid despite a stale override', async () => {
    for (const value of [undefined, 'yes']) {
      vi.unstubAllEnvs();
      if (value !== undefined) vi.stubEnv('VITE_DEMO_MODE', value);
      window.sessionStorage.setItem('evogym:demo-mode', 'true');
      const view = render(<MemoryRouter initialEntries={['/reception/home']}><ProductRoutes /></MemoryRouter>);
      expect(await screen.findByText('Profile selection')).toBeInTheDocument();
      expect(demoMounted).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it('mounts the original demo app only when mode and explicit selection are both true', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    window.sessionStorage.setItem('evogym:demo-mode', 'true');
    render(<MemoryRouter initialEntries={['/reception/home']}><ProductRoutes /></MemoryRouter>);
    expect(await screen.findByText('Demo business app')).toBeInTheDocument();
    expect(demoMounted).toHaveBeenCalledOnce();
  });

  it('returns an authenticated employee to profile selection after the provider exits its operating profile', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    access.principal = { kind: 'employee', identity: { is_owner: false, can_manage_employees: false }, session: receptionSession };
    access.leaveProfile = vi.fn(async () => {
      access.principal = null;
      access.listeners.forEach(listener => listener());
    });
    render(<MemoryRouter initialEntries={['/reception/home']}><ProductRoutes /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar perfil' }));
    expect(await screen.findByText('Profile selection')).toBeInTheDocument();
    expect(access.leaveProfile).toHaveBeenCalledOnce();
    expect(access.reload).not.toHaveBeenCalled();
    expect(access.exit).not.toHaveBeenCalled();
  });

  it('confirms unlink only for phone-purpose employee sessions and preserves cancel', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    access.principal = { kind: 'employee', identity: { is_owner: false, can_manage_employees: false }, session: { purpose: 'phone' } };
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<MemoryRouter initialEntries={['/reception/home']}><ProductRoutes /></MemoryRouter>);
    const unlink = await screen.findByRole('button', { name: 'Desvincular este dispositivo' });
    await userEvent.click(unlink);
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/nuevo código de vinculación/i));
    expect(access.unlinkPairedDevice).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await userEvent.click(unlink);
    await waitFor(() => expect(access.unlinkPairedDevice).toHaveBeenCalledOnce());
    confirm.mockRestore();
  });

  it('does not expose paired-device unlink for Reception-purpose sessions', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    access.principal = { kind: 'employee', identity: { is_owner: false, can_manage_employees: false }, session: { purpose: 'reception' } };
    render(<MemoryRouter initialEntries={['/reception/home']}><ProductRoutes /></MemoryRouter>);
    expect(await screen.findByTestId('application-shell')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Desvincular este dispositivo' })).toBeNull();
  });
  it('keeps P1 staff linking and initial PIN on server-issued profile and account IDs', async () => {
    const branchId = '123e4567-e89b-42d3-a456-426614174000';
    const profileId = '223e4567-e89b-42d3-a456-426614174000';
    const accountId = '323e4567-e89b-42d3-a456-426614174000';
    let linked = false;
    adminSession.status = 'authenticated';
    access.principal = { kind: 'admin', identity: { is_owner: true, can_manage_employees: true } };
    adminSession.request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/v1/admin/staff-accounts/branches') return new Response(JSON.stringify({ branches: [{ id: branchId, code: 'CTR', name: 'Centro' }] }));
      if (path === `/api/v1/admin/staff-accounts/roster-profiles?branch_id=${branchId}`) return new Response(JSON.stringify({ profiles: [{ id: profileId, full_name: 'Ana Pérez', position: 'Recepción', is_active: true, staff_user_id: linked ? accountId : null }] }));
      if (path === `/api/v1/admin/staff-accounts?branch_id=${branchId}`) return new Response(JSON.stringify({ accounts: [{ id: accountId, login_identifier: 'ana@example.test', is_active: true, link_state: linked ? 'linked' : 'unlinked', linked_profile_id: linked ? profileId : null }] }));
      if (path === `/api/v1/admin/staff-accounts/roster-profiles/${profileId}/link`) {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({ staff_user_id: accountId });
        linked = true;
        return new Response(JSON.stringify({ profile_id: profileId, staff_user_id: accountId, link_state: 'linked' }));
      }
      if (path === `/api/v1/staff/credentials/${accountId}/initial-pin`) return new Response(JSON.stringify({ initial_pin: '654321' }));
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<MemoryRouter initialEntries={['/owner/staff']}><ProductRoutes /></MemoryRouter>);
    await userEvent.selectOptions(await screen.findByLabelText('Sucursal'), branchId);
    expect(await screen.findByText('Ana Pérez')).toBeInTheDocument();
    expect(screen.getAllByText('No disponible en API').length).toBeGreaterThan(0);
    const staffPage = screen.getByRole('heading', { name: 'Equipo de Recepción' }).closest('.staff-mgmt-page') as HTMLElement;
    expect(staffPage?.querySelector(':scope > header.page-header')).toBeInTheDocument();
    expect(within(staffPage!).getByRole('radiogroup', { name: 'Filtrar por estado' })).toBeInTheDocument();
    expect(within(staffPage!).getByRole('button', { name: /Nuevo recepcionista/ })).toBeDisabled();
    expect(within(staffPage!).getByRole('columnheader', { name: 'Turno' })).toBeInTheDocument();
    expect(within(staffPage!).getByRole('columnheader', { name: 'Sueldo mensual' })).toBeInTheDocument();
    expect(within(staffPage!).getByRole('columnheader', { name: 'Credencial' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
    expect(screen.getByText('Horario semanal recurrente')).toBeInTheDocument();
    expect(screen.getByLabelText('Sueldo mensual (MXN) *')).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Estado de PIN no disponible en API' })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.selectOptions(screen.getByLabelText('Vincular cuenta de acceso'), accountId);
    await userEvent.click(screen.getByRole('button', { name: 'Vincular cuenta' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/quedó vinculada/);
    const pinButton = await screen.findByRole('button', { name: 'Emitir PIN' });
    expect(pinButton).toBeEnabled();
    await userEvent.click(pinButton);
    expect(await screen.findByRole('heading', { name: 'PIN Inicial Generado' })).toBeInTheDocument();
    expect(adminSession.request).toHaveBeenCalledWith(`/api/v1/staff/credentials/${accountId}/initial-pin`, expect.anything());
    expect(screen.queryByTestId('demo-provider')).not.toBeInTheDocument();
  });
  it('opens the existing pairing design for the linked server account and issues only on request', async () => {
    const branchId = '123e4567-e89b-42d3-a456-426614174000';
    const profileId = '223e4567-e89b-42d3-a456-426614174000';
    const accountId = '323e4567-e89b-42d3-a456-426614174000';
    adminSession.status = 'authenticated';
    access.principal = { kind: 'admin', identity: { is_owner: true, can_manage_employees: true } };
    adminSession.request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/v1/admin/staff-accounts/branches') return new Response(JSON.stringify({ branches: [{ id: branchId, code: 'CTR', name: 'Centro' }] }));
      if (path === `/api/v1/admin/staff-accounts/roster-profiles?branch_id=${branchId}`) return new Response(JSON.stringify({ profiles: [{ id: profileId, full_name: 'Ana Pérez', position: 'Recepción', is_active: true, staff_user_id: accountId }] }));
      if (path === `/api/v1/admin/staff-accounts?branch_id=${branchId}`) return new Response(JSON.stringify({ accounts: [{ id: accountId, login_identifier: 'ana@example.test', is_active: true, link_state: 'linked', linked_profile_id: profileId }] }));
      if (path === '/api/v1/admin/devices') return new Response(JSON.stringify({ devices: [] }));
      if (path === `/api/v1/admin/staff/${accountId}/device-pairing`) {
        expect(init?.method).toBe('POST');
        return new Response(JSON.stringify({ id: '423e4567-e89b-42d3-a456-426614174000', pairing_code: '481926', expires_at: '2030-01-01T00:10:00Z' }));
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<MemoryRouter initialEntries={['/owner/staff']}><ProductRoutes /></MemoryRouter>);
    await userEvent.selectOptions(await screen.findByLabelText('Sucursal'), branchId);
    await userEvent.click(await screen.findByRole('button', { name: 'Vincular Dispositivo' }));

    const pairingDialog = await screen.findByRole('dialog', { name: /vincular dispositivo/i });
    expect(within(pairingDialog).getByText(/Ana Pérez/)).toBeInTheDocument();
    expect(screen.getByTestId('pairing-code-display')).not.toHaveTextContent(/\d{3}-\d{3}/);
    expect(adminSession.request).not.toHaveBeenCalledWith(`/api/v1/admin/staff/${accountId}/device-pairing`, expect.anything());
    expect(screen.queryByText(/Phone management/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /generar nuevo/i }));
    expect(await screen.findByTestId('pairing-code-display')).toHaveTextContent('481-926');
    expect(adminSession.request).toHaveBeenCalledWith(`/api/v1/admin/staff/${accountId}/device-pairing`, expect.objectContaining({ method: 'POST' }));
    expect(screen.queryByText(/No hay teléfonos vinculados activos/)).toBeInTheDocument();
  });
  it('does not reveal an API code returned after the pairing modal closes and reopens', async () => {
    const branchId = '123e4567-e89b-42d3-a456-426614174000';
    const profileId = '223e4567-e89b-42d3-a456-426614174000';
    const accountId = '323e4567-e89b-42d3-a456-426614174000';
    let resolveIssue!: (response: Response) => void;
    const pendingIssue = new Promise<Response>(resolve => { resolveIssue = resolve; });
    let issueCount = 0;
    adminSession.status = 'authenticated';
    access.principal = { kind: 'admin', identity: { is_owner: true, can_manage_employees: true } };
    adminSession.request = vi.fn(async (path: string) => {
      if (path === '/api/v1/admin/staff-accounts/branches') return new Response(JSON.stringify({ branches: [{ id: branchId, code: 'CTR', name: 'Centro' }] }));
      if (path === `/api/v1/admin/staff-accounts/roster-profiles?branch_id=${branchId}`) return new Response(JSON.stringify({ profiles: [{ id: profileId, full_name: 'Ana Pérez', position: 'Recepción', is_active: true, staff_user_id: accountId }] }));
      if (path === `/api/v1/admin/staff-accounts?branch_id=${branchId}`) return new Response(JSON.stringify({ accounts: [{ id: accountId, login_identifier: 'ana@example.test', is_active: true, link_state: 'linked', linked_profile_id: profileId }] }));
      if (path === '/api/v1/admin/devices') return new Response(JSON.stringify({ devices: [] }));
      if (path === `/api/v1/admin/staff/${accountId}/device-pairing`) {
        issueCount += 1;
        return issueCount === 1 ? pendingIssue : new Response(JSON.stringify({ id: '423e4567-e89b-42d3-a456-426614174000', pairing_code: '519284', expires_at: '2030-01-01T00:10:00Z' }));
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<MemoryRouter initialEntries={['/owner/staff']}><ProductRoutes /></MemoryRouter>);
    await userEvent.selectOptions(await screen.findByLabelText('Sucursal'), branchId);
    await userEvent.click(await screen.findByRole('button', { name: 'Vincular Dispositivo' }));
    await userEvent.click(await screen.findByRole('button', { name: /generar nuevo/i }));
    await waitFor(() => expect(adminSession.request).toHaveBeenCalledWith(`/api/v1/admin/staff/${accountId}/device-pairing`, expect.objectContaining({ method: 'POST' })));
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar modal' }));
    resolveIssue(new Response(JSON.stringify({ id: '423e4567-e89b-42d3-a456-426614174000', pairing_code: '417305', expires_at: '2030-01-01T00:10:00Z' })));

    await userEvent.click(await screen.findByRole('button', { name: 'Vincular Dispositivo' }));
    await waitFor(() => expect(screen.getByTestId('pairing-code-display')).not.toHaveTextContent(/\d{3}-\d{3}/));
    expect(screen.queryByText('417-305')).not.toBeInTheDocument();
    expect(screen.queryByText('519-284')).not.toBeInTheDocument();
  });
  it('keeps device-list and code API failures in the original modal without local fallback', async () => {
    const branchId = '123e4567-e89b-42d3-a456-426614174000';
    const profileId = '223e4567-e89b-42d3-a456-426614174000';
    const accountId = '323e4567-e89b-42d3-a456-426614174000';
    adminSession.status = 'authenticated';
    access.principal = { kind: 'admin', identity: { is_owner: true, can_manage_employees: true } };
    adminSession.request = vi.fn(async (path: string) => {
      if (path === '/api/v1/admin/staff-accounts/branches') return new Response(JSON.stringify({ branches: [{ id: branchId, code: 'CTR', name: 'Centro' }] }));
      if (path === `/api/v1/admin/staff-accounts/roster-profiles?branch_id=${branchId}`) return new Response(JSON.stringify({ profiles: [{ id: profileId, full_name: 'Ana Pérez', position: 'Recepción', is_active: true, staff_user_id: accountId }] }));
      if (path === `/api/v1/admin/staff-accounts?branch_id=${branchId}`) return new Response(JSON.stringify({ accounts: [{ id: accountId, login_identifier: 'ana@example.test', is_active: true, link_state: 'linked', linked_profile_id: profileId }] }));
      throw new Error('Device API unavailable');
    });

    render(<MemoryRouter initialEntries={['/owner/staff']}><ProductRoutes /></MemoryRouter>);
    await userEvent.selectOptions(await screen.findByLabelText('Sucursal'), branchId);
    await userEvent.click(await screen.findByRole('button', { name: 'Vincular Dispositivo' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo cargar la lista de dispositivos/i);
    expect(screen.getByTestId('pairing-code-display')).not.toHaveTextContent(/\d{3}-\d{3}/);
    expect(screen.queryByText(/iPhone 14 · Safari/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /generar nuevo/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo generar el código en el servidor/i);
    expect(screen.getByTestId('pairing-code-display')).not.toHaveTextContent(/\d{3}-\d{3}/);
    expect(localStorage.getItem('evogym:pairing_codes')).toBeNull();
    expect(screen.queryByTestId('demo-provider')).not.toBeInTheDocument();
  });

  it('keeps roster request failures visible and never substitutes local staff', async () => {
    adminSession.status = 'authenticated';
    access.principal = { kind: 'admin', identity: { is_owner: true, can_manage_employees: true } };
    const branchId = '123e4567-e89b-42d3-a456-426614174000';
    adminSession.request = vi.fn(async (path: string) => {
      if (path === '/api/v1/admin/staff-accounts/branches') return new Response(JSON.stringify({ branches: [{ id: branchId, code: 'CTR', name: 'Centro' }] }));
      throw new Error('API unavailable');
    });
    render(<MemoryRouter initialEntries={['/owner/staff']}><ProductRoutes /></MemoryRouter>);
    await userEvent.selectOptions(await screen.findByLabelText('Sucursal'), branchId);
    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo cargar/i);
    expect(screen.queryByText('Esteban Morales')).not.toBeInTheDocument();
    expect(screen.queryByTestId('demo-provider')).not.toBeInTheDocument();
  });
  it('keeps failed account linking in an error state without a success notice', async () => {
    const branchId = '123e4567-e89b-42d3-a456-426614174000';
    const profileId = '223e4567-e89b-42d3-a456-426614174000';
    const accountId = '323e4567-e89b-42d3-a456-426614174000';
    adminSession.status = 'authenticated';
    access.principal = { kind: 'admin', identity: { is_owner: true, can_manage_employees: true } };
    adminSession.request = vi.fn(async (path: string) => {
      if (path === '/api/v1/admin/staff-accounts/branches') return new Response(JSON.stringify({ branches: [{ id: branchId, code: 'CTR', name: 'Centro' }] }));
      if (path.endsWith(`/roster-profiles?branch_id=${branchId}`)) return new Response(JSON.stringify({ profiles: [{ id: profileId, full_name: 'Ana Pérez', position: 'Recepción', is_active: true, staff_user_id: null }] }));
      if (path === `/api/v1/admin/staff-accounts?branch_id=${branchId}`) return new Response(JSON.stringify({ accounts: [{ id: accountId, login_identifier: 'ana@example.test', is_active: true, link_state: 'unlinked', linked_profile_id: null }] }));
      if (path.endsWith(`/roster-profiles/${profileId}/link`)) return new Response(JSON.stringify({ detail: 'forbidden' }), { status: 403 });
      throw new Error(`Unexpected request: ${path}`);
    });
    render(<MemoryRouter initialEntries={['/owner/staff']}><ProductRoutes /></MemoryRouter>);
    await userEvent.selectOptions(await screen.findByLabelText('Sucursal'), branchId);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    await userEvent.selectOptions(screen.getByLabelText('Vincular cuenta de acceso'), accountId);
    await userEvent.click(screen.getByRole('button', { name: 'Vincular cuenta' }));
    expect((await screen.findAllByText(/No se pudo vincular la cuenta/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/quedó vinculada/)).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('demo-provider')).not.toBeInTheDocument();
  });
  it('resets branch modals and ignores a stale PIN response after switching branches', async () => {
    const firstBranch = '123e4567-e89b-42d3-a456-426614174000';
    const secondBranch = '423e4567-e89b-42d3-a456-426614174000';
    const firstProfile = '223e4567-e89b-42d3-a456-426614174000';
    const firstAccount = '323e4567-e89b-42d3-a456-426614174000';
    let resolvePin!: (response: Response) => void;
    const pinResponse = new Promise<Response>(resolve => { resolvePin = resolve; });
    adminSession.status = 'authenticated';
    access.principal = { kind: 'admin', identity: { is_owner: true, can_manage_employees: true } };
    adminSession.request = vi.fn(async (path: string) => {
      if (path === '/api/v1/admin/staff-accounts/branches') return new Response(JSON.stringify({ branches: [{ id: firstBranch, code: 'A', name: 'Primera' }, { id: secondBranch, code: 'B', name: 'Segunda' }] }));
      const branchId = path.includes(firstBranch) ? firstBranch : secondBranch;
      if (path.startsWith('/api/v1/admin/staff-accounts/roster-profiles?')) return new Response(JSON.stringify({ profiles: [{ id: branchId === firstBranch ? firstProfile : '523e4567-e89b-42d3-a456-426614174000', full_name: branchId === firstBranch ? 'Ana Pérez' : 'Brenda Pérez', position: 'Recepción', is_active: true, staff_user_id: branchId === firstBranch ? firstAccount : null }] }));
      if (path.startsWith('/api/v1/admin/staff-accounts?')) return new Response(JSON.stringify({ accounts: branchId === firstBranch ? [{ id: firstAccount, login_identifier: 'ana@example.test', is_active: true, link_state: 'linked', linked_profile_id: firstProfile }] : [] }));
      if (path === `/api/v1/staff/credentials/${firstAccount}/initial-pin`) return pinResponse;
      throw new Error(`Unexpected request: ${path}`);
    });
    render(<MemoryRouter initialEntries={['/owner/staff']}><ProductRoutes /></MemoryRouter>);
    const branch = await screen.findByLabelText('Sucursal');
    await userEvent.selectOptions(branch, firstBranch);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.selectOptions(branch, secondBranch);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText('Brenda Pérez')).toBeInTheDocument();

    await userEvent.selectOptions(branch, firstBranch);
    await userEvent.click(await screen.findByRole('button', { name: 'Emitir PIN' }));
    await userEvent.selectOptions(branch, secondBranch);
    expect(await screen.findByText('Brenda Pérez')).toBeInTheDocument();
    resolvePin(new Response(JSON.stringify({ initial_pin: '654321' })));
    expect(screen.queryByRole('heading', { name: 'PIN inicial emitido' })).not.toBeInTheDocument();
  });
  it('ignores a delayed link result after the user changes branch', async () => {
    const firstBranch = '123e4567-e89b-42d3-a456-426614174000';
    const secondBranch = '423e4567-e89b-42d3-a456-426614174000';
    const profileId = '223e4567-e89b-42d3-a456-426614174000';
    const accountId = '323e4567-e89b-42d3-a456-426614174000';
    let resolveLink!: (response: Response) => void;
    const linkResponse = new Promise<Response>(resolve => { resolveLink = resolve; });
    adminSession.status = 'authenticated';
    access.principal = { kind: 'admin', identity: { is_owner: true, can_manage_employees: true } };
    adminSession.request = vi.fn(async (path: string) => {
      if (path === '/api/v1/admin/staff-accounts/branches') return new Response(JSON.stringify({ branches: [{ id: firstBranch, code: 'A', name: 'Primera' }, { id: secondBranch, code: 'B', name: 'Segunda' }] }));
      if (path.endsWith(`/roster-profiles?branch_id=${firstBranch}`)) return new Response(JSON.stringify({ profiles: [{ id: profileId, full_name: 'Ana Pérez', position: 'Recepción', is_active: true, staff_user_id: null }] }));
      if (path === `/api/v1/admin/staff-accounts?branch_id=${firstBranch}`) return new Response(JSON.stringify({ accounts: [{ id: accountId, login_identifier: 'ana@example.test', is_active: true, link_state: 'unlinked', linked_profile_id: null }] }));
      if (path.endsWith(`/roster-profiles/${profileId}/link`)) return linkResponse;
      if (path.endsWith(`roster-profiles?branch_id=${secondBranch}`)) return new Response(JSON.stringify({ profiles: [] }));
      if (path === `/api/v1/admin/staff-accounts?branch_id=${secondBranch}`) return new Response(JSON.stringify({ accounts: [] }));
      throw new Error(`Unexpected request: ${path}`);
    });
    render(<MemoryRouter initialEntries={['/owner/staff']}><ProductRoutes /></MemoryRouter>);
    const branch = await screen.findByLabelText('Sucursal');
    await userEvent.selectOptions(branch, firstBranch);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    await userEvent.selectOptions(screen.getByLabelText('Vincular cuenta de acceso'), accountId);
    await userEvent.click(screen.getByRole('button', { name: 'Vincular cuenta' }));
    await waitFor(() => expect(adminSession.request).toHaveBeenCalledWith(`/api/v1/admin/staff-accounts/roster-profiles/${profileId}/link`, expect.anything()));
    await userEvent.selectOptions(branch, secondBranch);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    resolveLink(new Response(JSON.stringify({ profile_id: profileId, staff_user_id: accountId, link_state: 'linked' })));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Sucursal' })).toHaveValue(secondBranch));
    expect(screen.queryByText(/quedó vinculada/)).not.toBeInTheDocument();
  });

  it('does not expose staff management actions to an Admin without employee capability', async () => {
    adminSession.status = 'authenticated';
    access.principal = { kind: 'admin', identity: { is_owner: false, can_manage_employees: false } };
    render(<MemoryRouter initialEntries={['/owner/staff']}><ProductRoutes /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Personal' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Función no disponible' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Emitir PIN' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(adminSession.request).not.toHaveBeenCalled();
  });
  it('renders authenticated API shifts without falling back to demo', async () => {
    adminSession.status = 'authenticated';
    access.principal = { kind: 'admin', identity: { id: 'admin-1', display_name: 'Owner', is_owner: true, can_manage_employees: true } };
    const register = { id: 'register-1', branch_id: 'branch-1', code: 'front', name: 'Reception', status: 'active', has_open_shift: false };
    adminSession.request.mockImplementation(async path => {
      if (path === '/api/v1/registers') return new Response(JSON.stringify([register]));
      if (path.startsWith('/api/v1/shifts?')) return new Response(JSON.stringify({ items: [], total: 0, offset: 0, limit: 100 }));
      if (path.startsWith('/api/v1/shifts/current?')) return new Response('{}', { status: 404 });
      return new Response('{}');
    });
    render(<MemoryRouter initialEntries={['/owner/shifts']}><ProductRoutes /></MemoryRouter>);
    expect(await screen.findByText('No hay turnos registrados para esta caja.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir Turno' })).toBeEnabled();
    expect(adminSession.request).toHaveBeenCalledWith('/api/v1/registers', undefined);
    expect(adminSession.request).toHaveBeenCalledWith('/api/v1/shifts?register_id=register-1&offset=0&limit=100', undefined);
    expect(screen.queryByTestId('demo-provider')).not.toBeInTheDocument();
  });
});
