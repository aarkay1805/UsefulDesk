export const BATCH_SEND_ATTEMPTS = 4;

const DEFAULT_RETRY_MS = 5_000;
const MAX_RETRY_MS = 120_000;

/** Return a bounded wait for a safe 429 replay, or null for every other status. */
export function batchRetryDelayMs(
  status: number,
  retryAfter: string | null,
  nowMs = Date.now()
): number | null {
  if (status !== 429) return null;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1_000, MAX_RETRY_MS);
  }

  const retryAt = retryAfter ? Date.parse(retryAfter) : Number.NaN;
  if (Number.isFinite(retryAt) && retryAt > nowMs) {
    return Math.min(retryAt - nowMs, MAX_RETRY_MS);
  }

  return DEFAULT_RETRY_MS;
}

/**
 * Retry only HTTP 429. The broadcast route checks its rate limit before any
 * Meta call, so this status proves the batch was not partially sent. Network
 * errors and every other HTTP failure are deliberately returned/thrown once.
 */
export async function fetchBroadcastBatchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
  sleepImpl: (ms: number) => Promise<unknown> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms))
): Promise<Response> {
  for (let attempt = 1; attempt <= BATCH_SEND_ATTEMPTS; attempt++) {
    const response = await fetchImpl(input, init);
    if (response.ok || attempt === BATCH_SEND_ATTEMPTS) return response;

    const retryMs = batchRetryDelayMs(
      response.status,
      response.headers.get('Retry-After')
    );
    if (retryMs === null) return response;
    await sleepImpl(retryMs);
  }

  throw new Error('Unreachable broadcast retry state');
}
