import { describe, expect, it, vi } from 'vitest';
import {
  getRosterDelta,
  getSyncStatus,
  postBootstrap,
  postContingencyEvents,
  SyncApiError,
} from './syncApi';

describe('syncApi HTTP client', () => {
  it('posts bootstrap and parses response', async () => {
    const mockResponse = {
      device: { device_id: 'd1', device_prefix: 'REC-SUR1', token: 't1', expires_at: '', next_seq: 1 },
      server_time: '2026-11-05T00:00:00Z',
      offline_grant_ttl_hours: 24,
      branch: { id: 'b1', code: 'sur', name: 'Sur', timezone: 'UTC' },
      roster: [],
      catalog: [],
      registers: [],
      cursor: null,
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await postBootstrap({ station_code: 'SUR1' }, 'mock-token', 'b1');
    expect(res.device.device_prefix).toBe('REC-SUR1');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/sync/bootstrap',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer mock-token',
          'X-Branch-ID': 'b1',
        }),
      }),
    );
    vi.unstubAllGlobals();
  });

  it('handles error response by throwing SyncApiError', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: async () => ({ detail: 'Out of order sequence' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      postContingencyEvents({ events: [] }, 'dev-token'),
    ).rejects.toThrow('Out of order sequence');

    vi.unstubAllGlobals();
  });
});
