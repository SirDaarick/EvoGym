import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { AdminAuthClient } from '../../api/adminAuthApi';
import { ProductAccessProvider, useProductAccess } from '../auth/ProductAccessProvider';
import { StaffProfileSelection } from './StaffProfileSelection';

const employeeId = '123e4567-e89b-42d3-a456-426614174000';
const profileId = '223e4567-e89b-42d3-a456-426614174000';
const branchId = '323e4567-e89b-42d3-a456-426614174000';
const identity = { id: employeeId, kind: 'employee', display_name: 'Ana Perez', is_owner: false, can_manage_employees: false,
  branch_profiles: [{ profile_id: profileId, branch_id: branchId, branch_name: 'Centro' }] };
const unlinkedIdentity = { id: profileId, kind: 'unlinked', source: 'roster_profile', profile_id: profileId,
  display_name: 'Pending Employee', is_owner: false, can_manage_employees: false,
  branch_profiles: [{ profile_id: profileId, branch_id: branchId, branch_name: 'Centro' }] };
const adminIdentity = { id: employeeId, kind: 'admin', display_name: 'Admin Evo', is_owner: true, can_manage_employees: true, branch_profiles: [] };
const response = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' } });

function renderSelector(fetchImpl: ReturnType<typeof vi.fn>) {
  const client = new AdminAuthClient({ apiOrigin: 'https://api.example.test', fetchImpl: fetchImpl as typeof fetch });
  return render(<MemoryRouter><ProductAccessProvider client={client} apiOrigin="https://api.example.test" fetchImpl={fetchImpl as typeof fetch}><StaffProfileSelection /><ReloadChoices /></ProductAccessProvider></MemoryRouter>);
}

function ReloadChoices() {
  const access = useProductAccess();
  return <button type="button" onClick={() => { void access.reload(); }}>Reload profile choices</button>;
}

