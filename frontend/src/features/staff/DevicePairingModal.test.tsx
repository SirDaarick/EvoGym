import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DevicePairingModal } from './DevicePairingModal';
import { resetDevicePairingStore, generatePairingCode } from './devicePairingStore';
import { resetStaff, getStaffList } from './staffStore';

describe('DevicePairingModal', () => {
  const mockStaff = {
    id: 'staff-sheila',
    name: 'Sheila',
    role: 'RECEPTION' as const,
    shift: 'Matutino',
    salaryMinor: 1000000,
    hasPin: true,
    active: true,
    avatarInitials: 'S',
  };

  beforeEach(() => {
    localStorage.clear();
    resetStaff();
    resetDevicePairingStore();
  });

  it('renders modal with employee info and 6-digit code with timer', () => {
    const handleClose = vi.fn();
    render(
      <DevicePairingModal
        isOpen={true}
        staff={mockStaff}
        onClose={handleClose}
      />
    );

    expect(screen.getByRole('heading', { name: /vincular dispositivo/i })).toBeVisible();
    expect(screen.getAllByText(/Sheila/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/staff-sheila/i)).toBeVisible();

    // Code output
    const codeDisplay = screen.getByTestId('pairing-code-display');
    expect(codeDisplay).toBeVisible();
    expect(codeDisplay.textContent).toMatch(/^\d{3}-\d{3}$/);

    // Timer badge
    expect(screen.getByText(/restantes/i)).toBeVisible();

    // Buttons
    expect(screen.getByRole('button', { name: /copiar código/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /enviar por whatsapp/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /generar nuevo/i })).toBeVisible();
  });

  it('copies code and shows copied feedback', async () => {
    const user = userEvent.setup();
    const handleClose = vi.fn();

    // Mock clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      configurable: true,
      writable: true,
    });

    render(
      <DevicePairingModal
        isOpen={true}
        staff={mockStaff}
        onClose={handleClose}
      />
    );

    const copyBtn = screen.getByRole('button', { name: /copiar código/i });
    await user.click(copyBtn);

    expect(screen.getByText(/¡código copiado!/i)).toBeVisible();
  });

  it('opens WhatsApp share link when clicked', async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(
      <DevicePairingModal
        isOpen={true}
        staff={mockStaff}
        onClose={vi.fn()}
      />
    );

    const waBtn = screen.getByRole('button', { name: /enviar por whatsapp/i });
    await user.click(waBtn);

    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining('https://wa.me/?text='),
      '_blank',
      'noopener,noreferrer'
    );

    openSpy.mockRestore();
  });

  it('displays active devices and allows revoking a device', async () => {
    const user = userEvent.setup();
    render(
      <DevicePairingModal
        isOpen={true}
        staff={mockStaff}
        onClose={vi.fn()}
      />
    );

    // Initial demo device for Sheila
    expect(screen.getByText(/iPhone 14 · Safari/i)).toBeVisible();

    const revokeBtn = screen.getByRole('button', { name: /desvincular/i });
    await user.click(revokeBtn);

    await waitFor(() => {
      expect(screen.getByText(/no hay teléfonos vinculados activos/i)).toBeVisible();
    });
  });

  it('generates a new code when clicking Generar nuevo', async () => {
    const user = userEvent.setup();
    render(
      <DevicePairingModal
        isOpen={true}
        staff={mockStaff}
        onClose={vi.fn()}
      />
    );

    const initialCode = screen.getByTestId('pairing-code-display').textContent;
    const generateBtn = screen.getByRole('button', { name: /generar nuevo/i });

    await user.click(generateBtn);

    const newCode = screen.getByTestId('pairing-code-display').textContent;
    expect(newCode).toMatch(/^\d{3}-\d{3}$/);
  });

  it('fails closed for API identity without Admin authority and never creates local pairing state', async () => {
    render(
      <DevicePairingModal
        isOpen
        staff={null}
        serverIdentity={{ staffId: '323e4567-e89b-42d3-a456-426614174000', staffName: 'Ana Pérez', contextId: 'branch-a' }}
        onClose={vi.fn()}
      />
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(/sesión Admin no está disponible/i);
    expect(screen.getByTestId('pairing-code-display')).not.toHaveTextContent(/\d{3}-\d{3}/);
    expect(screen.getByRole('button', { name: /generar nuevo/i })).toBeDisabled();
    expect(screen.getByText(/No hay teléfonos vinculados activos/i)).toBeInTheDocument();
    expect(localStorage.getItem('evogym:pairing_codes')).toBeNull();
    expect(localStorage.getItem('evogym:paired_devices')).toBeNull();
  });

  it('rejects an invalid explicit API staff identity without using demo pairing', async () => {
    render(
      <DevicePairingModal
        isOpen
        staff={null}
        serverIdentity={{ staffId: 'staff-sheila', staffName: 'Ana Pérez', contextId: 'branch-a' }}
        onClose={vi.fn()}
      />
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(/identificador válido/i);
    expect(screen.getByTestId('pairing-code-display')).not.toHaveTextContent(/\d{3}-\d{3}/);
    expect(localStorage.getItem('evogym:pairing_codes')).toBeNull();
  });
});
