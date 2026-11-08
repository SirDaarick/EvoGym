import {
  cancelCardIntent, createCardIntent, getCardIntentStatus, prepareProductSale, resolveCashProductSale,
  submitCardProductSale,
} from '@/api/productSalesApi';
import { handleSaleFailure, MORE_PENDING, type SaleContext } from './cashSale';

const POLL_DELAY_MS = 1000;
const MAX_RETRIES = 120;
const FINAL_STATUSES = ['PROCESSED', 'CANCELED', 'ABANDONED'];

/** Card sale against the Point terminal. Polling stays imperative on purpose. */
export async function runCardSale(ctx: SaleContext) {
  const { request, submitted, total, intents, ui } = ctx;
  ui.setMessage('Conectando con la terminal Point...');
  try {
    await prepareProductSale(request, submitted);
    const externalRef = `cart-${submitted.key.slice(0, 8)}`;
    // The terminal only charges what saldo a favor does not cover.
    const cardIntent = await createCardIntent(request, submitted.registerId, total - (submitted.payload.credit_minor ?? 0), externalRef);
    ui.setActiveCardIntentId(cardIntent.payment_intent_id);
    ui.setMessage(`Esperando tarjeta en la terminal Point (${cardIntent.device_id})...`);

    let intentStatus = await getCardIntentStatus(request, submitted.registerId, cardIntent.payment_intent_id);
    let retries = 0;
    while (!FINAL_STATUSES.includes(intentStatus.status) && retries < MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, POLL_DELAY_MS));
      intentStatus = await getCardIntentStatus(request, submitted.registerId, cardIntent.payment_intent_id);
      retries++;
    }
    if (intentStatus.status !== 'PROCESSED') throw new Error('El cobro no fue aprobado en la terminal Point.');

    ui.setMessage('Pago aprobado en terminal. Registrando compra...');
    await submitCardProductSale(
      request, submitted.registerId,
      { ...submitted.payload, card_intent_id: cardIntent.payment_intent_id }, submitted.key,
    );
    await resolveCashProductSale(request, submitted.registerId, submitted.payload, submitted.key);
    ui.setActiveCardIntentId(null);
    const morePending = await intents.refreshResolvedIntent();
    ui.resetCart(); ui.invalidateStock();
    ui.setMessage(morePending ? MORE_PENDING : 'Compra con tarjeta registrada.');
  } catch (failure) {
    ui.setActiveCardIntentId(null);
    await handleSaleFailure(
      failure, ctx,
      failure instanceof Error ? failure.message : 'No se pudo confirmar el cobro con tarjeta.',
    );
  }
}

/** Cancels the terminal charge, then resolves the frozen intent as not registered. */
export async function cancelCardSale(
  ctx: Pick<SaleContext, 'request'> & { registerId: string; cardIntentId: string; intent: SaleContext['submitted'] | null },
) {
  await cancelCardIntent(ctx.request, ctx.registerId, ctx.cardIntentId);
  if (ctx.intent) await resolveCashProductSale(ctx.request, ctx.registerId, ctx.intent.payload, ctx.intent.key);
}
