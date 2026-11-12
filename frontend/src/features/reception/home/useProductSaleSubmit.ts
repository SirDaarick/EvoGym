import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthenticatedRequest } from '@/api/inventoryApi';
import { queryKeys } from '@/api/queryKeys';
import { depositMemberCredit } from '@/api/memberCreditApi';
import { resolveCashProductSale } from '@/api/productSalesApi';
import type { CheckoutPaymentBreakdown } from '../CurrentPurchaseCard';
import { cancelCardSale, runCardSale } from './cardSale';
import { runCashSale, saleSuccessMessage, type SaleContext } from './cashSale';
import type { Intent, ProductSaleIntentApi } from './useProductSaleIntent';

export interface SaleCart {
  items: Intent['payload']['items'];
  memberId: string | null;
  total: number;
}

interface Params {
  request: AuthenticatedRequest;
  registerId: string;
  saleIntent: ProductSaleIntentApi;
  cart: SaleCart;
  actorId?: string;
  setMessage(message: string): void;
  setError(error: boolean): void;
  setPending(pending: boolean): void;
  resetCart(): void;
  backToStart(): void;
}

const NOT_RESOLVED = 'No se pudo confirmar el resultado. Intenta resolver la compra nuevamente.';

export function useProductSaleSubmit(p: Params) {
  const { request, registerId, saleIntent, cart, actorId, setMessage, setError, setPending } = p;
  const { intent, intentLoaded } = saleIntent;
  const queryClient = useQueryClient();
  const submitting = useRef(false);
  const [activeCardIntentId, setActiveCardIntentId] = useState<string | null>(null);
  const invalidateStock = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
    // The member's saldo a favor changes with every sale that uses or receives credit.
    void queryClient.invalidateQueries({ queryKey: queryKeys.members.all });
  };

  /** The sale is already recorded; a failed deposit must not look like a failed sale. */
  async function depositChange(memberId: string, amountMinor: number): Promise<string | null> {
    try {
      await depositMemberCredit(request, registerId, { member_id: memberId, amount_minor: amountMinor }, crypto.randomUUID());
      void queryClient.invalidateQueries({ queryKey: queryKeys.members.all });
      return null;
    } catch {
      return 'La compra sí se registró, pero no se pudo depositar el saldo a favor. Puedes agregarlo desde el perfil del socio.';
    }
  }

  async function submit(breakdown?: CheckoutPaymentBreakdown) {
    if (!intentLoaded || submitting.current || intent || !registerId || !cart.items.length) return;
    if (!Number.isSafeInteger(cart.total)) { setError(true); setMessage('El total excede el límite seguro de esta pantalla.'); return; }
    if (breakdown && breakdown.mode !== 'single') {
      setError(true);
      setMessage('La venta de productos no admite pago mixto; usa un solo método de cobro.');
      return;
    }
    if (breakdown && breakdown.method !== 'cash' && breakdown.method !== 'card') {
      setError(true);
      setMessage('La venta de productos solo acepta efectivo o tarjeta.');
      return;
    }
    const creditMinor = cart.memberId ? breakdown?.creditAppliedMinor ?? 0 : 0;
    const changeToCreditMinor = cart.memberId ? breakdown?.changeToCreditMinor ?? 0 : 0;
    const payableMinor = cart.total - creditMinor;
    const shortfallMinor = breakdown?.shortfallMinor ?? 0;
    if (breakdown?.method === 'card' && shortfallMinor > 0) {
      setError(true);
      setMessage('El cobro con tarjeta debe cubrir el total a pagar.');
      return;
    }
    if (shortfallMinor > 0 && !cart.memberId) {
      setError(true);
      setMessage('Para dejar saldo pendiente debes asignar un socio en el carrito.');
      return;
    }
    if (shortfallMinor > payableMinor) {
      setError(true);
      setMessage('El monto pendiente no puede exceder el total por cobrar.');
      return;
    }
    const cashAmountMinor = breakdown?.method === 'cash' && shortfallMinor > 0
      ? payableMinor - shortfallMinor
      : undefined;
    const submitted: Intent = { key: crypto.randomUUID(), registerId, payload: {
      member_id: cart.memberId, items: cart.items, expected_total_minor: cart.total,
      ...(creditMinor > 0 ? { credit_minor: creditMinor } : {}),
      ...(cashAmountMinor !== undefined ? { cash_amount_minor: cashAmountMinor } : {}),
    } };
    try {
      saleIntent.persistIntent(submitted);
    } catch {
      setError(true); setMessage('No se puede guardar el intento de cobro para recuperarlo.'); return;
    }
    submitting.current = true;
    setPending(true); setError(false);
    const ctx: SaleContext = {
      request, submitted, total: cart.total, intents: saleIntent, actorId,
      afterSale: changeToCreditMinor > 0 && cart.memberId ? () => depositChange(cart.memberId as string, changeToCreditMinor) : undefined,
      ui: { setMessage, setError, setActiveCardIntentId, resetCart: p.resetCart, backToStart: p.backToStart, invalidateStock },
    };
    try {
      await (breakdown?.method === 'card' ? runCardSale(ctx) : runCashSale(ctx));
    } finally { submitting.current = false; setPending(false); }
  }

  async function resolveIntent() {
    if (!intent || submitting.current) return;
    submitting.current = true; setPending(true); setError(false);
    try {
      const status = await resolveCashProductSale(request, intent.registerId, intent.payload, intent.key);
      const morePending = await saleIntent.refreshResolvedIntent();
      p.resetCart(); invalidateStock();
      setMessage(morePending
        ? 'Hay otra compra pendiente de confirmar.'
        : status === 'completed'
        ? saleSuccessMessage(intent.payload)
        : 'La compra no se registró y fue cancelada.');
    } catch {
      setError(true); setMessage(NOT_RESOLVED);
    } finally { submitting.current = false; setPending(false); }
  }

  async function cancelCurrentCardIntent() {
    if (!activeCardIntentId || !registerId) return;
    try {
      await cancelCardSale({ request, registerId, cardIntentId: activeCardIntentId, intent });
      saleIntent.clearIntent();
      setActiveCardIntentId(null);
      setPending(false);
      setError(false);
      setMessage('Cobro en terminal cancelado.');
    } catch {
      setError(true);
      setMessage('No se pudo cancelar el cobro en la terminal.');
    }
  }

  return { submit, resolveIntent, cancelCurrentCardIntent, activeCardIntentId };
}
