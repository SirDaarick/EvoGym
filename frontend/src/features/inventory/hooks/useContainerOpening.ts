import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../api/queryKeys';
import { openContainer, type AuthenticatedRequest } from '../../../api/inventoryApi';

const STORAGE_KEY = 'evogym:container-opening';

interface OpeningIntent {
  branchId: string;
  productId: string;
  key: string;
}

/**
 * Opens a container with a durable idempotency key: the intent is kept in
 * sessionStorage until the request succeeds, so a failed/retried request
 * reuses the same key.
 */
export function useContainerOpening(apiRequest: AuthenticatedRequest) {
  const queryClient = useQueryClient();
  const intent = useRef<OpeningIntent | null>(null);

  return useMutation({
    mutationFn: async ({ branchId, productId }: { branchId: string; productId: string }) => {
      if (!intent.current) {
        try {
          intent.current = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
        } catch {
          throw new Error('No se puede recuperar la apertura pendiente.');
        }
      }
      if (intent.current && (intent.current.branchId !== branchId || intent.current.productId !== productId)) {
        throw new Error('Resuelve primero la apertura pendiente del otro producto.');
      }
      if (!intent.current) {
        intent.current = { branchId, productId, key: crypto.randomUUID() };
        try {
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(intent.current));
        } catch {
          intent.current = null;
          throw new Error('No se puede guardar la apertura para recuperarla.');
        }
      }
      await openContainer(apiRequest, branchId, productId, intent.current.key);
      intent.current = null;
      sessionStorage.removeItem(STORAGE_KEY);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all }),
  });
}