describe('live StaffProfileSelection', () => {
  it('offers a confirmed unlink from paired choices before PIN, but not from Admin choices', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/auth/refresh') return response(401);
      if (path.endsWith('/profile-access/context')) return response(200, { identities: [identity] });
      throw new Error(`Unexpected request: ${path}`);
    });
    renderSelector(fetchImpl);
    await screen.findByRole('button', { name: /Ana Perez/ });
    expect(screen.queryByRole('button', { name: 'Vincular dispositivo con código' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Vincular dispositivo' })).not.toBeInTheDocument();
    vi.stubGlobal('confirm', vi.fn(() => false));
    fireEvent.click(screen.getByRole('button', { name: 'Desvincular este dispositivo' }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/nuevo código de vinculación/i));
    expect(fetchImpl.mock.calls.some(call => String(call[0]).endsWith('/profile-access/logout'))).toBe(false);
    vi.unstubAllGlobals();
  });

  it('offers device pairing when no paired context is available', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/auth/refresh') return response(401);
      if (path.endsWith('/profile-access/context')) return response(401);
      throw new Error(`Unexpected request: ${path}`);
    });
    renderSelector(fetchImpl);
    expect(await screen.findByRole('button', { name: 'Vincular dispositivo con código' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desvincular este dispositivo' })).not.toBeInTheDocument();
  });

  it('does not offer unlink on an Admin-backed Reception selector', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/refresh')) return response(200, { access_token: 'a'.repeat(40), token_type: 'bearer', expires_at: new Date(Date.now() + 3600000).toISOString() });
      if (path.endsWith('/admin/profile-access/choices')) return response(200, { current_identity_id: employeeId, identities: [adminIdentity, identity] });
      throw new Error(`Unexpected request: ${path}`);
    });
    renderSelector(fetchImpl);
    expect(await screen.findByRole('button', { name: /Ana Perez/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desvincular este dispositivo' })).not.toBeInTheDocument();
  });

  it('preserves the paired selector on failed revocation and clears it only after server 204', async () => {
    let unlinkCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/auth/refresh') return response(401);
      if (path.endsWith('/profile-access/context')) return response(200, { identities: [identity] });
      if (path.endsWith('/profile-access/logout')) return response(++unlinkCalls === 1 ? 503 : 204);
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('confirm', vi.fn(() => true));
    renderSelector(fetchImpl);
    await screen.findByRole('button', { name: /Ana Perez/ });
    fireEvent.click(screen.getByRole('button', { name: 'Desvincular este dispositivo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/server did not confirm revocation/i);
    expect(screen.getByRole('button', { name: 'Desvincular este dispositivo' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Desvincular este dispositivo' }));
    await waitFor(() => expect(screen.getByRole('form', { name: 'Admin sign in' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Ana Perez/ })).not.toBeInTheDocument();
    expect(fetchImpl.mock.calls.filter(call => String(call[0]).endsWith('/profile-access/logout'))).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it('does not restore unlink capability from a stale paired discovery after a 401 reload', async () => {
    let releaseFirst!: (value: Response) => void;
    let contextRequests = 0;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/auth/refresh') return Promise.resolve(response(401));
      if (path.endsWith('/profile-access/context')) {
        contextRequests += 1;
        if (contextRequests === 1) return new Promise<Response>(resolve => { releaseFirst = resolve; });
        return Promise.resolve(response(401));
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    renderSelector(fetchImpl);
    await waitFor(() => expect(releaseFirst).toBeTypeOf('function'));
    fireEvent.click(screen.getByRole('button', { name: 'Reload profile choices' }));
    await screen.findByRole('form', { name: 'Admin sign in' });
    releaseFirst(response(200, { identities: [identity] }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Desvincular este dispositivo' })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Ana Perez/ })).not.toBeInTheDocument();
  });

  it('shows only the paired employee selector after choices load and Admin login only after choices disappear', async () => {
    let releaseContext!: (value: Response) => void;
    let identities = [identity];
    let firstContext = true;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/refresh')) return Promise.resolve(response(401));
      if (path.endsWith('/profile-access/context')) {
        if (firstContext) {
          firstContext = false;
          return new Promise<Response>(resolve => { releaseContext = resolve; });
        }
        return Promise.resolve(response(200, { identities }));
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderSelector(fetchImpl);
    await waitFor(() => expect(releaseContext).toBeTypeOf('function'));
    expect(await screen.findByRole('status')).toHaveTextContent('Verificando acceso');
    expect(screen.queryByRole('form', { name: 'Admin sign in' })).not.toBeInTheDocument();
    releaseContext(response(200, { identities }));

    expect(await screen.findByRole('heading', { name: 'Elige tu perfil' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Ana Perez · Personal' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Admin sign in' })).not.toBeInTheDocument();
    expect(screen.queryByText(/No hay perfiles disponibles/)).not.toBeInTheDocument();

    identities = [];
    fireEvent.click(screen.getByRole('button', { name: 'Reload profile choices' }));
    expect(await screen.findByRole('form', { name: 'Admin sign in' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Inicia sesión' })).toBeInTheDocument();
    expect(screen.getByText('Accede con tu cuenta de administrador para continuar.')).toBeInTheDocument();
    expect(screen.queryByText(/No hay perfiles disponibles/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Elige tu perfil' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ana Perez/ })).not.toBeInTheDocument();
  });

  it('hides local demo entry unless the explicit demo flag is enabled', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/auth/refresh') return response(401);
      if (path.endsWith('/profile-access/context')) return response(401);
      throw new Error(`Unexpected request: ${path}`);
    });
    renderSelector(fetchImpl);
    expect(await screen.findByRole('heading', { name: 'Inicia sesión' })).toBeInTheDocument();
    expect(screen.queryByText(/No hay perfiles disponibles/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Modo Demo/ })).not.toBeInTheDocument();
  });

  it('shows Admin an unlinked roster card as disabled discovery, never as a PIN entry', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/auth/refresh') return response(200, { access_token: 'a'.repeat(40), token_type: 'bearer', expires_at: new Date(Date.now() + 3600000).toISOString() });
      if (path.endsWith('/admin/profile-access/choices')) return response(200, { current_identity_id: employeeId, identities: [adminIdentity, unlinkedIdentity] });
      throw new Error(`Unexpected request: ${path}`);
    });
    renderSelector(fetchImpl);
    const card = await screen.findByRole('button', { name: /Pending Employee.*Pendiente de vincular cuenta/i });
    expect(card).toBeDisabled();
    expect(screen.getByRole('button', { name: /Admin Evo.*Admin/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/PIN de seis dígitos/)).not.toBeInTheDocument();
    expect(fetchImpl.mock.calls.some(call => String(call[0]).includes('/profile-access/sessions'))).toBe(false);
  });

  it('keeps the current brand and selector presentation while rendering only server identities', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/auth/refresh') return response(401);
      if (path.endsWith('/profile-access/context')) return response(200, { identities: [identity] });
      throw new Error(`Unexpected request: ${path}`);
    });
    renderSelector(fetchImpl);
    expect(await screen.findByRole('button', { name: /Ana Perez/ })).toBeInTheDocument();
    const logo = document.querySelector('.staff-logo-mark img');
    expect(logo).toHaveAttribute('src', expect.stringContaining('evogym-logo-128.webp'));
    expect(logo).toHaveAttribute('width', '128');
    expect(logo).toHaveAttribute('height', '124');
    expect(screen.queryByRole('button', { name: /Mikel/ })).not.toBeInTheDocument();
    expect(fetchImpl.mock.calls.some(call => String(call[0]).includes('/profile-access/context'))).toBe(true);
  });

  it('requires PIN before employee entry and clears it after an unsuccessful attempt', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/auth/refresh') return response(401);
      if (path.endsWith('/profile-access/context')) return response(200, { identities: [identity] });
      if (path.endsWith('/profile-access/sessions')) return response(401, { detail: 'private diagnostic' });
      throw new Error(`Unexpected request: ${path}`);
    });
    renderSelector(fetchImpl);
    fireEvent.click(await screen.findByRole('button', { name: /Ana Perez/ }));
    const pin = screen.getByLabelText('Ingresa el PIN de seis dígitos para Ana Perez');
    fireEvent.change(pin, { target: { value: '000000' } });
    await waitFor(() => expect(fetchImpl.mock.calls.some(call => String(call[0]).endsWith('/profile-access/sessions'))).toBe(true));
    expect(screen.getAllByRole('alert').some(alert => alert.textContent?.includes('PIN no pudo verificarse'))).toBe(true);
    expect(document.body).not.toHaveTextContent('private diagnostic');
    const sessionCall = (fetchImpl.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit | undefined]>).find(call => String(call[0]).endsWith('/profile-access/sessions'));
    expect(String(sessionCall?.[1]?.body)).toContain('000000');
  });

  it('uses the same profile dialog for temporary-PIN setup before creating the operating session', async () => {
    let newPinEntryAttempts = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/auth/refresh') return response(401);
      if (path.endsWith('/profile-access/context')) return response(200, { identities: [identity] });
      if (path.endsWith('/profile-access/sessions')) {
        if (JSON.parse(String(init?.body)).pin === '123456') return response(201, { status: 'setup_required', identity: { id: employeeId }, profile: { id: profileId, branch_id: branchId } });
        if (newPinEntryAttempts++ === 0) return response(401);
        return response(201, { access_token: 's'.repeat(43), token_type: 'bearer', expires_at: new Date(Date.now() + 1800000).toISOString(),
          identity: { id: employeeId, kind: 'employee' }, profile: { id: profileId, branch_id: branchId }, purpose: 'phone' });
      }
      if (path.endsWith('/profile-access/first-pin-change')) return new Response(null, { status: 204 });
      throw new Error(`Unexpected request: ${path}`);
    });
    renderSelector(fetchImpl);
    fireEvent.click(await screen.findByRole('button', { name: /Ana Perez/ }));
    fireEvent.change(screen.getByLabelText(/PIN de seis dígitos para Ana Perez/), { target: { value: '123456' } });
    expect(await screen.findByLabelText('Nuevo PIN de seis dígitos')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ana Perez' })).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).queryByLabelText(/Usuario|login|PIN temporal/i)).not.toBeInTheDocument();
    expect(fetchImpl.mock.calls.some(call => String(call[0]).endsWith('/profile-access/sessions/logout'))).toBe(false);
    fireEvent.change(screen.getByLabelText('Nuevo PIN de seis dígitos'), { target: { value: '654321' } });
    fireEvent.change(screen.getByLabelText('Confirma el nuevo PIN de seis dígitos'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nuevo PIN' }));
    await waitFor(() => expect(fetchImpl.mock.calls.some(call => String(call[0]).endsWith('/profile-access/first-pin-change'))).toBe(true));
    await waitFor(() => expect(fetchImpl.mock.calls.filter(call => String(call[0]).endsWith('/profile-access/sessions'))).toHaveLength(2));
    expect(await screen.findByText(/PIN se actualizó, pero no se pudo iniciar la sesión/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Nuevo PIN de seis dígitos')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Entrar con el nuevo PIN' }));
    await waitFor(() => expect(fetchImpl.mock.calls.filter(call => String(call[0]).endsWith('/profile-access/sessions'))).toHaveLength(3));
    const change = fetchImpl.mock.calls.find(call => String(call[0]).endsWith('/profile-access/first-pin-change'));
    expect(JSON.parse(String(change?.[1]?.body))).toMatchObject({ profile_id: profileId, branch_id: branchId, current_pin: '123456', new_pin: '654321' });
    const newEntryCalls = fetchImpl.mock.calls.filter(call => String(call[0]).endsWith('/profile-access/sessions'));
    expect(newEntryCalls.slice(1).every(call => JSON.parse(String(call[1]?.body)).pin === '654321')).toBe(true);
    expect(await screen.findByRole('heading', { name: /Perfil activo/ })).toBeInTheDocument();
  });

  it('keeps setup visible while a PIN change is pending and still allows idle cancellation', async () => {
    let resolveChange!: (result: Response) => void;
    const pendingChange = new Promise<Response>(resolve => { resolveChange = resolve; });
    let entries = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/auth/refresh') return response(401);
      if (path.endsWith('/profile-access/context')) return response(200, { identities: [identity] });
      if (path.endsWith('/profile-access/sessions')) {
        if (entries++ === 0) return response(201, { status: 'setup_required', identity: { id: employeeId }, profile: { id: profileId, branch_id: branchId } });
        return response(401);
      }
      if (path.endsWith('/profile-access/first-pin-change')) return pendingChange;
      throw new Error(`Unexpected request: ${path} ${init?.method ?? 'GET'}`);
    });
    renderSelector(fetchImpl);
    fireEvent.click(await screen.findByRole('button', { name: /Ana Perez/ }));
    fireEvent.change(screen.getByLabelText(/PIN de seis dígitos para Ana Perez/), { target: { value: '123456' } });
    fireEvent.change(await screen.findByLabelText('Nuevo PIN de seis dígitos'), { target: { value: '654321' } });
    fireEvent.change(screen.getByLabelText('Confirma el nuevo PIN de seis dígitos'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nuevo PIN' }));
    await waitFor(() => expect(fetchImpl.mock.calls.some(call => String(call[0]).endsWith('/profile-access/first-pin-change'))).toBe(true));

    const cancel = screen.getByRole('button', { name: 'Cancelar' });
    expect(cancel).toBeDisabled();
    fireEvent.click(cancel);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    resolveChange(new Response(null, { status: 204 }));
    expect(await screen.findByText(/PIN se actualizó, pero no se pudo iniciar la sesión/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('preserves branch and partial PIN through an equivalent refresh, then cancels entry when that branch disappears', async () => {
    const secondBranch = { profile_id: profileId.replace('2', '5'), branch_id: branchId.replace('3', '6'), branch_name: 'Norte' };
    let serverIdentities = [{ ...identity, branch_profiles: [identity.branch_profiles[0], secondBranch] }];
    let contextRequests = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/auth/refresh') return response(401);
      if (path.endsWith('/profile-access/context')) { contextRequests += 1; return response(200, { identities: serverIdentities }); }
      throw new Error(`Unexpected request: ${path}`);
    });
    renderSelector(fetchImpl);
    fireEvent.click(await screen.findByRole('button', { name: /Ana Perez/ }));
    const branch = screen.getByLabelText('Sucursal');
    fireEvent.change(branch, { target: { value: secondBranch.profile_id } });
    fireEvent.change(screen.getByLabelText('Ingresa el PIN de seis dígitos para Ana Perez'), { target: { value: '12345' } });
    await waitFor(() => expect(document.querySelectorAll('.code-slots__slot[data-filled]')).toHaveLength(5));

    serverIdentities = JSON.parse(JSON.stringify(serverIdentities));
    fireEvent.click(screen.getByRole('button', { name: 'Reload profile choices' }));
    await waitFor(() => expect(contextRequests).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.getByLabelText('Sucursal')).toHaveValue(secondBranch.profile_id));
    expect(document.querySelectorAll('.code-slots__slot[data-filled]')).toHaveLength(5);

    serverIdentities = [identity];
    fireEvent.click(screen.getByRole('button', { name: 'Reload profile choices' }));
    await waitFor(() => expect(contextRequests).toBeGreaterThanOrEqual(3));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByLabelText(/PIN de seis dígitos/)).not.toBeInTheDocument();
  });
});
