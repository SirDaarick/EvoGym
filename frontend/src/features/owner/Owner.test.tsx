import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from '../../app/App';
import { DemoProvider } from '../../demo/DemoProvider';

function mount(path: string) { render(<MemoryRouter initialEntries={[path]}><DemoProvider><App /></DemoProvider></MemoryRouter>); }
describe('owner views', () => {
  it('shows an explicit period and confirmed collections instead of profit', () => {
    mount('/owner/overview');
    expect(screen.getByLabelText('Desde')).toBeVisible();
    expect(screen.getByLabelText('Hasta')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Cobros confirmados' })).toBeVisible();
    expect(screen.getByText(/No hay cobros confirmados en este periodo/)).toBeVisible();
  });
  it('filters empty history without pretending unavailable data is zero', async () => {
    mount('/owner/history');
    await userEvent.selectOptions(screen.getByLabelText('Categoría'), 'membership');
    expect(screen.getByRole('heading', { name: 'Sin movimientos para estos filtros' })).toBeVisible();
  });
  it('renders confirmed tariffs and products catalog with management controls', () => {
    mount('/owner/plans');
    expect(screen.getByRole('heading', { name: 'Catálogo de planes' })).toBeVisible();
    expect(screen.getByText('Gym + Box mensual')).toBeVisible();
    expect(screen.getByText(/Precio y cantidad registrados/)).toBeVisible();
    expect(screen.getByRole('button', { name: /Nuevo plan/i })).toBeVisible();
  });
  it('does not expose owner overview, history or catalog in reception routes', () => {
    mount('/reception/overview');
    expect(screen.getByRole('heading', { name: 'Inicio de recepción' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Cobros confirmados' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Historial|Resumen|Planes/ })).not.toBeInTheDocument();
  });
  it('does not display zero totals for an invalid reporting period', async () => {
    mount('/owner/overview');
    await userEvent.clear(screen.getByLabelText('Desde'));
    const alerts = screen.getAllByRole('alert');
    expect(alerts.some(alert => alert.textContent?.includes('No se calculan resultados para un periodo inválido'))).toBe(true);
    expect(screen.queryByRole('heading', { name: 'Cobros confirmados' })).not.toBeInTheDocument();
  });
  it('keeps the skip link and reporting period controls keyboard reachable', async () => {
    mount('/owner/overview');
    await userEvent.tab();
    expect(screen.getByRole('link', { name: 'Ir al contenido' })).toHaveFocus();
    const from = screen.getByLabelText('Desde');
    for (let index = 0; index < 20 && document.activeElement !== from; index++) await userEvent.tab();
    expect(from).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByLabelText('Hasta')).toHaveFocus();
  });
});
