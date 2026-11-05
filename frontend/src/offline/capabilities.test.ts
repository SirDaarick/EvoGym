import { describe, expect, it } from 'vitest';
import {
  classifyRequest, isAllowedOffline, OFFLINE_ALLOWED_COMMANDS, ONLINE_ONLY_COMMANDS, OnlineOnlyError,
} from './capabilities';

describe('capability matrix', () => {
  it('allows only the four offline commands', () => {
    for (const c of OFFLINE_ALLOWED_COMMANDS) expect(isAllowedOffline(c)).toBe(true);
    expect([...OFFLINE_ALLOWED_COMMANDS].sort()).toEqual(['attendance.check_in', 'pos.cash_sale', 'shift.arqueo_close', 'shift.open']);
    for (const c of ONLINE_ONLY_COMMANDS) expect(isAllowedOffline(c)).toBe(false);
  });
  it('OnlineOnlyError carries cmd and Spanish message', () => {
    const e = new OnlineOnlyError('point.card_payment');
    expect(e).toBeInstanceOf(Error);
    expect(e.cmd).toBe('point.card_payment');
    expect(e.message).toBe('Requiere internet');
  });
  it.each([
    ['POST', '/api/v1/registers/r1/card-intent', 'point.card_payment'],
    ['DELETE', '/api/v1/registers/r1/card-intent/i1', 'point.card_payment'],
    ['POST', '/api/v1/registers/r1/product-sales/card', 'point.card_payment'],
    ['POST', '/api/v1/registers/r1/product-returns', 'refund.create'],
    ['POST', '/api/v1/registers/r1/membership-sales', 'membership.sale'],
    ['POST', '/api/v1/registers/r1/membership-transfer-sales', 'membership.sale'],
    ['POST', '/api/v1/registers/r1/expenses', 'expense.create'],
    ['POST', '/api/v1/admin/expenses', 'expense.create'],
    ['PATCH', '/api/v1/catalog/plans/p1', 'catalog.edit'],
    ['POST', '/api/v1/catalog/plans', 'catalog.edit'],
    ['POST', '/api/v1/inventory/products', 'inventory.product_edit'],
    ['PATCH', '/api/v1/inventory/products/p1', 'inventory.product_edit'],
    ['POST', '/api/v1/inventory/branches/b1/movements', 'inventory.stock_movement'],
    ['POST', '/api/v1/rentals/gloves', 'rental.create'],
    ['POST', '/api/v1/admin/sessions/s1/revoke', 'staff.admin'],
  ])('classifies %s %s', (m, p, cmd) => {
    expect(classifyRequest(m, p)).toBe(cmd);
  });
  it.each([
    ['GET', '/api/v1/catalog/plans'],
    ['GET', '/api/v1/inventory/products'],
    ['POST', '/api/v1/registers/r1/product-sales'],
    ['POST', '/api/v1/shifts/open'],
    ['POST', '/api/v1/shifts/s1/close'],
    ['POST', '/api/v1/sync/contingency-events'],
  ])('does not guard %s %s', (m, p) => {
    expect(classifyRequest(m, p)).toBeNull();
  });
  it('ignores query strings', () => {
    expect(classifyRequest('POST', '/api/v1/catalog/plans?x=1')).toBe('catalog.edit');
  });
});
