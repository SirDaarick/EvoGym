import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { getPendingProductSale, type PendingProductSale } from '@/api/productSalesApi';
import type { AuthenticatedRequest } from '@/api/inventoryApi';

export type Intent = PendingProductSale;

export const productSaleStorageKey = (actorId: string) => `evogym:product-sale:${actorId}`;

export function readStoredIntent(actorId: string): Intent | null {
  try { return JSON.parse(sessionStorage.getItem(productSaleStorageKey(actorId)) || 'null') as Intent | null; }
  catch { return null; }
}

/** Pending sale intent: persisted in sessionStorage and recovered from the server. */
export function useProductSaleIntent(
  request: AuthenticatedRequest,
  actorId: string,
  setRegisterId: Dispatch<SetStateAction<string>>,
) {
  const storageKey = productSaleStorageKey(actorId);
  const [intent, setIntent] = useState<Intent | null>(() => readStoredIntent(actorId));
  const [intentLoaded, setIntentLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    getPendingProductSale(request).then(saved => {
      if (!active) return;
      setIntent(current => current ?? saved);
      if (saved) setRegisterId(current => current || saved.registerId);
      setIntentLoaded(true);
    }).catch(() => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, [request, actorId, setRegisterId]);

  /** Throws when the intent cannot be stored (the sale must not start then). */
  function persistIntent(next: Intent) {
    sessionStorage.setItem(storageKey, JSON.stringify(next));
    setIntent(next);
  }

  function clearIntent() {
    sessionStorage.removeItem(storageKey);
    setIntent(null);
  }

  async function refreshResolvedIntent(): Promise<boolean> {
    const saved = await getPendingProductSale(request);
    if (saved) {
      sessionStorage.setItem(storageKey, JSON.stringify(saved));
      setIntent(saved); setRegisterId(saved.registerId);
      return true;
    }
    clearIntent();
    return false;
  }

  /** After an uncertain failure, keep a different server-side intent instead of losing it. */
  async function adoptOtherServerIntent(submittedKey: string) {
    try {
      const saved = await getPendingProductSale(request);
      if (saved && saved.key !== submittedKey) {
        sessionStorage.setItem(storageKey, JSON.stringify(saved));
        setIntent(saved);
        setRegisterId(saved.registerId);
      }
    } catch { /* Keep the original intent frozen. */ }
  }

  return { intent, intentLoaded, loadFailed, persistIntent, clearIntent, refreshResolvedIntent, adoptOtherServerIntent };
}

export type ProductSaleIntentApi = ReturnType<typeof useProductSaleIntent>;
