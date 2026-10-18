import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { DemoProvider } from '../../../demo/DemoProvider';
import { ExpenseReport } from '../ExpenseReport';

function mount(path = '/owner/expenses') {
  return render(<MemoryRouter initialEntries={[path]}><DemoProvider><ExpenseReport /></DemoProvider></MemoryRouter>);
}

describe('finance tabs', () => {
  it('starts on Balance with month-to-date dates and exposes four flat tabs', () => {
    mount();
    expect(screen.getByRole('tab', { name: 'Balance' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByLabelText('Desde')).toHaveValue('2026-10-01');
    expect(screen.getByLabelText('Hasta')).toHaveValue('2026-10-08');
  });

  it('supports roving tab focus without activation and hides inactive heavy views', async () => {
    const user = userEvent.setup();
    mount();
    screen.getByRole('tab', { name: 'Balance' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Cobros' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Balance' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Balance' })).toBeVisible();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('tabpanel', { name: 'Cobros' })).toBeVisible();
    expect(document.getElementById('finance-panel-balance')).not.toBeVisible();
  });

  it('keeps configured budget visibly separate from recorded balances', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('tab', { name: 'Presupuesto' }));
    expect(screen.getAllByText(/no son pagos realizados/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Ajustar costos fijos' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Gestionar equipo y sueldos' })).toBeInTheDocument();
  });

  it('prints the selected report through the browser print command', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Exportar / imprimir' }));
    expect(print).toHaveBeenCalledOnce();
  });
});
