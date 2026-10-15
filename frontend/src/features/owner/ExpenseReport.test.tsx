import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { DemoProvider } from '../../demo/DemoProvider';
import { resetFixedCosts } from '../../demo/fixedCostsStore';
import { resetStaff, saveStaffProfile, toggleStaffActive } from '../staff/staffStore';
import { ExpenseReport } from './ExpenseReport';

function renderExpenseReport() {
  return render(
    <MemoryRouter initialEntries={['/owner/expenses']}>
      <DemoProvider>
        <ExpenseReport />
      </DemoProvider>
    </MemoryRouter>
  );
}

function mountApp(path = '/owner/expenses') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DemoProvider>
        <App />
      </DemoProvider>
    </MemoryRouter>
  );
}

describe('ExpenseReport component', () => {
  beforeEach(() => {
    resetFixedCosts();
    resetStaff();
    if (typeof window !== 'undefined') {
      window.localStorage?.clear();
      window.sessionStorage?.clear();
    }
  });

  it('renders the page header, title, and PDF export button', () => {
    renderExpenseReport();

    expect(
      screen.getByRole('heading', { name: 'Reporte y exportación de gastos' })
    ).toBeInTheDocument();
    expect(screen.getByText('PROPIETARIO · FINANZAS OPERATIVAS')).toBeInTheDocument();

    const exportBtn = screen.getByRole('button', { name: 'Exportar reporte (PDF)' });
    expect(exportBtn).toBeInTheDocument();
  });

  it('triggers window.print() when clicking the PDF export button', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    renderExpenseReport();

    const exportBtn = screen.getByRole('button', { name: 'Exportar reporte (PDF)' });
    await userEvent.click(exportBtn);

    expect(printSpy).toHaveBeenCalledTimes(1);
    printSpy.mockRestore();
  });

  it('displays the 3 Bento business KPIs (Punto de equilibrio, Variables, Total comprometido)', () => {
    renderExpenseReport();

    expect(screen.getByText('Punto de equilibrio')).toBeInTheDocument();
    expect(screen.getByText('Gastos variables del período')).toBeInTheDocument();
    expect(screen.getByText('Total comprometido')).toBeInTheDocument();

    // Values based on dynamic SSOT (Renta $66k + Nómina $80k + Servicios $18k = $164,000 / 20 = $8,200/día)
    expect(screen.getByText('$8,200.00')).toBeInTheDocument(); // Daily break-even
    expect(screen.getAllByText(/Fijo mensual:/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/164,000\.00/).length).toBeGreaterThanOrEqual(1);

    // Seed state has $70.00 MXN in variable expenses
    expect(screen.getAllByText('$70.00 MXN').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('$164,070.00 MXN')).toBeInTheDocument(); // Consolidated total
  });

  it('renders the visual organizer with TanStack Chart and major cost blocks', () => {
    renderExpenseReport();

    expect(
      screen.getByRole('heading', { name: 'Comparativa de bloques de costo' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Estructura presupuestal' })
    ).toBeInTheDocument();

    // Major cost blocks (present in chart axis tick, summary cards, and tables)
    expect(screen.getAllByText('Nómina').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('$80,000.00 MXN').length).toBeGreaterThanOrEqual(1);

    expect(screen.getAllByText('Renta').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('$66,000.00 MXN').length).toBeGreaterThanOrEqual(1);

    expect(screen.getAllByText('Servicios').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('$18,000.00 MXN').length).toBeGreaterThanOrEqual(1);

    expect(screen.getAllByText('Variables').length).toBeGreaterThanOrEqual(2);
  });

  it('renders the two subview tabs and toggles between them', async () => {
    renderExpenseReport();

    const tabVariables = screen.getByRole('tab', { name: 'Gastos Variables y Caja Chica' });
    const tabFixed = screen.getByRole('tab', { name: 'Estructura Fija y Nómina' });

    expect(tabVariables).toBeInTheDocument();
    expect(tabFixed).toBeInTheDocument();

    // Default active is variables
    expect(tabVariables).toHaveAttribute('aria-selected', 'true');
    expect(tabFixed).toHaveAttribute('aria-selected', 'false');

    // Switch to Fixed tab
    await userEvent.click(tabFixed);
    expect(tabFixed).toHaveAttribute('aria-selected', 'true');
    expect(tabVariables).toHaveAttribute('aria-selected', 'false');

    // Fixed tab content visible
    expect(screen.getByRole('heading', { name: 'Renta de Local' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Servicios Básicos' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nómina Fija' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Nómina de Personal/ })).toBeInTheDocument();

    // Switch back to Variables tab
    await userEvent.click(tabVariables);
    expect(tabVariables).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByRole('heading', { name: 'Auditoría de compras y caja chica' })
    ).toBeInTheDocument();
  });

  it('renders the fixed costs breakdown cards and 9-member payroll table in the Fixed tab', async () => {
    renderExpenseReport();

    const tabFixed = screen.getByRole('tab', { name: 'Estructura Fija y Nómina' });
    await userEvent.click(tabFixed);

    // Services breakdown list
    expect(screen.getByText('Agua de la red')).toBeInTheDocument();
    expect(screen.getByText(/9,000\.00 MXN\/mes/)).toBeInTheDocument();
    expect(screen.getByText('Luz / CFE')).toBeInTheDocument();
    expect(screen.getByText(/8,000\.00 MXN\/mes/)).toBeInTheDocument();
    expect(screen.getByText('Internet / Teléfono')).toBeInTheDocument();
    expect(screen.getByText(/800\.00 MXN\/mes/)).toBeInTheDocument();
    expect(screen.getByText('Basura y recolección')).toBeInTheDocument();
    expect(screen.getByText(/200\.00 MXN\/mes/)).toBeInTheDocument();

    // 9 Staff members from Excel
    const staffNames = [
      'Silvia',
      'Sheila',
      'Emigdio',
      'Alan',
      'Maho',
      'Mikel',
      'Charly',
      'Iñaky',
      'Tadeo',
    ];
    for (const name of staffNames) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }

    // Emigdio salary check ($14,000/mes, $3,500/semana, $700/día)
    expect(screen.getByText('$14,000.00 MXN')).toBeInTheDocument();
    expect(screen.getByText('$3,500.00 MXN')).toBeInTheDocument();
    expect(screen.getByText('$700.00 MXN')).toBeInTheDocument();

    // Payroll total row
    expect(screen.getByText('TOTAL NÓMINA (9 COLABORADORES)')).toBeInTheDocument();
  });

  it('opens "Ajustar costos fijos" modal and updates KPIs upon submitting changes', async () => {
    renderExpenseReport();

    // Go to Fixed Structure tab
    await userEvent.click(screen.getByRole('tab', { name: 'Estructura Fija y Nómina' }));

    // Click action button to open modal
    const adjustBtn = screen.getByRole('button', { name: /Ajustar costos fijos/i });
    expect(adjustBtn).toBeInTheDocument();
    await userEvent.click(adjustBtn);

    // Modal dialog is displayed
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ajustar Costos Fijos Mensuales' })).toBeInTheDocument();

    // Inputs have current default values
    const rentInput = screen.getByLabelText(/Renta de local/i);
    expect(rentInput).toHaveValue(66000);

    const aguaInput = screen.getByLabelText(/Agua potable/i);
    expect(aguaInput).toHaveValue(9000);

    // Update Renta to 70000
    await userEvent.clear(rentInput);
    await userEvent.type(rentInput, '70000');

    // Save changes
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    // Modal closes
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // KPIs immediately re-render with new values
    // New total fixed: 70k + 80k + 18k = $168,000 MXN -> Daily break-even: 168k / 20 = $8,400.00
    expect(screen.getByText('$8,400.00')).toBeInTheDocument();
    expect(screen.getAllByText(/168,000\.00/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('$70,000.00 MXN')).toBeInTheDocument();
  });

  it('validates invalid inputs in the adjust fixed costs modal without saving', async () => {
    renderExpenseReport();

    await userEvent.click(screen.getByRole('tab', { name: 'Estructura Fija y Nómina' }));
    await userEvent.click(screen.getByRole('button', { name: /Ajustar costos fijos/i }));

    const rentInput = screen.getByLabelText(/Renta de local/i);
    await userEvent.clear(rentInput);
    await userEvent.type(rentInput, '-1000');

    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    // Validation error displayed
    expect(screen.getByRole('alert')).toHaveTextContent(/números positivos válidos/);

    // Close via Cancel
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Break-even remains unchanged at $8,200.00
    expect(screen.getByText('$8,200.00')).toBeInTheDocument();
  });

  it('navigates to /owner/staff via "Gestionar equipo y sueldos →" button', async () => {
    mountApp('/owner/expenses');

    // Switch to fixed tab
    await userEvent.click(screen.getByRole('tab', { name: 'Estructura Fija y Nómina' }));

    const staffLinkBtn = screen.getByRole('button', { name: /Gestionar equipo y sueldos/i });
    expect(staffLinkBtn).toBeInTheDocument();

    await userEvent.click(staffLinkBtn);

    // Navigates to Staff Management
    expect(screen.getByRole('heading', { name: 'Equipo de Recepción' })).toBeInTheDocument();
  });

  it('immediately reflects staff modifications in the payroll table and KPIs', async () => {
    renderExpenseReport();

    await userEvent.click(screen.getByRole('tab', { name: 'Estructura Fija y Nómina' }));
    expect(screen.getByText('TOTAL NÓMINA (9 COLABORADORES)')).toBeInTheDocument();

    // Simulate staff deactivation from /owner/staff
    act(() => {
      toggleStaffActive('staff-inaky');
    });

    // Immediately re-renders table with 8 active staff
    expect(screen.getByText('TOTAL NÓMINA (8 COLABORADORES)')).toBeInTheDocument();
    // Payroll reduced by $4,000 -> from $80,000 to $76,000
    expect(screen.getAllByText('$76,000.00 MXN').length).toBeGreaterThanOrEqual(1);

    // Simulate staff salary raise: Silvia from $8,000 to $10,000
    act(() => {
      saveStaffProfile({
        id: 'staff-silvia',
        name: 'Silvia',
        role: 'RECEPTION',
        shift: 'Matutino',
        salaryMinor: 1000000,
        active: true,
        hasPin: true,
      });
    });

    // Silvia now shows $10,000.00 MXN
    const silviaRow = screen.getByText('Silvia').closest('tr');
    expect(within(silviaRow!).getByText('$10,000.00 MXN')).toBeInTheDocument();
    expect(within(silviaRow!).getByText('$2,500.00 MXN')).toBeInTheDocument();
  });

  it('renders sortable itemized table with seed expense data and category pills in Variables tab', () => {
    renderExpenseReport();

    expect(
      screen.getByRole('region', { name: 'Detalle desglosado de gastos de caja' })
    ).toBeInTheDocument();

    // Table Headers
    expect(screen.getByRole('button', { name: /Fecha \/ Hora/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Turno/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Categoría/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Concepto/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Proveedor \/ Responsable/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Monto/ })).toBeInTheDocument();

    // Seed expense row content
    expect(
      screen.getByText('Agua purificada para garrafón de recepción')
    ).toBeInTheDocument();
    expect(screen.getByText('Agua Cristalina')).toBeInTheDocument();
    expect(screen.getByText('06:00–14:00')).toBeInTheDocument();
  });

  it('supports searching by concept and filtering by category pills', async () => {
    renderExpenseReport();

    const searchInput = screen.getByRole('searchbox', {
      name: 'Buscar gastos por concepto o proveedor',
    });
    expect(searchInput).toBeInTheDocument();

    // Search for non-existent item
    await userEvent.type(searchInput, 'inexistente');
    expect(
      screen.getByText('No hay registros que coincidan con los filtros aplicados. Prueba limpiar la búsqueda.')
    ).toBeInTheDocument();

    // Clear search
    await userEvent.clear(searchInput);
    expect(
      screen.getByText('Agua purificada para garrafón de recepción')
    ).toBeInTheDocument();

    // Filter pill for Consumibles
    const filterGroup = screen.getByRole('group', { name: 'Filtrar gastos por categoría' });
    const consumiblesPill = within(filterGroup).getByRole('button', { name: /Consumibles/ });
    await userEvent.click(consumiblesPill);
    expect(consumiblesPill).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Agua purificada para garrafón de recepción')).toBeInTheDocument();

    // Filter pill for Limpieza (empty in seed)
    const limpiezaPill = within(filterGroup).getByRole('button', { name: /Limpieza/ });
    await userEvent.click(limpiezaPill);
    expect(
      screen.getByText('No hay registros que coincidan con los filtros aplicados. Prueba limpiar la búsqueda.')
    ).toBeInTheDocument();
  });

  it('integrates into App shell navigation and route for OWNER', () => {
    mountApp('/owner/expenses');

    // Navigation link in sidebar
    const expensesNavLink = screen.getByRole('link', { name: 'Gastos' });
    expect(expensesNavLink).toBeInTheDocument();
    expect(expensesNavLink).toHaveAttribute('href', '/owner/expenses');

    // Page title rendered inside main
    expect(
      screen.getByRole('heading', { name: 'Reporte y exportación de gastos' })
    ).toBeVisible();
  });

  it('does not allow RECEPTION role to access /reception/expenses', () => {
    mountApp('/reception/expenses');

    // Should redirect to reception home
    expect(
      screen.queryByRole('heading', { name: 'Reporte y exportación de gastos' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Inicio de recepción' })
    ).toBeInTheDocument();
  });
});
