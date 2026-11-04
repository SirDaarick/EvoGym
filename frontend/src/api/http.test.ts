/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HttpError,
  NetworkError,
  createHttpClient,
  isHttpError,
  isNetworkError,
  parseErrorEnvelope,
  requestJson,
} from './http';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

afterEach(() => vi.restoreAllMocks());

describe('parseErrorEnvelope', () => {
  it('reads code, body request_id, issues and metadata', async () => {
    const parsed = await parseErrorEnvelope(json(422, {
      error: { code: 'VALIDATION_ERROR', message: 'x', request_id: 'body-id', issues: [{ location: ['body', 'name'], type: 'missing' }, { location: ['weird'], type: 'nope' }], metadata: { a: 1 } },
    }));
    expect(parsed.code).toBe('VALIDATION_ERROR');
    expect(parsed.requestId).toBe('body-id');
    expect(parsed.issues).toEqual([{ location: ['body'], type: 'missing' }, { location: [], type: 'invalid' }]);
    expect(parsed.metadata).toEqual({ a: 1 });
  });
  it('prefers the X-Request-ID header', async () => {
    const parsed = await parseErrorEnvelope(json(500, { error: { request_id: 'body' } }, { 'X-Request-ID': 'hdr' }));
    expect(parsed.requestId).toBe('hdr');
  });
  it('rejects invalid codes', async () => {
    expect((await parseErrorEnvelope(json(400, { error: { code: 'bad code!' } }))).code).toBeUndefined();
  });
  it('reads legacy detail', async () => {
    expect((await parseErrorEnvelope(json(400, { detail: 'legacy' }))).detail).toBe('legacy');
  });
  it('tolerates non-JSON bodies', async () => {
    const parsed = await parseErrorEnvelope(new Response('<html>', { status: 502, headers: { 'X-Request-ID': 'r1' } }));
    expect(parsed).toEqual({ requestId: 'r1' });
  });
});

describe('requestJson', () => {
  it('wraps a 2xx with invalid JSON into a typed HttpError', async () => {
    const req = vi.fn().mockResolvedValue(new Response('<html>oops</html>', { status: 200 }));
    const err = await requestJson<any>(req, '/x').catch((e: any) => e);
    expect(isHttpError(err)).toBe(true);
    expect(err).toMatchObject({ status: 200, code: 'invalid_response', message: 'Respuesta inválida del servidor.' });
  });

  it('maps fetch rejection to NetworkError', async () => {
    const req = vi.fn().mockRejectedValue(new TypeError('fail'));
    const err = await requestJson<any>(req, '/x', { method: 'POST', body: {} }).catch((e: any) => e);
    expect(isNetworkError(err)).toBe(true);
    expect(err.message).toBe('No se pudo conectar con el servidor.');
  });
  it('maps errors to HttpError with message map and default', async () => {
    const req = vi.fn().mockResolvedValue(json(409, { error: { code: 'DUP' } }, { 'X-Request-ID': 'q' }));
    const err = await requestJson<any>(req, '/x', { messages: { DUP: 'Duplicado' } }).catch((e: any) => e);
    expect(isHttpError(err)).toBe(true);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 409, code: 'DUP', requestId: 'q', message: 'Duplicado' });
    const req2 = vi.fn().mockResolvedValue(json(403, {}));
    expect((await requestJson<any>(req2, '/x', { retry: 0 }).catch((e: any) => e)).message).toBe('No tienes autorización para realizar esta acción.');
  });
  it('uses errorFactory', async () => {
    const req = vi.fn().mockResolvedValue(json(400, {}));
    const err = await requestJson<any>(req, '/x', { errorFactory: (s) => new Error(`custom ${s}`) }).catch((e: any) => e);
    expect(err.message).toBe('custom 400');
  });
  it('retries GET on 503 then succeeds', async () => {
    const req = vi.fn().mockResolvedValueOnce(json(503, {})).mockResolvedValueOnce(json(200, { ok: 1 }));
    await expect(requestJson(req, '/x', { retryDelayMs: 1 })).resolves.toEqual({ ok: 1 });
    expect(req).toHaveBeenCalledTimes(2);
  });
  it('does not retry POST', async () => {
    const req = vi.fn().mockResolvedValue(json(503, {}));
    await expect(requestJson(req, '/x', { method: 'POST', body: { a: 1 }, retryDelayMs: 1 })).rejects.toBeInstanceOf(HttpError);
    expect(req).toHaveBeenCalledTimes(1);
  });
  it('does not retry aborts', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const req = vi.fn().mockRejectedValue(abort);
    await expect(requestJson(req, '/x', { retryDelayMs: 1 })).rejects.toBe(abort);
    expect(req).toHaveBeenCalledTimes(1);
  });
  it('retries network errors for GET and gives up', async () => {
    const req = vi.fn().mockRejectedValue(new TypeError('down'));
    await expect(requestJson(req, '/x', { retry: 1, retryDelayMs: 1 })).rejects.toBeInstanceOf(NetworkError);
    expect(req).toHaveBeenCalledTimes(2);
  });
  it('sends JSON body, Content-Type and Idempotency-Key; 204 yields undefined', async () => {
    const req = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await expect(requestJson(req, '/x', { method: 'POST', body: { a: 1 }, idempotencyKey: 'k1' })).resolves.toBeUndefined();
    expect(req).toHaveBeenCalledWith('/x', expect.objectContaining({
      method: 'POST',
      body: '{"a":1}',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'k1' },
    }));
  });
});

describe('createHttpClient', () => {
  it('prefixes base URL and injects headers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, {}));
    const client = createHttpClient({ baseUrl: 'https://api.test/', getAuthorization: () => 'Bearer t', branchId: 'b1', fetchImpl });
    await client('/api/v1/x', { headers: { 'X-Other': '1' } });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.test/api/v1/x', { headers: { Authorization: 'Bearer t', 'X-Branch-ID': 'b1', 'X-Other': '1' } });
  });
  it('omits absent auth and resolves globalThis.fetch at call time', async () => {
    const client = createHttpClient({ baseUrl: 'https://api.test', getAuthorization: () => null });
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, {}));
    await client('/p');
    expect(spy).toHaveBeenCalledWith('https://api.test/p', { headers: {} });
  });
});
