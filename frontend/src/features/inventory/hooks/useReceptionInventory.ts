import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Product } from '../../../domain/models';
import { queryKeys } from '../../../api/queryKeys';
import {
  listBranches,
  listBranchInventory,
  type AuthenticatedRequest,
  type StockItem,
} from '../../../api/inventoryApi';

export interface LiveProductCardItem extends Product {
  stock: number;
}

// Local key (no shared factory yet) reusing the inventory root so one
// invalidation of `queryKeys.inventory.all` refreshes branches and stock.
export const inventoryBranchesKey = () => [...queryKeys.inventory.all, 'branches'] as const;

function errorMessage(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : 'No se pudo cargar el inventario.';
}

export function toCardItems(items: StockItem[]): LiveProductCardItem[] {
  return items
    .filter(item => item.is_active)
    .map(item => ({
      id: item.product_id,
      name: item.name,
      category: item.category || 'General',
      priceMinor: item.price_minor,
      costMinor: item.cost_minor,
      openingQuantity: item.opening_quantity ?? 0,
      active: item.is_active,
      illustrative: true,
      stock: item.quantity ?? 0,
    }));
}

export function useReceptionInventory(apiRequest: AuthenticatedRequest) {
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');

  const branchesQuery = useQuery({
    queryKey: inventoryBranchesKey(),
    queryFn: () => listBranches(apiRequest),
  });
  const branchId = selectedBranchId || branchesQuery.data?.[0]?.id || '';

  const stockQuery = useQuery({
    queryKey: queryKeys.inventory.stock(undefined, branchId),
    queryFn: () => listBranchInventory(apiRequest, branchId),
    enabled: Boolean(branchId),
  });

  const stockItems = stockQuery.data?.items ?? [];
  const activeProducts = toCardItems(stockItems);
  const needle = search.trim().toLocaleLowerCase();
  const matchingProducts = activeProducts.filter(p => p.name.toLocaleLowerCase().includes(needle));
  const selectedProduct = activeProducts.find(p => p.id === selectedProductId) ?? activeProducts[0] ?? null;
  const selectedStock = stockItems.find(item => item.product_id === selectedProduct?.id);

  function changeQuantity(id: string, qty: number): boolean {
    if (!Number.isSafeInteger(qty) || qty < 0) return false;
    setQuantities(prev => ({ ...prev, [id]: qty }));
    setSelectedProductId(id);
    return true;
  }

  function resetQuantity(id: string) {
    setQuantities(prev => ({ ...prev, [id]: 0 }));
  }

  return {
    branchId,
    setSelectedBranchId,
    branches: branchesQuery.data ?? [],
    isLoading: branchesQuery.isPending || (Boolean(branchId) && stockQuery.isPending),
    loadError: errorMessage(branchesQuery.error) ?? errorMessage(stockQuery.error),
    search,
    setSearch,
    quantities,
    changeQuantity,
    resetQuantity,
    matchingProducts,
    selectedProduct,
    selectedStock,
  };
}
