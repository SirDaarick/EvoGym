import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/api/queryKeys';
import { listBranchInventory, listBranches, type AuthenticatedRequest, type BranchItem, type StockItem } from '@/api/inventoryApi';
import { listCashRegisters, type CashRegisterDTO } from '@/api/shiftsApi';

const NO_BRANCHES: BranchItem[] = [];
const NO_REGISTERS: CashRegisterDTO[] = [];
const NO_STOCK: StockItem[] = [];
const PAGE_SIZE = 100;

async function loadAllStock(request: AuthenticatedRequest, branchId: string): Promise<StockItem[]> {
  const items: StockItem[] = [];
  do {
    const page = await listBranchInventory(request, branchId, items.length, PAGE_SIZE);
    items.push(...page.items);
    if (items.length >= page.total || page.items.length === 0) break;
  } while (true);
  return items;
}

const isSellable = (items: StockItem[]) => items.filter(item => item.is_active && item.initialized);

/** Branches, cash registers and the sellable stock of the branch that owns `registerId`. */
export function useCheckoutCatalog(request: AuthenticatedRequest, identityId: string | undefined, registerId: string) {
  const branchesQuery = useQuery({
    queryKey: queryKeys.branches(identityId),
    queryFn: () => listBranches(request),
  });
  const registersQuery = useQuery({
    // listCashRegisters is not branch scoped; 'all' reuses the factory's branch slot.
    queryKey: queryKeys.cashRegisters(identityId, 'all'),
    queryFn: () => listCashRegisters(request),
  });
  const branches = branchesQuery.data ?? NO_BRANCHES;
  const registers = registersQuery.data ?? NO_REGISTERS;
  const currentBranchId = registers.find(register => register.id === registerId)?.branch_id;

  const stockQuery = useQuery({
    queryKey: queryKeys.inventory.stock(identityId, currentBranchId ?? ''),
    queryFn: () => loadAllStock(request, currentBranchId!),
    select: isSellable,
    enabled: Boolean(registerId && currentBranchId),
  });

  return {
    branches,
    registers,
    stock: registerId ? stockQuery.data ?? NO_STOCK : NO_STOCK,
    currentBranchId,
    catalogFailed: branchesQuery.isError || registersQuery.isError,
    stockFailed: stockQuery.isError,
  };
}
