import type { AuthenticatedRequest } from '@/api/inventoryApi';
import {
  ProductSaleError, prepareProductSale, resolveCashProductSale, submitCashProductSale, type PendingProductSale,
} from '@/api/productSalesApi';
import type { ProductSaleIntentApi } from './useProductSaleIntent';
import { openLocalDb } from '@/offline/db';
import { dispatch, type CashSaleItemPayload } from '@/offline/dispatcher';
import { isOnlineHint } from '@/offline/connectivity';

export interface SaleUi {
  setMessage(message: string): void;
  setError(error: boolean): void;
  setActiveCardIntentId(id: string | null): void;
  resetCart(): void;
  backToStart(): void;
  invalidateStock(): void;
}

export interface SaleContext {
  request: AuthenticatedRequest;
  submitted: PendingProductSale;
  total: number;
  intents: Pick<ProductSaleIntentApi, 'refreshResolvedIntent' | 'adoptOtherServerIntent'> & { clearIntent?: () => void };
  ui: SaleUi;
  actorId?: string;
}

export const NOT_CONFIRMED = 'No se pudo confirmar el resultado. Verifica la compra antes de hacer otra.';
export const MORE_PENDING = 'Hay otra compra pendiente de confirmar.';

export async function executeOfflineCashSale(ctx: SaleContext, onlineIdempotencyKey?: string) {
  const { submitted, intents, ui, actorId } = ctx;
  const db = openLocalDb();
  const shift = await db.shift_state.get(submitted.registerId);
  const localShiftRef = (typeof shift?.shift_id === 'string' ? shift.shift_id : '') || 'contingency-shift';

  const items: CashSaleItemPayload[] = await Promise.all(
    submitted.payload.items.map(async line => {
      const prod = await db.catalog.get(line.product_id);
      return {
        product_id: line.product_id,
        quantity: line.quantity,
        unit_price_minor: typeof prod?.price_minor === 'number' ? prod.price_minor : 0,
      };
    })
  );

  const res = await dispatch(
    db,
    {
      type: 'pos.cash_sale',
      payload: {
        register_id: submitted.registerId,
        local_shift_ref: localShiftRef,
        member_id: submitted.payload.member_id,
        items,
        total_minor: submitted.payload.expected_total_minor,
        online_idempotency_key: onlineIdempotencyKey,
      },
    },
    actorId || 'offline-staff',
  );

  if (typeof intents.clearIntent === 'function') {
    intents.clearIntent();
  } else {
    await intents.refreshResolvedIntent().catch(() => false);
  }
  ui.resetCart();
  ui.invalidateStock();
  ui.setError(false);
  ui.setMessage(`Venta en contingencia registrada. Folio: ${res.eventId}`);
  return res;
}

export async function runCashSale(ctx: SaleContext) {
  const { request, submitted, intents, ui } = ctx;
  const isOnline = isOnlineHint();

  if (!isOnline) {
    try {
      await executeOfflineCashSale(ctx);
      return;
    } catch {
      ui.setError(true);
      ui.setMessage('No se pudo registrar la venta en contingencia.');
      return;
    }
  }

  ui.setMessage('Registrando compra…');
  try {
    await prepareProductSale(request, submitted);
    await submitCashProductSale(request, submitted.registerId, submitted.payload, submitted.key);
    await resolveCashProductSale(request, submitted.registerId, submitted.payload, submitted.key);
    const morePending = await intents.refreshResolvedIntent();
    ui.resetCart(); ui.invalidateStock();
    ui.setMessage(morePending ? MORE_PENDING : 'Compra registrada.');
  } catch (failure) {
    if (failure instanceof ProductSaleError && failure.definitelyRejected) {
      await handleSaleFailure(failure, ctx, NOT_CONFIRMED);
    } else {
      // Network error or uncertain response: fallback to offline dispatch with online_idempotency_key
      try {
        await executeOfflineCashSale(ctx, submitted.key);
      } catch {
        await handleSaleFailure(failure, ctx, NOT_CONFIRMED);
      }
    }
  }
}

/** Shared failure handling: keep uncertain sales frozen, unlock definitely rejected ones. */
export async function handleSaleFailure(failure: unknown, ctx: SaleContext, otherMessage: string) {
  const { request, submitted, intents, ui } = ctx;
  if (!(failure instanceof ProductSaleError)) await intents.adoptOtherServerIntent(submitted.key);
  if (failure instanceof ProductSaleError && failure.definitelyRejected) {
    try {
      await resolveCashProductSale(request, submitted.registerId, submitted.payload, submitted.key);
      await intents.refreshResolvedIntent();
    } catch {
      ui.setError(true); ui.setMessage(NOT_CONFIRMED);
      return;
    }
    ui.backToStart(); ui.invalidateStock();
    ui.setError(true);
    ui.setMessage(failure.firstShiftRequired
      ? 'Abre el primer turno de esta caja antes de registrar una venta.'
      : 'La compra fue rechazada. Revisa los productos, el precio y el turno antes de volver a intentar.');
  } else {
    ui.setError(true); ui.setMessage(otherMessage);
  }
}
