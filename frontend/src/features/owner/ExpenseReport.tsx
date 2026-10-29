import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { PaginationState, SortingState, Updater } from '@tanstack/react-table';
import type { AuthenticatedRequest } from '../../api/membershipCheckoutApi';
import {
  createTransferReviewIdempotencyKey,
  getPendingMoney,
  reviewTransferPayment,
  type PendingMoneyResponse,
} from '../../api/pendingMoneyApi';
import { createEmptyDemoState } from '../../demo/adapter';
import { useDemo } from '../../demo/DemoProvider';
import { getExpenseReport } from '../../demo/expenseReportSelector';
import { useFixedCosts } from '../../demo/fixedCostsStore';
import { getCurrentCalendarMonthRange, getFinanceProjection, getPreviousComparableRange, isValidFinanceRange } from '../../demo/financeReportSelector';
import type { DemoState } from '../../domain/models';
import { useStaff } from '../staff/staffStore';
import { BalanceView } from './finance/BalanceView';
import { BudgetView } from './finance/BudgetView';
import { CollectionsView, type PendingMoneyBranchOption } from './finance/CollectionsView';
import { ExpensesView } from './finance/ExpensesView';
import { FinanceToolbar } from './finance/FinanceToolbar';
import type { CollectionFilters, ExpenseFilters, FinanceTab, FlowGranularity, TableState } from './finance/types';
import './ExpenseReport.css';

const tabs: FinanceTab[] = ['balance', 'cobros', 'gastos', 'presupuesto'];
const tabLabels: Record<FinanceTab, string> = { balance: 'Balance', cobros: 'Cobros', gastos: 'Gastos', presupuesto: 'Presupuesto' };
const validTab = (value: string | null): value is FinanceTab => tabs.includes(value as FinanceTab);
const defaultCollectionTable: TableState = { sorting: [{ id: 'recordedAt', desc: true }], pagination: { pageIndex: 0, pageSize: 20 } };
const defaultExpenseTable: TableState = { sorting: [{ id: 'recordedAt', desc: true }], pagination: { pageIndex: 0, pageSize: 20 } };

export interface ExpenseReportProps {
  apiRequest?: AuthenticatedRequest;
}

export function ExpenseReport({ apiRequest }: ExpenseReportProps = {}) {
  if (apiRequest) {
    return <LiveExpenseReport apiRequest={apiRequest} />;
  }
  return <DemoExpenseReport />;
}

function DemoExpenseReport() {
  const { state } = useDemo();
  return <ExpenseReportContent state={state} />;
}

function LiveExpenseReport({ apiRequest }: { apiRequest: AuthenticatedRequest }) {
  const state = useMemo(() => createEmptyDemoState(), []);
  return <ExpenseReportContent state={state} apiRequest={apiRequest} />;
}

