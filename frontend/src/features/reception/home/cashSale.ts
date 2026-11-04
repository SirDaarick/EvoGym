import type { AuthenticatedRequest } from '@/api/inventoryApi';
import {
  ProductSaleError, prepareProductSale, resolveCashProductSale, submitCashProductSale, type PendingProductSale,
} from '@/api/productSalesApi';
import type { ProductSaleIntentApi } from './useProductSaleIntent';

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
  intents: Pick<ProductSaleIntentApi, 'refreshResolvedIntent' | 'adoptOtherServerIntent'>;
  ui: SaleUi;
}

export const NOT_CONFIRMED = 'No se pudo confirmar el resultado. Verifica la compra antes de hacer otra.';
export const MORE_PENDING = 'Hay otra compra pendiente de confirmar.';

export async function runCashSale(ctx: SaleContext) {
  const { request, submitted, intents, ui } = ctx;
  ui.setMessage('Registrando compra…');
  try {
    await prepareProductSale(request, submitted);
    await submitCashProductSale(request, submitted.registerId, submitted.payload, submitted.key);
    await resolveCashProductSale(request, submitted.registerId, submitted.payload, submitted.key);
    const morePending = await intents.refreshResolvedIntent();
    ui.resetCart(); ui.invalidateStock();
    ui.setMessage(morePending ? MORE_PENDING : 'Compra registrada.');
  } catch (failure) {
    await handleSaleFailure(failure, ctx, NOT_CONFIRMED);
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
