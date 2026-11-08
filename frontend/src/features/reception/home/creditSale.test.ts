import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingProductSale } from '@/api/productSalesApi';

const api = vi.hoisted(() => ({
  prepareProductSale: vi.fn(),
  submitCashProductSale: vi.fn(),
  submitCardProductSale: vi.fn(),
  resolveCashProductSale: vi.fn(),
  createCardIntent: vi.fn(),
  getCardIntentStatus: vi.fn(),
  cancelCardIntent: vi.fn(),
}));
vi.mock('@/api/productSalesApi', async importOriginal => ({ ...(await importOriginal<object>()), ...api }));
vi.mock('@/offline/connectivity', () => ({ isOnlineHint: () => true }));

import { runCardSale } from './cardSale';
import { runCashSale, type SaleContext } from './cashSale';

const submitted: PendingProductSale = {
  key: 'sale-key-123456',
  registerId: 'register',
  payload: { member_id: 'member-1', items: [{ product_id: 'p', quantity: 1 }], expected_total_minor: 5000, credit_minor: 2000 },
};

function context(afterSale?: SaleContext['afterSale']): SaleContext {
  return {
    request: vi.fn(),
    submitted,
    total: 5000,
    intents: { refreshResolvedIntent: vi.fn().mockResolvedValue(false), adoptOtherServerIntent: vi.fn(), clearIntent: vi.fn() },
    ui: { setMessage: vi.fn(), setError: vi.fn(), setActiveCardIntentId: vi.fn(), resetCart: vi.fn(), backToStart: vi.fn(), invalidateStock: vi.fn() },
    afterSale,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.createCardIntent.mockResolvedValue({ payment_intent_id: 'pi', device_id: 'dev' });
  api.getCardIntentStatus.mockResolvedValue({ status: 'PROCESSED' });
});

describe('product sales with saldo a favor', () => {
  it('sends the same credit_minor on intent, sale and resolve for cash', async () => {
    await runCashSale(context());
    expect(api.prepareProductSale.mock.calls[0][1].payload.credit_minor).toBe(2000);
    expect(api.submitCashProductSale.mock.calls[0][2].credit_minor).toBe(2000);
    expect(api.resolveCashProductSale.mock.calls[0][2].credit_minor).toBe(2000);
  });

  it('charges the terminal total minus credit and sends credit_minor on the card sale', async () => {
    await runCardSale(context());
    expect(api.createCardIntent).toHaveBeenCalledWith(expect.anything(), 'register', 3000, expect.any(String));
    expect(api.submitCardProductSale.mock.calls[0][2]).toMatchObject({ credit_minor: 2000, card_intent_id: 'pi' });
  });

  it('reports a failed change-to-credit deposit after the sale was recorded', async () => {
    const ctx = context(async () => 'La compra sí se registró, pero no se pudo depositar el saldo a favor.');
    await runCashSale(ctx);
    expect(ctx.ui.resetCart).toHaveBeenCalled();
    expect(ctx.ui.setError).toHaveBeenLastCalledWith(true);
    expect(ctx.ui.setMessage).toHaveBeenLastCalledWith(expect.stringContaining('sí se registró'));
  });
});