function ExpenseReportContent({
  state,
  apiRequest,
}: {
  state: DemoState;
  apiRequest?: AuthenticatedRequest;
}) {
  const [params, setParams] = useSearchParams();
  const fixedCosts = useFixedCosts();
  const staff = useStaff();
  const defaultRange = getCurrentCalendarMonthRange(state.demoClock);
  const range = { from: params.get('from') ?? defaultRange.from, to: params.get('to') ?? defaultRange.to };
  const tabParam = params.get('tab');
  const active: FinanceTab = validTab(tabParam) ? tabParam : (apiRequest ? 'cobros' : 'balance');
  const [focusTab, setFocusTab] = useState<FinanceTab>(active);
  const [collectionFilters, setCollectionFiltersState] = useState<CollectionFilters>({ search: '', source: 'all', method: 'all', status: 'all' });
  const [collectionTable, setCollectionTable] = useState<TableState>(defaultCollectionTable);
  const [expenseFilters, setExpenseFiltersState] = useState<ExpenseFilters>({ search: '', category: 'all' });
  const [expenseTable, setExpenseTable] = useState<TableState>(defaultExpenseTable);
  const [granularity, setGranularity] = useState<FlowGranularity>('day');

  const [selectedBranchId, setSelectedBranchId] = useState<string>('ALL');
  const [branchOptions, setBranchOptions] = useState<PendingMoneyBranchOption[]>([]);
  const [pendingMoneyResponse, setPendingMoneyResponse] = useState<PendingMoneyResponse | null>(null);
  const [pendingMoneyLoading, setPendingMoneyLoading] = useState<boolean>(Boolean(apiRequest));
  const [pendingMoneyError, setPendingMoneyError] = useState<string | null>(null);
  const [reviewingPaymentId, setReviewingPaymentId] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const reviewIdempotencyKeysRef = useRef<Map<string, string>>(new Map());

  const recordBranchOptions = useCallback((items: PendingMoneyResponse['items']) => {
    setBranchOptions(current => {
      const byId = new Map(current.map(option => [option.id, option]));
      for (const item of items) {
        if (item.branch_id && item.branch_name && !byId.has(item.branch_id)) {
          byId.set(item.branch_id, { id: item.branch_id, name: item.branch_name });
        }
      }
      return [...byId.values()];
    });
  }, []);

  useEffect(() => {
    if (!apiRequest) return;
    let cancelled = false;
    setPendingMoneyLoading(true);
    setPendingMoneyError(null);
    void getPendingMoney({
      branchId: selectedBranchId === 'ALL' ? undefined : selectedBranchId,
      apiRequest,
    })
      .then(response => {
        if (cancelled) return;
        setPendingMoneyResponse(response);
        recordBranchOptions(response.items);
      })
      .catch(error => {
        if (cancelled) return;
        setPendingMoneyError(
          error instanceof Error ? error.message : 'No fue posible cargar las transferencias pendientes.',
        );
      })
      .finally(() => {
        if (!cancelled) {
          setPendingMoneyLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiRequest, recordBranchOptions, selectedBranchId]);

  const handleReviewTransfer = useCallback(
    async (paymentId: string, status: 'confirmed' | 'pending') => {
      if (!apiRequest) return;
      const keySlot = `${paymentId}:${status}`;
      let idempotencyKey = reviewIdempotencyKeysRef.current.get(keySlot);
      if (!idempotencyKey) {
        idempotencyKey = createTransferReviewIdempotencyKey();
        reviewIdempotencyKeysRef.current.set(keySlot, idempotencyKey);
      }
      setReviewingPaymentId(paymentId);
      setReviewError(null);
      try {
        await reviewTransferPayment(
          paymentId,
          { status },
          idempotencyKey,
          apiRequest,
        );
        reviewIdempotencyKeysRef.current.delete(keySlot);
        const refreshed = await getPendingMoney({
          branchId: selectedBranchId === 'ALL' ? undefined : selectedBranchId,
          apiRequest,
        });
        setPendingMoneyResponse(refreshed);
        recordBranchOptions(refreshed.items);
      } catch (error) {
        setReviewError(
          error instanceof Error ? error.message : 'No fue posible actualizar la transferencia.',
        );
      } finally {
        setReviewingPaymentId(null);
      }
    },
    [apiRequest, recordBranchOptions, selectedBranchId],
  );

  const projection = useMemo(() => getFinanceProjection(state, range), [state, range.from, range.to]);
  const previousRange = useMemo(() => getPreviousComparableRange(range), [range.from, range.to]);
  const previousProjection = useMemo(() => getFinanceProjection(state, previousRange), [state, previousRange.from, previousRange.to]);
  const expenseReport = useMemo(() => getExpenseReport(state, range, `${range.to}T12:00:00-06:00`, { fixedCosts, staff }), [state, range.from, range.to, fixedCosts, staff]);

  useEffect(() => setFocusTab(active), [active]);
  useEffect(() => {
    setCollectionTable(current => ({ ...current, pagination: { ...current.pagination, pageIndex: 0 } }));
    setExpenseTable(current => ({ ...current, pagination: { ...current.pagination, pageIndex: 0 } }));
  }, [range.from, range.to]);

  function updateQuery(key: 'tab' | 'from' | 'to', value: string) {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next);
  }

  function updateCollectionFilters(update: Partial<CollectionFilters>) {
    setCollectionFiltersState(current => ({ ...current, ...update }));
    setCollectionTable(current => ({ ...current, pagination: { ...current.pagination, pageIndex: 0 } }));
  }

  function updateExpenseFilters(update: Partial<ExpenseFilters>) {
    setExpenseFiltersState(current => ({ ...current, ...update }));
    setExpenseTable(current => ({ ...current, pagination: { ...current.pagination, pageIndex: 0 } }));
  }

  function updateSorting(setter: React.Dispatch<React.SetStateAction<TableState>>, updater: Updater<SortingState>) {
    setter(current => ({ ...current, sorting: typeof updater === 'function' ? updater(current.sorting) : updater,
      pagination: { ...current.pagination, pageIndex: 0 } }));
  }

  function updatePagination(setter: React.Dispatch<React.SetStateAction<TableState>>, updater: Updater<PaginationState>) {
    setter(current => ({ ...current, pagination: typeof updater === 'function' ? updater(current.pagination) : updater }));
  }

  function moveTabFocus(current: FinanceTab, key: string) {
    const index = tabs.indexOf(current);
    if (key === 'ArrowRight') return tabs[(index + 1) % tabs.length];
    if (key === 'ArrowLeft') return tabs[(index + tabs.length - 1) % tabs.length];
    if (key === 'Home') return tabs[0];
    if (key === 'End') return tabs[tabs.length - 1];
    return null;
  }

  const printDetail = active === 'cobros'
    ? `Búsqueda: ${collectionFilters.search || 'todas'} · Método: ${collectionFilters.method} · Estado: ${collectionFilters.status}`
    : active === 'gastos'
      ? `Búsqueda: ${expenseFilters.search || 'todas'} · Categoría: ${expenseFilters.category}`
      : active === 'presupuesto' ? 'Supuestos configurados' : 'Sin filtros adicionales';

  const page = !isValidFinanceRange(range) ? <div className="finance-invalid-range" role="alert"><h2>Periodo no válido</h2><p>Corrige el rango en la barra superior para mostrar datos.</p></div>
    : active === 'balance'
      ? <BalanceView projection={projection} previous={previousProjection} range={range} granularity={granularity} onGranularityChange={setGranularity} />
      : active === 'cobros'
        ? <CollectionsView projection={projection} collectionFilters={collectionFilters}
          setCollectionFilters={updateCollectionFilters} collectionTable={collectionTable}
          setCollectionSorting={updater => updateSorting(setCollectionTable, updater)}
          setCollectionPagination={updater => updatePagination(setCollectionTable, updater)}
          livePendingMoney={apiRequest ? {
            enabled: true,
            response: pendingMoneyResponse,
            loading: pendingMoneyLoading,
            error: pendingMoneyError,
            selectedBranchId,
            branchOptions,
            onBranchChange: branchId => {
              setReviewError(null);
              setSelectedBranchId(branchId);
            },
            reviewingPaymentId,
            reviewError,
            onReviewTransfer: (paymentId, status) => {
              void handleReviewTransfer(paymentId, status);
            },
          } : undefined} />
        : active === 'gastos'
          ? <ExpensesView items={expenseReport.items} filters={expenseFilters} onFiltersChange={updateExpenseFilters} table={expenseTable}
            setSorting={updater => updateSorting(setExpenseTable, updater)} setPagination={updater => updatePagination(setExpenseTable, updater)} />
          : <BudgetView costs={fixedCosts} staff={staff} />;

  return <main className="finance-page">
    <FinanceToolbar range={range} projection={projection} active={active} printDetail={printDetail} onRangeChange={updateQuery} />
    <nav className="finance-tabs" role="tablist" aria-label="Secciones de finanzas" aria-orientation="horizontal">
      {tabs.map(tab => <button key={tab} id={`finance-tab-${tab}`} type="button" role="tab" aria-selected={active === tab}
        aria-controls={`finance-panel-${tab}`} tabIndex={focusTab === tab ? 0 : -1}
        onFocus={() => setFocusTab(tab)} onClick={() => updateQuery('tab', tab)}
        onKeyDown={event => {
          const next = moveTabFocus(tab, event.key);
          if (!next) return;
          event.preventDefault();
          setFocusTab(next);
          document.getElementById(`finance-tab-${next}`)?.focus();
        }}>{tabLabels[tab]}</button>)}
    </nav>
    <section id={`finance-panel-${active}`} className="finance-panel" role="tabpanel" aria-labelledby={`finance-tab-${active}`} tabIndex={0}>
      {page}
    </section>
    {tabs.filter(tab => tab !== active).map(tab => <section key={tab} id={`finance-panel-${tab}`} role="tabpanel"
      aria-labelledby={`finance-tab-${tab}`} hidden />)}
  </main>;
}
