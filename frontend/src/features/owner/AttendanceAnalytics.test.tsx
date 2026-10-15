import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from '../../app/App';
import { DemoProvider } from '../../demo/DemoProvider';
import { AttendanceAnalytics } from './AttendanceAnalytics';

function renderAttendanceAnalytics() {
  return render(
    <MemoryRouter initialEntries={['/owner/attendance']}>
      <DemoProvider>
        <AttendanceAnalytics />
      </DemoProvider>
    </MemoryRouter>
  );
}

async function mountApp(path = '/owner/attendance') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <DemoProvider>
        <App />
      </DemoProvider>
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Cargando pantalla' })).not.toBeInTheDocument(), { timeout: 10000 });
}

describe('AttendanceAnalytics component', () => {
  it('exposes the current table sorting direction', async () => {
    renderAttendanceAnalytics();
    const header = screen.getByRole('button', { name: /Socio en sala/ }).closest('th');
    expect(header).toHaveAttribute('aria-sort', 'none');
    await userEvent.setup().click(screen.getByRole('button', { name: /Socio en sala/ }));
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    await userEvent.setup().click(screen.getByRole('button', { name: /Socio en sala/ }));
    expect(header).toHaveAttribute('aria-sort', 'descending');
  });

  it('renders the page header and period selector buttons', async () => {
    renderAttendanceAnalytics();

    expect(
      screen.getByRole('heading', { name: 'Afluencia y capacidad del gimnasio' })
    ).toBeInTheDocument();
    expect(screen.getByText('PROPIETARIO · AFLUENCIA Y AFORO')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Filtrar hoy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filtrar últimos 7 días' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filtrar últimos 30 días' })).toBeInTheDocument();

    // Default period is 'week' ('Últimos 7 días')
    const weekBtn = screen.getByRole('button', { name: 'Filtrar últimos 7 días' });
    expect(weekBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('allows switching period filter pills', async () => {
    const user = userEvent.setup();
    renderAttendanceAnalytics();

    const todayBtn = screen.getByRole('button', { name: 'Filtrar hoy' });
    const weekBtn = screen.getByRole('button', { name: 'Filtrar últimos 7 días' });

    expect(weekBtn).toHaveAttribute('aria-pressed', 'true');
    expect(todayBtn).toHaveAttribute('aria-pressed', 'false');

    await user.click(todayBtn);
    expect(todayBtn).toHaveAttribute('aria-pressed', 'true');
    expect(weekBtn).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders all Bento KPI cards with capacity and traffic metrics', async () => {
    renderAttendanceAnalytics();

    // KPI Titles
    expect(screen.getByText('Ocupación en vivo')).toBeInTheDocument();
    expect(screen.getByText('Hora pico')).toBeInTheDocument();
    expect(screen.getByText('Hora valle')).toBeInTheDocument();
    expect(screen.getByText('Día más concurrido')).toBeInTheDocument();
    expect(screen.getByText('Duración promedio')).toBeInTheDocument();
    expect(screen.getByText('Total visitas')).toBeInTheDocument();

    // Capacity denominator
    expect(screen.getByText('/ 50 socios')).toBeInTheDocument();
    expect(screen.getByText(/Capacidad máxima: 50 personas/)).toBeInTheDocument();

    // Workout duration standard indicator
    expect(screen.getByText(/Estándar fitness 60–75 min/)).toBeInTheDocument();
  });

  it('renders TanStack Charts containers for hourly and weekly traffic', async () => {
    renderAttendanceAnalytics();

    expect(
      screen.getByRole('heading', { name: 'Afluencia por hora operativa (06:00 a 22:00)' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Distribución semanal por día' })
    ).toBeInTheDocument();

    // Legends
    expect(screen.getAllByText(/Hora pico/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Hora valle/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Día estelar/)).toBeInTheDocument();
  });

  it('renders operational time slots (Matutino, Vespertino, Nocturno)', async () => {
    renderAttendanceAnalytics();

    expect(
      screen.getByRole('heading', { name: 'Franjas operativas y balance de carga' })
    ).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Matutino' })).toBeInTheDocument();
    expect(screen.getByText('06:00–12:00')).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Vespertino' })).toBeInTheDocument();
    expect(screen.getByText('12:00–17:00')).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Nocturno' })).toBeInTheDocument();
    expect(screen.getByText('17:00–22:00')).toBeInTheDocument();
  });

  it('renders Live Occupants TanStack Table and supports search filtering', async () => {
    const user = userEvent.setup();
    renderAttendanceAnalytics();

    expect(
      screen.getByRole('heading', { name: 'Socios actualmente en el gimnasio' })
    ).toBeInTheDocument();

    // Table region
    const tableRegion = screen.getByRole('region', {
      name: 'Tabla de socios activos en el gimnasio',
    });
    expect(tableRegion).toBeInTheDocument();

    // Mariana López is active in the demo adapter state
    expect(within(tableRegion).getByText('Mariana López')).toBeInTheDocument();
    expect(within(tableRegion).getByText('Gym mensual')).toBeInTheDocument();
    expect(within(tableRegion).getByText('En entrenamiento')).toBeInTheDocument();

    // Test search filter
    const searchInput = screen.getByRole('searchbox', { name: 'Buscar socio en sala' });
    await user.type(searchInput, 'Mariana');
    expect(within(tableRegion).getByText('Mariana López')).toBeInTheDocument();

    await user.clear(searchInput);
    await user.type(searchInput, 'NonExistentMember');
    expect(screen.getByText('No se encontraron socios que coincidan con la búsqueda.')).toBeInTheDocument();
  });

  it('renders strategic recommendations panel for the gym owner', async () => {
    renderAttendanceAnalytics();

    expect(
      screen.getByRole('heading', {
        name: 'Recomendaciones estratégicas para el propietario',
      })
    ).toBeInTheDocument();

    // Action recommendations presence
    expect(screen.getByText(/Refuerzo de personal en hora pico/)).toBeInTheDocument();
    expect(screen.getByText(/Campaña comercial para horario valle/)).toBeInTheDocument();
    expect(screen.getByText(/Monitoreo de aforo en sala/)).toBeInTheDocument();
    expect(screen.getAllByText('Acción recomendada:').length).toBeGreaterThan(0);
  });

  it('navigates to /owner/attendance within App shell and highlights navigation item', async () => {
    await mountApp('/owner/attendance');

    expect(
      screen.getByRole('heading', { name: 'Afluencia y capacidad del gimnasio' })
    ).toBeInTheDocument();

    const attendanceNavLinks = screen.getAllByRole('link', { name: /Afluencia/ });
    expect(attendanceNavLinks.length).toBeGreaterThan(0);
    expect(attendanceNavLinks[0]).toHaveAttribute('href', '/owner/attendance');
  });
});
