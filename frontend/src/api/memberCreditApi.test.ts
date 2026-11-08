import { describe, expect, it, vi } from 'vitest';
import { HttpError } from './http';
import { depositMemberCredit, listMemberCreditMovements } from './memberCreditApi';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('memberCreditApi', () => {
  it('posts a deposit with its idempotency key', async () => {
    const request = vi.fn().mockResolvedValue(json({ id: 'm1', kind: 'deposit', amount_minor: 6000 }, 201));
    const result = await depositMemberCredit(request, 'reg 1', { member_id: 'mem-1', amount_minor: 6000 }, 'key-1');
    expect(result.amount_minor).toBe(6000);
    const [path, init] = request.mock.calls[0];
    expect(path).toBe('/api/v1/registers/reg%201/member-credit-deposits');
    expect(init.method).toBe('POST');
    expect(init.headers['Idempotency-Key']).toBe('key-1');
    expect(JSON.parse(init.body)).toEqual({ member_id: 'mem-1', amount_minor: 6000 });
  });

  it('maps a closed shift to a readable conflict message', async () => {
    const request = vi.fn().mockResolvedValue(json({ error: { code: 'conflict' } }, 409));
    await expect(depositMemberCredit(request, 'reg', { member_id: 'm', amount_minor: 100 }, 'k')).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('turno abierto'),
    });
    await expect(depositMemberCredit(request, 'reg', { member_id: 'm', amount_minor: 100 }, 'k')).rejects.toBeInstanceOf(HttpError);
  });

  it('lists the ledger page of a member', async () => {
    const request = vi.fn().mockResolvedValue(json({ total_items: 1, items: [{ id: 'm1', kind: 'apply' }] }));
    const page = await listMemberCreditMovements(request, 'mem-1', 10, 5);
    expect(page.total_items).toBe(1);
    expect(request.mock.calls[0][0]).toBe('/api/v1/members/mem-1/credit-movements?offset=10&limit=5');
  });
});
