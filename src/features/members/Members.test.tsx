import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from '../../app/App';
import { DemoProvider } from '../../demo/DemoProvider';

function mount(path = '/reception/members') {
  render(<MemoryRouter initialEntries={[path]}><DemoProvider><App /></DemoProvider></MemoryRouter>);
}
describe('member workflow', () => {
  it('registers a measured visit and tries automatic closure without inventing time', async () => {
    mount('/reception/members/demo-active');
    await userEvent.click(screen.getByText('Reloj y cierre de demostración'));
    await userEvent.click(screen.getByRole('button', { name: 'Registrar entrada demo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Avanzar 30 minutos' }));
    await userEvent.click(screen.getByRole('button', { name: 'Registrar salida demo' }));
    expect(screen.getByRole('status', { name: 'Resultado de asistencia' })).toHaveTextContent('Salida registrada');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar entrada demo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Simular cierre 22:00' }));
    expect(screen.getByText('Cierre automático · duración desconocida')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Registrar salida demo' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Restablecer demo' }));
    expect(screen.getByLabelText('Hora de demostración')).toHaveTextContent('12:00');
    expect(screen.getByRole('button', { name: 'Registrar entrada demo' })).toBeEnabled();
  });
  it('groups global suggestions and selects a member with the keyboard', async () => {
    mount('/reception/home');
    const input = screen.getByRole('combobox', { name: 'Búsqueda global de socios' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await userEvent.type(input, 'Demo');
    expect(within(screen.getByRole('listbox')).getAllByRole('group').map(group => group.getAttribute('aria-label'))).toEqual(['Activos · demo', 'Inactivos · demo', 'Sin confirmar']);
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}{Enter}');
    expect(screen.getByRole('heading', { name: 'Demo Activa' })).toBeVisible();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByText(/Escenario de demostración: Activa/)).toBeVisible();
  });
  it('shows no results and Escape closes suggestions', async () => {
    mount();
    const input = screen.getByRole('combobox', { name: 'Búsqueda global de socios' });
    await userEvent.type(input, 'nobody');
    expect(screen.getByText('Sin coincidencias de socios.')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Sin coincidencias de socios.')).not.toBeInTheDocument();
  });
  it('requires renewal in the expired demo without pretending attendance exists', () => {
    mount('/reception/members/demo-expired');
    expect(screen.getByText('Renovar antes de registrar una nueva entrada. Sin prórroga en esta demo.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Registrar entrada' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Registrar pago de membresía' })).toBeVisible();
  });
  it('searches members and creates a demo member with only a required name', async () => {
    mount();
    await userEvent.type(screen.getByLabelText('Buscar socio'), 'Mariana');
    expect(screen.getByRole('link', { name: 'Mariana López' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Carlos Rivera' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Nuevo socio' }));
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana Demo');
    await userEvent.click(screen.getByRole('button', { name: 'Crear socio de demostración' }));
    expect(screen.getByRole('heading', { name: 'Ana Demo' })).toBeVisible();
  });
  it('reviews a cash payment, records it and leaves access dates unresolved', async () => {
    mount('/reception/members/demo-002');
    await userEvent.click(screen.getByRole('link', { name: 'Registrar pago de membresía' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revisar pago' }));
    expect(screen.getByRole('heading', { name: 'Revisar pago de membresía' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar pago de demostración' }));
    expect(screen.getByRole('heading', { name: 'Pago completo registrado' })).toBeVisible();
    expect(screen.getByText(/no concede acceso automáticamente/)).toBeVisible();
    await userEvent.click(screen.getByRole('link', { name: 'Ver socio' }));
    expect(screen.getByText('Pagado · fechas por definir')).toBeVisible();
  });
  it('does not present a transfer as paid', async () => {
    mount('/reception/members/demo-002/payment');
    await userEvent.selectOptions(screen.getByLabelText('Método'), 'transfer');
    await userEvent.click(screen.getByRole('button', { name: 'Revisar pago' }));
    await userEvent.click(screen.getByRole('button', { name: 'Registrar transferencia pendiente' }));
    expect(screen.getByRole('heading', { name: 'Transferencia sin confirmar' })).toBeVisible();
    expect(screen.queryByText('Pago completo registrado')).not.toBeInTheDocument();
  });
});
