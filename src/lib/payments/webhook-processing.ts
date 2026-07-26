export type WebhookClaimResult = 'claimed' | 'processed' | 'busy' | 'conflict';

export interface WebhookEventStore {
  claim(): Promise<WebhookClaimResult>;
  complete(): Promise<void>;
  fail(message: string): Promise<void>;
}

export type WebhookProcessingResult =
  | { outcome: 'processed' }
  | { outcome: 'duplicate' }
  | { outcome: 'busy' }
  | { outcome: 'conflict' }
  | { outcome: 'failed'; error: string };

/**
 * Run one safely claimed delivery. Failed attempts retain their claim row and
 * can be claimed again; completed attempts stay permanent duplicates.
 */
export async function processWebhookDelivery(
  store: WebhookEventStore,
  handle: () => Promise<void>
): Promise<WebhookProcessingResult> {
  const claim = await store.claim();
  if (claim === 'processed') return { outcome: 'duplicate' };
  if (claim === 'busy') return { outcome: 'busy' };
  if (claim === 'conflict') return { outcome: 'conflict' };

  try {
    await handle();
    await store.complete();
    return { outcome: 'processed' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.fail(message);
    return { outcome: 'failed', error: message };
  }
}
