import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DevicePairingView } from './DevicePairingView';
import {
  generatePairingCode,
  resetDevicePairingStore,
  getPairedSession,
} from './devicePairingStore';
import { resetStaff } from './staffStore';

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('DevicePairingView (/pair)', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStaff();
    resetDevicePairingStore();
    mockNavigate.mockClear();
  });

  it('renders clean mobile-first pairing screen with 6-digit input', () => {
    render(
      <MemoryRouter>
        <DevicePairingView />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: /vincular dispositivo/i })).toBeVisible();
    expect(screen.getByPlaceholderText('000-000')).toBeVisible();
    expect(screen.getByRole('button', { name: /vincular mi dispositivo/i })).toBeDisabled();
    expect(screen.getByRole('link', { name: /volver a selección de perfiles/i })).toBeVisible();
  });

  it('formats typed input into XXX-XXX and enables submit with 6 digits', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <DevicePairingView />
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText('000-000');
    await user.type(input, '849210');

    expect(input).toHaveValue('849-210');
    expect(screen.getByRole('button', { name: /vincular mi dispositivo/i })).toBeEnabled();
  });

  it('displays error notice on invalid code', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <DevicePairingView />
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText('000-000');
    await user.type(input, '999999');

    const submitBtn = screen.getByRole('button', { name: /vincular mi dispositivo/i });
    await user.click(submitBtn);

    expect(screen.getByRole('alert')).toHaveTextContent(/código inválido o no reconocido/i);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('successfully pairs device on valid code, persists session and redirects', async () => {
    const user = userEvent.setup();
    // Generate valid code for Sheila (RECEPTION role)
    const code = generatePairingCode('staff-sheila');

    render(
      <MemoryRouter>
        <DevicePairingView />
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText('000-000');
    await user.type(input, code.rawCode);

    const submitBtn = screen.getByRole('button', { name: /vincular mi dispositivo/i });
    await user.click(submitBtn);

    // Shows success feedback
    expect(screen.getByRole('status')).toHaveTextContent(/¡dispositivo vinculado con éxito! bienvenido, sheila/i);

    // Session persisted in localStorage
    const session = getPairedSession();
    expect(session?.staff.id).toBe('staff-sheila');

    // Navigates to receptionist home (/reception/home)
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/reception/home');
    }, { timeout: 2000 });
  });
});
