import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { StaffProfileSelection } from './StaffProfileSelection';
import { getSelectedStaff, setSelectedStaff } from './staffStore';

describe('staff profile author identity lifecycle', () => {
  it('uses the optimized brand image with intrinsic dimensions', () => {
    render(<MemoryRouter><StaffProfileSelection /></MemoryRouter>);
    const logo = document.querySelector('.staff-logo-mark img');
    expect(logo).toHaveAttribute('src', expect.stringContaining('evogym-logo-128.webp'));
    expect(logo).toHaveAttribute('width', '128');
    expect(logo).toHaveAttribute('height', '124');
  });
  it('sets identity only after a successful PIN and clears it on selector entry', async () => {
    const user = userEvent.setup();
    setSelectedStaff({ id: 'old', name: 'Previous employee' });
    render(<MemoryRouter><StaffProfileSelection /></MemoryRouter>);
    expect(getSelectedStaff()).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Admin' }));
    expect(getSelectedStaff()).toBeNull();
    const pin = screen.getByLabelText('Ingresa el PIN de 4 dígitos para Admin');
    await user.type(pin, '0000');
    expect(await screen.findByRole('alert')).toHaveTextContent('PIN incorrecto');
    expect(getSelectedStaff()).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await user.click(screen.getByRole('button', { name: 'Admin' }));
    await user.type(screen.getByLabelText('Ingresa el PIN de 4 dígitos para Admin'), '1234');
    expect(getSelectedStaff()).toMatchObject({ id: 'admin-1', name: 'Admin' });
  });

  it('sets identity immediately for an existing no-PIN profile', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><StaffProfileSelection /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /Mikel/ }));
    expect(getSelectedStaff()).toMatchObject({ id: 'staff-mikel', name: 'Mikel' });
  });
});
