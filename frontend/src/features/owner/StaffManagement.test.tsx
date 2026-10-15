import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../app/App';
import { DemoProvider } from '../../demo/DemoProvider';
import { resetStaff } from '../staff/staffStore';

async function mount(path = '/owner/staff') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <DemoProvider>
        <App />
      </DemoProvider>
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Cargando pantalla' })).not.toBeInTheDocument(), { timeout: 10000 });
}

describe('StaffManagement (T02 — Admin Staff Management)', () => {
  beforeEach(() => {
    resetStaff();
  });

  it('renders reception staff table with salary and without KPI summary cards', async () => {
    await mount('/owner/staff');

    expect(screen.getByRole('heading', { name: 'Equipo de Recepción' })).toBeVisible();
    // Verify NO KPI cards are rendered
    expect(screen.queryByText(/Total recepcionistas/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Perfiles activos/i)).not.toBeInTheDocument();

    // Verify receptionists are listed with shift, salary, and credential indicator
    expect(screen.getByText('Emigdio')).toBeVisible();
    expect(screen.getByText('Sheila')).toBeVisible();
    expect(screen.getAllByText('$14,000.00')[0]).toBeVisible(); // Emigdio's salary
    expect(screen.getAllByText('🔒 Con PIN').length).toBeGreaterThan(0);
    expect(screen.getAllByText('⚡ Acceso directo').length).toBeGreaterThan(0);
  });

  it('filters staff by search query and status filter buttons', async () => {
    await mount('/owner/staff');

    // Search for Sheila
    await userEvent.type(screen.getByLabelText('Buscar recepcionista'), 'Sheila');
    expect(screen.getByText('Sheila')).toBeVisible();
    expect(screen.queryByText('Emigdio')).not.toBeInTheDocument();

    // Clear search
    await userEvent.clear(screen.getByLabelText('Buscar recepcionista'));
    expect(screen.getByText('Emigdio')).toBeVisible();

    // Inactive filter with JellyRadio (initially all are active)
    await userEvent.click(screen.getByRole('radio', { name: 'Inactivos' }));
    expect(
      screen.getByText('No se encontraron recepcionistas con los criterios actuales.')
    ).toBeVisible();

    // Return to Todos with JellyRadio
    await userEvent.click(screen.getByRole('radio', { name: 'Todos' }));
    expect(screen.getByText('Emigdio')).toBeVisible();
  });

  it('toggles staff active/inactive status and reflects in profile selection', async () => {
    await mount('/owner/staff');

    // Find Sheila row and deactivate her
    const deactivateButtons = screen.getAllByRole('button', { name: 'Desactivar' });
    // Sheila is the second receptionist
    await userEvent.click(deactivateButtons[1]);

    // Check toast notification is shown
    expect(screen.getByText(/ya no aparecerá en la pantalla de inicio/)).toBeInTheDocument();

    // Sheila now shows Activar button
    expect(screen.getByRole('button', { name: 'Activar' })).toBeVisible();
  });

  it('validates 2-phase PIN matching when creating a new receptionist with salary', async () => {
    await mount('/owner/staff');

    await userEvent.click(screen.getByRole('button', { name: '+ Nuevo recepcionista' }));
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Nuevo Recepcionista' })).toBeVisible();

    await userEvent.type(screen.getByLabelText('Nombre completo *'), 'Lucía Ramos');
    await userEvent.clear(screen.getByLabelText('Sueldo mensual (MXN) *'));
    await userEvent.type(screen.getByLabelText('Sueldo mensual (MXN) *'), '9000');

    // Enable PIN switch
    await userEvent.click(screen.getByRole('switch', { name: 'Activar PIN de acceso' }));

    // Type non-matching PINs
    const pin1Input = screen.getByLabelText('Primer ingreso del PIN');
    const pin2Input = screen.getByLabelText('Confirmación del PIN');

    await userEvent.type(pin1Input, '5678');
    await userEvent.type(pin2Input, '9999');

    // Error should be indicated
    expect(screen.getByText('Los PINs no coinciden. Por favor verifica.')).toBeInTheDocument();
    // Save button should be disabled
    expect(screen.getByRole('button', { name: 'Crear perfil' })).toBeDisabled();

    // Correct second PIN to match using backspaces to clear slots
    await userEvent.type(pin2Input, '{backspace}{backspace}{backspace}{backspace}5678');
    expect(screen.getByText('✓ PIN confirmado correctamente')).toBeInTheDocument();

    // Submit form
    await userEvent.click(screen.getByRole('button', { name: 'Crear perfil' }));

    // Lucía Ramos is now in the table with $9,000.00
    expect(screen.getByText('Lucía Ramos')).toBeVisible();
    expect(screen.getByText('$9,000.00')).toBeVisible();
  });

  it('displays active and inactive counts and allows selecting status in the modal with JellyRadio', async () => {
    await mount('/owner/staff');

    // Header displays counts
    expect(screen.getByText(/9 en total/)).toHaveTextContent('9 activos · 0 inactivos · 9 en total');

    // Open create modal and select Inactivo
    await userEvent.click(screen.getByRole('button', { name: '+ Nuevo recepcionista' }));
    await userEvent.type(screen.getByLabelText('Nombre completo *'), 'Esteban Morales');

    // Select Inactivo via JellyRadio in modal
    await userEvent.click(screen.getByRole('radio', { name: '○ Inactivo' }));

    // Submit form
    await userEvent.click(screen.getByRole('button', { name: 'Crear perfil' }));

    // Count updates
    expect(screen.getByText(/10 en total/)).toHaveTextContent('9 activos · 1 inactivos · 10 en total');

    // Esteban Morales is created with badge ○ Inactivo
    expect(screen.getByText('Esteban Morales')).toBeVisible();
    expect(screen.getByText('○ Inactivo')).toBeVisible();
  });

  it('supports interactive column sorting with TanStack Table', async () => {
    await mount('/owner/staff');

    // Initially in default list order: Emigdio is first row
    const rowsInitial = screen.getAllByRole('row');
    expect(rowsInitial[1]).toHaveTextContent('Emigdio');

    // Sort by Recepcionista column (click sort button)
    const sortNameBtn = screen.getByRole('button', { name: /ordenar por recepcionista/i });
    await userEvent.click(sortNameBtn);

    // Ascending: Alan should now be the first row
    const rowsAsc = screen.getAllByRole('row');
    expect(rowsAsc[1]).toHaveTextContent('Alan');

    // Click again for descending sort: Tadeo is first row
    await userEvent.click(sortNameBtn);
    const rowsDesc = screen.getAllByRole('row');
    expect(rowsDesc[1]).toHaveTextContent('Tadeo');

    // Click on Sueldo mensual sort button
    const sortSalaryBtn = screen.getByRole('button', { name: /ordenar por sueldo mensual/i });
    await userEvent.click(sortSalaryBtn);

    // Ascending: Iñaky ($4,000.00) is first
    const rowsSalaryAsc = screen.getAllByRole('row');
    expect(rowsSalaryAsc[1]).toHaveTextContent('Iñaky');
    expect(rowsSalaryAsc[1]).toHaveTextContent('$4,000.00');
  });
});
