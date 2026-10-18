import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoProvider, useDemo } from '../../../demo/DemoProvider';
import { getFixedCosts, resetFixedCosts } from '../../../demo/fixedCostsStore';
import type { FinanceProjection, FinanceRow } from '../../../demo/financeReportSelector';
import { resetStaff } from '../../staff/staffStore';
import { ExpenseReport } from '../ExpenseReport';
import { CollectionsView } from './CollectionsView';
import type { CollectionFilters, TableState } from './types';

function LocationOutput() {
  const location = useLocation();
  return <output aria-label="Current location">{location.pathname}{location.search}</output>;
}

function HistoryControls() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(-1)}>Go back</button>;
}

const collectionRows: FinanceRow[] = Array.from({ length: 21 }, (_, index) => ({
  id: `finance-event-${index + 1}`,
  sourceFamily: 'unknown',
  sourceReference: `missing-reference-${index + 1}`,
  memberLabel: null,
  method: index === 20 ? 'card' : 'cash',
  status: 'confirmed',
  recordedAt: '2026-10-08T09:00:00-06:00',
  dateKey: '2026-10-08',
  amountMinor: (index + 1) * 100,
  subtype: 'collection',
  orphan: true,
  description: `Unmatched event ${index + 1}`,
}));
const collectionProjection: FinanceProjection = {
  range: { from: '2026-10-01', to: '2026-10-31' },
  rangeValid: true,
  rows: collectionRows,
  totals: { grossMinor: 23_100, refundsMinor: 0, netMinor: 23_100, extrasMinor: 0, expensesMinor: 0, balanceMinor: 23_100, pendingMinor: 0 },
  bySource: [],
  issues: [],
};

function CollectionsHarness() {
  const [filters, setFilters] = useState<CollectionFilters>({ search: '', source: 'all', method: 'all', status: 'all' });
  const [table, setTable] = useState<TableState>({ sorting: [{ id: 'recordedAt', desc: true }], pagination: { pageIndex: 0, pageSize: 20 } });
  return <CollectionsView projection={collectionProjection} collectionFilters={filters}
    setCollectionFilters={update => { setFilters(current => ({ ...current, ...update })); setTable(current => ({ ...current, pagination: { ...current.pagination, pageIndex: 0 } })); }}
    collectionTable={table} setCollectionSorting={update => setTable(current => ({ ...current, sorting: typeof update === 'function' ? update(current.sorting) : update, pagination: { ...current.pagination, pageIndex: 0 } }))}
    setCollectionPagination={update => setTable(current => ({ ...current, pagination: typeof update === 'function' ? update(current.pagination) : update }))} />;
}

function mount(path = '/owner/expenses') {
  return render(<MemoryRouter initialEntries={[path]}><DemoProvider><ExpenseReport /><LocationOutput /><HistoryControls /></DemoProvider></MemoryRouter>);
}

