import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { Login } from './Login';
import { getSelectedStaff, setSelectedStaff } from '../staff/staffStore';

describe('Login component', () => {
  it('renders the login form with username, password, brand logo and controls', () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );

    const logo = document.querySelector('.staff-logo-mark img');
    expect(logo).toHaveAttribute('src', expect.stringContaining('evogym-logo-128.webp'));
    expect(screen.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    expect(screen.getByLabelText('Usuario')).toBeVisible();
    expect(screen.getByLabelText('Contraseña')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Modo Kiosco/i })).toBeVisible();
  });

  it('validates empty inputs and displays error', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ingresa tu usuario y contraseña.');
    expect(getSelectedStaff()).toBeNull();
  });

  it('displays error on unknown username', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Usuario'), 'nonexistent_user');
    await user.type(screen.getByLabelText('Contraseña'), '1234');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Usuario no encontrado.');
    expect(getSelectedStaff()).toBeNull();
  });

  it('displays error on incorrect password', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Usuario'), 'Admin');
    await user.type(screen.getByLabelText('Contraseña'), 'wrongpass');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Contraseña incorrecta.');
    expect(getSelectedStaff()).toBeNull();
  });

  it('authorizes admin credentials and sets selected staff identity', async () => {
    const user = userEvent.setup();
    setSelectedStaff(null);

    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Usuario'), 'Admin');
    await user.type(screen.getByLabelText('Contraseña'), '1234');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(getSelectedStaff()).toMatchObject({ id: 'admin-1', name: 'Admin' });
  });

  it('authorizes reception staff credentials (case-insensitive)', async () => {
    const user = userEvent.setup();
    setSelectedStaff(null);

    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Usuario'), 'emigdio');
    await user.type(screen.getByLabelText('Contraseña'), '1234');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(getSelectedStaff()).toMatchObject({ id: 'staff-emigdio', name: 'Emigdio' });
  });
});
