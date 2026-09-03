const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const SEND_CHUNK_SIZE = 100;
const RECEIPT_CHUNK_SIZE = 1000;
const REQUEST_TIMEOUT_MS = 10_000;

export interface PushPayload {
  version: 1;
  accountId: string;
  conversationId: string;
  messageId: string;
  deliveryId: string;
}

export interface ClaimedPushDelivery {
  deliveryId: string;
  expoPushToken: string;
  title: string;
  body: string;
  payload: PushPayload;
  attemptCount: number;
}

export interface ClaimedPushReceipt {
  deliveryId: string;
  ticketId: string;
  attemptCount: number;
}

export type ExpoPushOutcome =
  | { deliveryId: string; kind: 'ticketed'; ticketId: string }
  | { deliveryId: string; kind: 'delivered' }
  | { deliveryId: string; kind: 'receipt_pending'; code: string }
  | { deliveryId: string; kind: 'retry'; code: string }
  | { deliveryId: string; kind: 'failed'; code: string }
  | { deliveryId: string; kind: 'permanent_token'; code: string };

type ProviderOutcomeWithoutId =
  | { kind: 'ticketed'; ticketId: string }
  | { kind: 'delivered' }
  | { kind: 'receipt_pending'; code: string }
  | { kind: 'retry'; code: string }
  | { kind: 'failed'; code: string }
  | { kind: 'permanent_token'; code: string };

type ClassifiedError = Extract<
  ProviderOutcomeWithoutId,
  { kind: 'retry' | 'failed' | 'permanent_token' }
>;

export interface ExpoPushTransport {
  send(deliveries: ClaimedPushDelivery[]): Promise<ExpoPushOutcome[]>;
  receipts(receipts: ClaimedPushReceipt[]): Promise<ExpoPushOutcome[]>;
}

interface TransportDependencies {
  fetch: typeof fetch;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function safeCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!/^[A-Za-z][A-Za-z0-9._:-]{0,119}$/.test(normalized)) return null;
  return normalized;
}

function safeTicketId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(normalized)) return null;
  return normalized;
}

export function classifyExpoError(value: unknown): ClassifiedError {
  const record =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : null;
  const details =
    record?.details && typeof record.details === 'object'
      ? (record.details as Record<string, unknown>)
      : null;
  const code = safeCode(details?.error);

  if (code === 'DeviceNotRegistered' || code === 'InvalidExpoPushToken') {
    return { kind: 'permanent_token', code };
  }
  if (code === 'MessageRateExceeded') return { kind: 'retry', code };
  if (
    code === 'MessageTooBig' ||
    code === 'InvalidCredentials' ||
    code === 'MismatchSenderId'
  ) {
    return { kind: 'failed', code };
  }
  return { kind: 'retry', code: 'unexpected_provider_error' };
}

export function backoffMs(
  attempt: number,
  random: () => number = Math.random
): number {
  const exponent = Math.max(0, Math.min(10, Math.floor(attempt) - 1));
  const base = 30_000 * 2 ** exponent;
  const jitter = 1 + Math.max(0, Math.min(1, random()));
  return Math.min(3_600_000, Math.round(base * jitter));
}

function httpOutcome(status: number): ProviderOutcomeWithoutId {
  if (status === 429 || status >= 500) {
    return { kind: 'retry', code: `expo_http_${status}` };
  }
  return { kind: 'failed', code: `expo_http_${status}` };
}

function repeated(
  deliveryIds: string[],
  outcome: ProviderOutcomeWithoutId
): ExpoPushOutcome[] {
  return deliveryIds.map(
    (deliveryId) => ({ deliveryId, ...outcome }) as ExpoPushOutcome
  );
}

