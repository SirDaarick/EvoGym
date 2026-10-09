import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { DemoProvider, useDemo } from '../demo/DemoProvider';

function Location() { return <output aria-label="Ruta actual">{useLocation().pathname}</output>; }
function DemoProbe() {
  const { state, update } = useDemo();
  return <><output aria-label="Socios de prueba">{state.members.length}</output>
    <button onClick={() => update(current => ({ ...current, members: [] }))}>Vaciar prueba</button></>;
}
function mount(path = '/owner/overview') {
  render(<MemoryRouter initialEntries={[path]}><DemoProvider><App /><Location /><DemoProbe /></DemoProvider></MemoryRouter>);
}

describe('application foundation', () => {
  it('clears stale suggestions when resetting demo or switching profile', async () => {
    mount('/reception/home');
    await userEvent.type(screen.getByRole('combobox', { name: 'Búsqueda global de socios' }), 'Demo');
    expect(screen.getByRole('listbox')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Restablecer demo' }));
    expect(screen.getByRole('combobox', { name: 'Búsqueda global de socios' })).toHaveValue('');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('combobox', { name: 'Búsqueda global de socios' }), 'Demo');
    await userEvent.selectOptions(screen.getByLabelText('Rol de demostración'), 'OWNER');
    expect(screen.getByRole('combobox', { name: 'Búsqueda global de socios' })).toHaveValue('');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
  it('offers only two direct demo profiles at root and can change profile', async () => {
    mount('/');
    expect(screen.getByRole('heading', { name: 'Elige tu perfil' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Admin/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Recepción/ })).toBeVisible();
    expect(screen.queryByLabelText('Rol de demostración')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/contraseña|PIN/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Recepción/ }));
    expect(screen.getByLabelText('Ruta actual')).toHaveTextContent('/reception/home');
    expect(screen.getByRole('link', { name: /Inicio/ })).toBeVisible();
    await userEvent.click(screen.getByRole('link', { name: 'Cambiar perfil' }));
    await userEvent.click(screen.getByRole('button', { name: /Admin/ }));
    expect(screen.getByLabelText('Ruta actual')).toHaveTextContent('/owner/overview');
  });
  it('labels demo data and owner navigation', () => {
    mount();
    expect(screen.getByText('Datos de demostración')).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible();
    expect(screen.getByRole('link', { name: /Historial/ })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Resumen del negocio' })).toBeVisible();
  });
  it('switches role, route and visible navigation without claiming authentication', async () => {
    mount();
    await userEvent.selectOptions(screen.getByLabelText('Rol de demostración'), 'RECEPTION');
    expect(screen.getByLabelText('Ruta actual')).toHaveTextContent('/reception/home');
    expect(screen.queryByRole('link', { name: /Historial/ })).not.toBeInTheDocument();
    expect(screen.getByText(/no autentica/)).toBeVisible();
  });
  it('resets changed sample data and announces the result', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Vaciar prueba' }));
    expect(screen.getByLabelText('Socios de prueba')).toHaveTextContent('0');
    await userEvent.click(screen.getByRole('button', { name: 'Restablecer demo' }));
    expect(screen.getByLabelText('Socios de prueba')).toHaveTextContent('6');
    expect(screen.getByRole('status', { name: 'Resultado de demostración' })).toHaveTextContent('Datos de demostración restablecidos');
  });
  it('redirects an unavailable reception route to its primary task', () => {
    mount('/reception/history');
    expect(screen.queryByRole('link', { name: /Historial/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Rol de demostración')).toHaveValue('RECEPTION');
    expect(screen.getByLabelText('Ruta actual')).toHaveTextContent('/reception/home');
  });
  it('preserves a shared task when switching role', async () => {
    mount('/owner/shifts');
    await userEvent.selectOptions(screen.getByLabelText('Rol de demostración'), 'RECEPTION');
    expect(screen.getByLabelText('Ruta actual')).toHaveTextContent('/reception/shifts');
  });
  it('keeps the reception view when opening the component catalog', async () => {
    mount('/reception/members');
    await userEvent.click(screen.getByRole('link', { name: 'Sistema de componentes' }));
    expect(screen.getByLabelText('Rol de demostración')).toHaveValue('RECEPTION');
    expect(screen.queryByRole('link', { name: /Historial/ })).not.toBeInTheDocument();
  });
  it('renders the shared component catalog', () => {
    mount('/components');
    expect(screen.getByRole('heading', { name: 'Componentes compartidos' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Acción pendiente' })).toBeDisabled();
  });
});
