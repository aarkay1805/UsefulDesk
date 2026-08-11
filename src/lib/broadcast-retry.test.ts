import { describe, expect, it, vi } from 'vitest';

import {
  BATCH_SEND_ATTEMPTS,
  batchRetryDelayMs,
  fetchBroadcastBatchWithRetry,
} from './broadcast-retry';

function response(status: number, retryAfter: string | null = null): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => retryAfter },
  } as unknown as Response;
}

describe('batchRetryDelayMs', () => {
  it('honors numeric and HTTP-date Retry-After values', () => {
    const now = Date.parse('2026-08-11T04:00:00Z');
    expect(batchRetryDelayMs(429, '12', now)).toBe(12_000);
    expect(batchRetryDelayMs(429, 'Tue, 11 Aug 2026 04:00:20 GMT', now)).toBe(
      20_000
    );
  });

  it('uses a fallback for junk and caps excessive waits', () => {
    expect(batchRetryDelayMs(429, 'soon')).toBe(5_000);
    expect(batchRetryDelayMs(429, '86400')).toBe(120_000);
  });

  it.each([400, 401, 403, 422, 500, 503])('does not retry HTTP %i', (status) =>
    expect(batchRetryDelayMs(status, '1')).toBeNull()
  );
});

describe('fetchBroadcastBatchWithRetry', () => {
  it('waits and replays a rate-limited batch', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(429, '2'))
      .mockResolvedValueOnce(response(200));
    const sleep = vi.fn(async () => undefined);

    await expect(
      fetchBroadcastBatchWithRetry(
        '/api/whatsapp/broadcast',
        {},
        fetchImpl,
        sleep
      )
    ).resolves.toMatchObject({ status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it('never replays an unsafe HTTP failure', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(500));

    await expect(
      fetchBroadcastBatchWithRetry('/api/whatsapp/broadcast', {}, fetchImpl)
    ).resolves.toMatchObject({ status: 500 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('bounds repeated 429 attempts', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(429, '1'));
    const sleep = vi.fn(async () => undefined);

    await fetchBroadcastBatchWithRetry(
      '/api/whatsapp/broadcast',
      {},
      fetchImpl,
      sleep
    );

    expect(fetchImpl).toHaveBeenCalledTimes(BATCH_SEND_ATTEMPTS);
    expect(sleep).toHaveBeenCalledTimes(BATCH_SEND_ATTEMPTS - 1);
  });
});