async function postJson(
  fetcher: typeof fetch,
  url: string,
  body: unknown
): Promise<{ response: Response; json: unknown } | { error: true }> {
  try {
    const response = await fetcher(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return { response, json: null };
    return { response, json: await response.json() };
  } catch {
    return { error: true };
  }
}

export function createExpoPushTransport(
  dependencies: TransportDependencies = { fetch }
): ExpoPushTransport {
  return {
    async send(deliveries) {
      const outcomes: ExpoPushOutcome[] = [];
      for (const batch of chunks(deliveries, SEND_CHUNK_SIZE)) {
        const ids = batch.map((delivery) => delivery.deliveryId);
        const result = await postJson(
          dependencies.fetch,
          EXPO_SEND_URL,
          batch.map((delivery) => ({
            to: delivery.expoPushToken,
            title: delivery.title,
            body: delivery.body,
            sound: 'default',
            channelId: 'messages',
            priority: 'high',
            data: delivery.payload,
          }))
        );
        if ('error' in result) {
          outcomes.push(
            ...repeated(ids, { kind: 'retry', code: 'expo_network' })
          );
          continue;
        }
        if (!result.response.ok) {
          outcomes.push(...repeated(ids, httpOutcome(result.response.status)));
          continue;
        }
        const record =
          result.json && typeof result.json === 'object'
            ? (result.json as Record<string, unknown>)
            : null;
        if (
          !Array.isArray(record?.data) ||
          record.data.length !== batch.length
        ) {
          outcomes.push(
            ...repeated(ids, {
              kind: 'retry',
              code: 'unexpected_provider_response',
            })
          );
          continue;
        }
        for (let index = 0; index < batch.length; index += 1) {
          const ticket = record.data[index];
          const ticketRecord =
            ticket && typeof ticket === 'object'
              ? (ticket as Record<string, unknown>)
              : null;
          const ticketId = safeTicketId(ticketRecord?.id);
          if (ticketRecord?.status === 'ok' && ticketId) {
            outcomes.push({
              deliveryId: batch[index].deliveryId,
              kind: 'ticketed',
              ticketId,
            });
          } else {
            outcomes.push({
              deliveryId: batch[index].deliveryId,
              ...classifyExpoError(ticket),
            });
          }
        }
      }
      return outcomes;
    },

    async receipts(receipts) {
      const outcomes: ExpoPushOutcome[] = [];
      for (const batch of chunks(receipts, RECEIPT_CHUNK_SIZE)) {
        const ids = batch.map((receipt) => receipt.deliveryId);
        const result = await postJson(dependencies.fetch, EXPO_RECEIPTS_URL, {
          ids: batch.map((receipt) => receipt.ticketId),
        });
        if ('error' in result) {
          outcomes.push(
            ...repeated(ids, { kind: 'retry', code: 'expo_network' })
          );
          continue;
        }
        if (!result.response.ok) {
          outcomes.push(...repeated(ids, httpOutcome(result.response.status)));
          continue;
        }
        const envelope =
          result.json && typeof result.json === 'object'
            ? (result.json as Record<string, unknown>)
            : null;
        const data =
          envelope?.data &&
          typeof envelope.data === 'object' &&
          !Array.isArray(envelope.data)
            ? (envelope.data as Record<string, unknown>)
            : null;
        if (!data) {
          outcomes.push(
            ...repeated(ids, {
              kind: 'retry',
              code: 'unexpected_provider_response',
            })
          );
          continue;
        }
        for (const receipt of batch) {
          const providerReceipt = data[receipt.ticketId];
          if (providerReceipt === undefined) {
            outcomes.push({
              deliveryId: receipt.deliveryId,
              kind: 'receipt_pending',
              code: 'receipt_not_ready',
            });
            continue;
          }
          const receiptRecord =
            providerReceipt && typeof providerReceipt === 'object'
              ? (providerReceipt as Record<string, unknown>)
              : null;
          if (receiptRecord?.status === 'ok') {
            outcomes.push({
              deliveryId: receipt.deliveryId,
              kind: 'delivered',
            });
          } else {
            outcomes.push({
              deliveryId: receipt.deliveryId,
              ...classifyExpoError(providerReceipt),
            });
          }
        }
      }
      return outcomes;
    },
  };
}
