import type { PaginationState, SortingState, Updater } from '@tanstack/react-table';
import type { FinanceDateRange, FinanceProjection, FinanceRow, FinanceSourceFamily } from '../../../demo/financeReportSelector';

export type FinanceTab = 'balance' | 'cobros' | 'gastos' | 'presupuesto';
export type FlowGranularity = 'day' | 'week';
export interface CollectionFilters { search: string; source: FinanceSourceFamily | 'all'; method: string; status: string }
export interface ExpenseFilters { search: string; category: string }
export interface TableState { sorting: SortingState; pagination: PaginationState }
export interface FinanceContextData {
  range: FinanceDateRange;
  projection: FinanceProjection;
  collectionFilters: CollectionFilters;
  setCollectionFilters: (update: Partial<CollectionFilters>) => void;
  collectionTable: TableState;
  setCollectionSorting: (updater: Updater<SortingState>) => void;
  setCollectionPagination: (updater: Updater<PaginationState>) => void;
  expenseFilters: ExpenseFilters;
  setExpenseFilters: (update: Partial<ExpenseFilters>) => void;
  expenseTable: TableState;
  setExpenseSorting: (updater: Updater<SortingState>) => void;
  setExpensePagination: (updater: Updater<PaginationState>) => void;
  granularity: FlowGranularity;
  setGranularity: (value: FlowGranularity) => void;
}
export function isCollectionRow(row: FinanceRow): boolean { return row.subtype === 'collection' || row.subtype === 'refund'; }
