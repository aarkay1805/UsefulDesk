import { describe, expect, it, vi } from 'vitest';

import {
  processWebhookDelivery,
  type WebhookClaimResult,
  type WebhookEventStore,
} from './webhook-processing';

function retryableStore() {
  let status: 'new' | 'processing' | 'failed' | 'processed' = 'new';
  let attempts = 0;
  let lastError: string | null = null;

  const store: WebhookEventStore = {
    async claim(): Promise<WebhookClaimResult> {
      if (status === 'processed') return 'processed';
      if (status === 'processing') return 'busy';
      status = 'processing';
      attempts += 1;
      lastError = null;
      return 'claimed';
    },
    async complete() {
      status = 'processed';
    },
    async fail(message) {
      status = 'failed';
      lastError = message;
    },
  };

  return {
    store,
    snapshot: () => ({ status, attempts, lastError }),
  };
}

describe('Razorpay webhook processing', () => {
  it('retains a failed attempt and allows the same event to retry', async () => {
    const event = retryableStore();

    await expect(
      processWebhookDelivery(event.store, async () => {
        throw new Error('ledger temporarily unavailable');
      })
    ).resolves.toEqual({
      outcome: 'failed',
      error: 'ledger temporarily unavailable',
    });
    expect(event.snapshot()).toEqual({
      status: 'failed',
      attempts: 1,
      lastError: 'ledger temporarily unavailable',
    });

    await expect(
      processWebhookDelivery(event.store, async () => undefined)
    ).resolves.toEqual({ outcome: 'processed' });
    expect(event.snapshot()).toEqual({
      status: 'processed',
      attempts: 2,
      lastError: null,
    });
  });

  it('keeps a duplicate delivery idempotent after success', async () => {
    const event = retryableStore();
    const handler = vi.fn(async () => undefined);

    await expect(processWebhookDelivery(event.store, handler)).resolves.toEqual(
      { outcome: 'processed' }
    );
    await expect(processWebhookDelivery(event.store, handler)).resolves.toEqual(
      { outcome: 'duplicate' }
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(event.snapshot().attempts).toBe(1);
  });
});
