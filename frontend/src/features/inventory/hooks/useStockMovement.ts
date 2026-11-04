import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../api/queryKeys';
import { recordStockMovement, type AuthenticatedRequest } from '../../../api/inventoryApi';

export interface StockMovementInput {
  branchId: string;
  productId: string;
  kind: 'restock' | 'waste';
  quantity: number;
  reason?: string;
}

export function useStockMovement(apiRequest: AuthenticatedRequest) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ branchId, productId, kind, quantity, reason }: StockMovementInput) => {
      const idempotencyKey = `mov-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
      return recordStockMovement(apiRequest, branchId, {
        product_id: productId,
        kind,
        quantity,
        reason,
        idempotency_key: idempotencyKey,
      });
    },
    // Returned promise keeps the mutation pending until stock is refetched.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all }),
  });
}
