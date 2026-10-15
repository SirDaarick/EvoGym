import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from '../../app/App';
import { DemoProvider } from '../../demo/DemoProvider';
import { AlertCenter } from './AlertCenter';

function renderAlertCenter() {
  return render(
    <MemoryRouter initialEntries={['/owner/alerts']}>
      <DemoProvider>
        <AlertCenter />
      </DemoProvider>
    </MemoryRouter>
  );
}

function mountApp(path = '/owner/alerts') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DemoProvider>
        <App />
      </DemoProvider>
    </MemoryRouter>
  );
}

describe('AlertCenter component', () => {
  it('renders the page header and period selector buttons', () => {
    renderAlertCenter();

    expect(
      screen.getByRole('heading', { name: 'Centro de alertas operativas' })
    ).toBeInTheDocument();
    expect(screen.getByText('PROPIETARIO · CENTRO DE CONTROL')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Hoy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Semana' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Todo' })).toBeInTheDocument();

    // Default period 'Hoy' is pressed/active
    expect(screen.getByRole('button', { name: 'Hoy' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('renders the 3 top KPI summary panels with direct actionable context', () => {
    renderAlertCenter();

    expect(screen.getByText('Alertas activas')).toBeInTheDocument();
    expect(screen.getByText('Descuadres y gastos')).toBeInTheDocument();
    expect(screen.getByText('Transferencias pendientes')).toBeInTheDocument();

    // Links to source sections
    expect(screen.getByRole('link', { name: /Revisar turnos/ })).toHaveAttribute(
      'href',
      '/owner/shifts'
    );
    expect(screen.getByRole('link', { name: /Auditar historial/ })).toHaveAttribute(
      'href',
      '/owner/history'
    );
  });

  it('displays category distribution donut chart and legend', () => {
    renderAlertCenter();

    expect(
      screen.getByRole('heading', { name: 'Distribución por categoría' })
    ).toBeInTheDocument();
    // Default seed has 1 expense alert ("Agua purificada para garrafón de recepción")
    expect(screen.getByText('Gasto')).toBeInTheDocument();
  });

  it('renders the interactive table with correct column headers and seed data rows', () => {
    renderAlertCenter();

    expect(screen.getByRole('region', { name: 'Centro de alertas operativas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fecha \/ Turno/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Categoría/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Detalle/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Responsable/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Impacto/ })).toBeInTheDocument();
    expect(screen.getByText('Acción')).toBeInTheDocument();

    // The seed expense alert appears in both KPI 2 and the table
    expect(
      screen.getByText(/Gasto: Agua purificada para garrafón de recepción/)
    ).toBeInTheDocument();
    expect(screen.getByText('Agua Cristalina')).toBeInTheDocument();
    expect(screen.getAllByText('$70.00 MXN').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('link', { name: 'Revisar turno' })).toHaveAttribute(
      'href',
      '/owner/shifts'
    );
  });

  it('allows switching period to Todo and filtering by category pills', async () => {
    renderAlertCenter();

    // Click on 'Todo'
    await userEvent.click(screen.getByRole('button', { name: 'Todo' }));
    expect(screen.getByRole('button', { name: 'Todo' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    // Filter pill for 'Todos' should be active
    const filterGroup = screen.getByRole('group', { name: 'Filtrar incidencias por categoría' });
    const allPill = within(filterGroup).getByRole('button', { name: /Todos/ });
    expect(allPill).toHaveAttribute('aria-pressed', 'true');

    // Click on 'Gasto de caja' category pill
    const expensePill = within(filterGroup).getByRole('button', { name: /Gasto de caja/ });
    await userEvent.click(expensePill);
    expect(expensePill).toHaveAttribute('aria-pressed', 'true');

    // Filtered row remains visible
    expect(
      screen.getByText(/Gasto: Agua purificada para garrafón de recepción/)
    ).toBeInTheDocument();
  });

  it('navigates to /owner/alerts within the App shell for OWNER role', () => {
    mountApp('/owner/alerts');

    // App sidebar should show 'Alertas' active link
    const alertsNav = screen.getByRole('link', { name: 'Alertas' });
    expect(alertsNav).toBeInTheDocument();
    expect(alertsNav).toHaveAttribute('href', '/owner/alerts');

    // Page title rendered inside main
    expect(
      screen.getByRole('heading', { name: 'Centro de alertas operativas' })
    ).toBeVisible();
  });

  it('does not expose /owner/alerts to RECEPTION role', () => {
    mountApp('/reception/alerts');

    // Reception should be redirected to /reception/home
    expect(
      screen.queryByRole('heading', { name: 'Centro de alertas operativas' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Inicio de recepción' })
    ).toBeInTheDocument();
  });
});