describe('finance tabs', () => {
  beforeEach(() => { resetFixedCosts(); resetStaff(); window.localStorage.clear(); window.sessionStorage.clear(); });

  it('keeps arrow-key movement as focus only until Enter activates a tab', async () => {
    const user = userEvent.setup();
    mount();
    screen.getByRole('tab', { name: 'Balance' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Cobros' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Balance' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Balance' })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('tab', { name: 'Cobros' })).toHaveAttribute('aria-selected', 'true');
  });

  it('restores the selected tab and exact date range from URL state', () => {
    mount('/owner/expenses?tab=cobros&from=2026-10-01&to=2026-10-08');
    expect(screen.getByRole('tab', { name: 'Cobros' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Desde')).toHaveValue('2026-10-01');
    expect(screen.getByLabelText('Hasta')).toHaveValue('2026-10-08');
  });

  it('keeps tab and date query changes in history and restores them on back navigation', async () => {
    const user = userEvent.setup();
    mount();
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-03' } });
    await user.click(screen.getByRole('tab', { name: 'Cobros' }));
    await user.click(screen.getByRole('tab', { name: 'Gastos' }));
    expect(screen.getByLabelText('Current location')).toHaveTextContent('tab=gastos');
    await user.click(screen.getByRole('button', { name: 'Go back' }));
    expect(screen.getByRole('tab', { name: 'Cobros' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Current location')).toHaveTextContent('tab=cobros');
    expect(screen.getByLabelText('Desde')).toHaveValue('2026-10-03');
    await user.click(screen.getByRole('button', { name: 'Go back' }));
    expect(screen.getByRole('tab', { name: 'Balance' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Desde')).toHaveValue('2026-10-03');
    await user.click(screen.getByRole('button', { name: 'Go back' }));
    expect(screen.getByLabelText('Desde')).toHaveValue('2026-10-01');
  });

  it('shows real charts and exact-data alternatives in Balance', () => {
    mount();
    expect(screen.getByLabelText('Entradas y salidas diarias')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Valores exactos del flujo diario' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Cobros netos confirmados por origen' })).not.toBeInTheDocument();
  });

  it('calculates Cobros totals from every filtered row, while paging and method filters update independently', async () => {
    const user = userEvent.setup();
    render(<CollectionsHarness />);
    expect(screen.getByRole('heading', { name: 'Cobros netos filtrados por origen' })).toBeInTheDocument();
    const rankingHeading = screen.getByRole('heading', { name: 'Cobros netos filtrados por origen' });
    const ranking = within(rankingHeading.closest('section')!);
    expect(ranking.getAllByText('Origen desconocido').length).toBeGreaterThan(0);
    const totals = screen.getByRole('region', { name: 'Totales de cobros filtrados' });
    expect(within(totals).getByText('Cobros brutos filtrados').parentElement).toHaveTextContent('231.00');
    expect(ranking.getByText(/231\.00 MXN/)).toBeInTheDocument();
    expect(screen.getByText(/Página 1 de 2/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByText(/Página 2 de 2/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Método'), 'card');
    const filteredRankingHeading = screen.getByRole('heading', { name: 'Cobros netos filtrados por origen' });
    expect(within(filteredRankingHeading.closest('section')!).getByText(/21\.00 MXN/)).toBeInTheDocument();
    expect(within(totals).getByText('Cobros brutos filtrados').parentElement).toHaveTextContent('21.00');
    expect(screen.getByText(/Página 1 de 1/)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Movimientos de cobros filtrados' })).getAllByRole('row')).toHaveLength(2);
    await user.type(screen.getByRole('searchbox', { name: /Buscar concepto/ }), 'event 21');
    expect(within(screen.getByRole('region', { name: 'Totales de cobros filtrados' })).getByText('Cobros brutos filtrados').parentElement).toHaveTextContent('21.00');
    expect(screen.getByText(/Página 1 de 1/)).toBeInTheDocument();
  });

  it('rejects invalid ranges and does not display finance totals for invalid URL dates', () => {
    mount('/owner/expenses?tab=balance&from=2026-02-30&to=2026-03-01');
    expect(screen.getByRole('alert')).toHaveTextContent(/periodo.*no válido/i);
    expect(screen.queryByText('Balance registrado')).not.toBeInTheDocument();
  });

  it('searches gasto providers and reconciles the displayed filtered expense amount', async () => {
    const user = userEvent.setup();
    mount('/owner/expenses?tab=gastos&from=2026-10-01&to=2026-10-31');
    const search = screen.getByRole('searchbox', { name: 'Buscar concepto o proveedor' });
    await user.type(search, 'Cristalina');
    expect(screen.getByText(/Importe filtrado:/)).toBeInTheDocument();
    expect(screen.getAllByText('Agua purificada para garrafón de recepción').length).toBeGreaterThan(0);
  });

  it('rejects blank fixed-cost values and persists valid cent amounts synchronously', async () => {
    const user = userEvent.setup();
    mount('/owner/expenses?tab=presupuesto');
    await user.click(screen.getByRole('button', { name: 'Ajustar costos fijos' }));
    const rent = screen.getByLabelText('Renta (MXN/mes)');
    await user.clear(rent);
    await user.click(screen.getByRole('button', { name: 'Guardar costos' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/importe.*válido/i);
    expect(getFixedCosts().rentMinor).toBe(6_600_000);
    await user.type(rent, '70000.25');
    await user.click(screen.getByRole('button', { name: 'Guardar costos' }));
    expect(getFixedCosts().rentMinor).toBe(7_000_025);
  });

  it('keeps print metadata scoped to the selected tab and active filters', async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    mount('/owner/expenses?tab=cobros&from=2026-10-01&to=2026-10-31');
    await user.selectOptions(screen.getByLabelText('Método'), 'card');
    expect(screen.getByText(/Vista impresa: Cobros/)).toBeInTheDocument();
    expect(screen.getByText(/Método: Tarjeta/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Exportar / imprimir' }));
    expect(print).toHaveBeenCalledOnce();
  });
});
