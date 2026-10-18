import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { DemoProvider } from '../../demo/DemoProvider';
import { getFixedCosts, resetFixedCosts } from '../../demo/fixedCostsStore';
import { resetStaff } from '../staff/staffStore';
import { ExpenseReport } from './ExpenseReport';

function mount(path = '/owner/expenses') {
  return render(<MemoryRouter initialEntries={[path]}><DemoProvider><ExpenseReport /></DemoProvider></MemoryRouter>);
}
async function mountApp(path = '/owner/expenses') {
  render(<MemoryRouter initialEntries={[path]}><DemoProvider><App /></DemoProvider></MemoryRouter>);
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Cargando pantalla' })).not.toBeInTheDocument(), { timeout: 10000 });
}

describe('finance report', () => {
  beforeEach(() => { resetFixedCosts(); resetStaff(); window.localStorage.clear(); window.sessionStorage.clear(); });

  it('renders four accessible finance tabs and a shared exact-date toolbar', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Finanzas' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByRole('tab', { name: 'Balance' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Desde')).toHaveValue('2026-10-01');
    expect(screen.getByLabelText('Hasta')).toHaveValue('2026-10-08');
  });

  it('navigates tab focus without activation and excludes inactive heavy views', async () => {
    const user = userEvent.setup(); mount();
    screen.getByRole('tab', { name: 'Balance' }).focus(); await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Cobros' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Balance' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Balance' })).toBeVisible();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('tabpanel', { name: 'Cobros' })).toBeVisible();
    expect(document.getElementById('finance-panel-balance')).not.toBeVisible();
  });

  it('shows recorded totals, gross flow reconciliation and the accessible exact-values table', () => {
    mount();
    expect(screen.getByText('Entradas registradas')).toBeInTheDocument();
    expect(screen.getByText('Salidas registradas')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Valores exactos del flujo diario' })).toBeInTheDocument();
    expect(screen.getByText(/No representa saldo bancario ni utilidad/)).toBeInTheDocument();
  });

  it('filters expense totals and rows by category and query', async () => {
    const user = userEvent.setup(); mount();
    await user.click(screen.getByRole('tab', { name: 'Gastos' }));
    expect(screen.getByRole('region', { name: 'Detalle de gastos filtrados' })).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'Buscar concepto o proveedor' }), 'limpieza');
    expect(screen.getByText(/Importe filtrado:/)).toBeInTheDocument();
  });

  it('retains fixed cost adjustment controls and updates the configured monthly amount', async () => {
    const user = userEvent.setup(); mount();
    await user.click(screen.getByRole('tab', { name: 'Presupuesto' }));
    expect(screen.getAllByText(/no son pagos realizados/i).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Ajustar costos fijos' }));
    await user.clear(screen.getByLabelText('Renta (MXN/mes)'));
    await user.type(screen.getByLabelText('Renta (MXN/mes)'), '70000');
    await user.click(screen.getByRole('button', { name: 'Guardar costos' }));
    await waitFor(() => expect(getFixedCosts().rentMinor).toBe(7_000_000));
    expect(screen.getByRole('link', { name: 'Gestionar equipo y sueldos' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Nómina mensual estimada' })).toBeInTheDocument();
  });

  it('validates invalid date ranges and prints only through window.print', async () => {
    const user = userEvent.setup(); const print = vi.spyOn(window, 'print').mockImplementation(() => {}); mount();
    await user.clear(screen.getByLabelText('Desde')); await user.type(screen.getByLabelText('Desde'), '2025-01-01');
    expect(screen.getByRole('status')).toHaveTextContent(/revisa las fechas y la duración del rango/i);
    expect(screen.getByText(/máximo 366 días/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Exportar / imprimir' }));
    expect(print).toHaveBeenCalledOnce();
  });

  it('integrates Finanzas into the owner navigation on the existing route', async () => {
    await mountApp();
    expect(screen.getByRole('link', { name: 'Finanzas' })).toHaveAttribute('href', '/owner/expenses');
    expect(screen.queryByRole('link', { name: 'Gastos' })).not.toBeInTheDocument();
  });
});
