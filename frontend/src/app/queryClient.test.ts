import { describe, expect, it } from 'vitest';
import { HttpError } from '../api/http';
import { createQueryClient, queryClient, shouldRetryQuery } from './queryClient';

describe('query client defaults', () => {
  it('does not retry 4xx responses', () => {
    expect(shouldRetryQuery(0, new HttpError(404, 'nf'))).toBe(false);
    expect(shouldRetryQuery(0, new HttpError(400, 'bad'))).toBe(false);
    expect(shouldRetryQuery(0, { status: 403 })).toBe(false);
  });
  it('retries 5xx up to twice', () => {
    const error = new HttpError(503, 'down');
    expect(shouldRetryQuery(0, error)).toBe(true);
    expect(shouldRetryQuery(1, error)).toBe(true);
    expect(shouldRetryQuery(2, error)).toBe(false);
  });
  it('retries network errors', () => {
    expect(shouldRetryQuery(0, new Error('network'))).toBe(true);
    expect(shouldRetryQuery(0, new HttpError(0, 'offline'))).toBe(true);
    expect(shouldRetryQuery(2, new Error('network'))).toBe(false);
  });
  it('configures defaults', () => {
    const defaults = createQueryClient().getDefaultOptions();
    expect(defaults.queries?.staleTime).toBe(30_000);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
    expect(defaults.mutations?.retry).toBe(false);
    expect(queryClient).toBeDefined();
  });
});
