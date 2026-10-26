import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffAccessPage } from './StaffAccessPage';

const session = { access_token: 'do-not-render'.repeat(4), token_type: 'bearer', expires_at: '2026-10-23T12:00:00Z' };
const branchId = '123e4567-e89b-42d3-a456-426614174000';

describe('StaffAccessPage', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('authenticates phone access without storing credentials or showing the bearer token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(session), { status: 201 }));
    vi.stubGlobal('fetch', fetchImpl);
    render(<StaffAccessPage apiOrigin="https://api.example.test" />);
    fireEvent.change(screen.getByLabelText('Identificador de acceso'), { target: { value: 'worker@example.test' } });
    fireEvent.change(screen.getByLabelText('ID de sucursal'), { target: { value: branchId } });
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '246810' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar con PIN' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Sesión activa: worker@example.test (phone).');
    expect(document.body).not.toHaveTextContent('do-not-render');
    expect(window.localStorage.length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(await screen.findByLabelText('PIN')).toHaveValue('');
  });

  it('requires a fresh PIN for each selected Reception profile and clears the secret on logout', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ profiles: [
        { id: branchId, full_name: 'Taylor Staff', position: 'Reception' },
      ] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(session), { status: 201 }));
    vi.stubGlobal('fetch', fetchImpl);
    render(<StaffAccessPage apiOrigin="https://api.example.test" />);
    fireEvent.click(screen.getByRole('button', { name: 'Recepción' }));
    fireEvent.change(screen.getByLabelText('Credencial de esta estación'), { target: { value: 's'.repeat(43) } });
    fireEvent.click(screen.getByRole('button', { name: 'Cargar perfiles activos' }));
    fireEvent.change(await screen.findByLabelText('Perfil activo'), { target: { value: branchId } });
    fireEvent.change(screen.getByLabelText('PIN de Taylor Staff'), { target: { value: '246810' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar con PIN' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Taylor Staff (reception).');
    expect(document.body).not.toHaveTextContent('s'.repeat(43));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    await waitFor(() => expect(screen.getByLabelText('Credencial de esta estación')).toHaveValue(''));
  });

  it('pairs a phone with a memory-only browser identifier without creating an employee session', async () => {
    const identifier = '123e4567-e89b-42d3-a456-426614174003';
    vi.spyOn(window.crypto, 'randomUUID').mockReturnValue(identifier);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ device_id: identifier, status: 'paired' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);
    render(<StaffAccessPage apiOrigin="https://api.example.test" />);
    fireEvent.change(screen.getByLabelText('Identificador de acceso'), { target: { value: 'worker@example.test' } });
    fireEvent.change(screen.getByLabelText('Código de vinculación'), { target: { value: '012345' } });
    fireEvent.change(screen.getByLabelText('Nombre del dispositivo'), { target: { value: 'Mi teléfono' } });
    fireEvent.click(screen.getByRole('button', { name: 'Vincular teléfono' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Teléfono vinculado. La vinculación no inicia sesión.');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.example.test/api/v1/auth/devices/pair');
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      login_identifier: 'worker@example.test', pairing_code: '012345', device_identifier: identifier, device_name: 'Mi teléfono',
    });
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store' });
    expect(document.body).not.toHaveTextContent(identifier);
    expect(window.localStorage.length).toBe(0);
    expect(screen.getByLabelText('Código de vinculación')).toHaveValue('');
    expect(screen.queryByLabelText('Sesión de personal activa')).not.toBeInTheDocument();
  });
});
