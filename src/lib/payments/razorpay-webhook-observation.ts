import { createHash } from 'node:crypto';

export const RAZORPAY_ACCEPTANCE_MAX_BODY_BYTES = 1_000_000;

export interface RazorpayWebhookObservation {
  marker: 'razorpay_application_webhook_observation';
  eventId: string | null;
  eventType: string;
  accountId: string | null;
  payloadSha256: string;
  receivedAt: string;
}

/**
 * Build the deliberately redacted log record used during provider acceptance.
 * Raw payloads, signatures, member data, and merchant tokens never enter logs.
 */
export function buildRazorpayWebhookObservation(
  rawBody: string,
  eventId: string | null,
  receivedAt = new Date()
): RazorpayWebhookObservation {
  if (Buffer.byteLength(rawBody, 'utf8') > RAZORPAY_ACCEPTANCE_MAX_BODY_BYTES) {
    throw new RazorpayWebhookObservationError('payload_too_large');
  }

  let value: unknown;
  try {
    value = JSON.parse(rawBody) as unknown;
  } catch {
    throw new RazorpayWebhookObservationError('malformed_payload');
  }

  if (!isRecord(value) || typeof value.event !== 'string' || !value.event) {
    throw new RazorpayWebhookObservationError('missing_event_type');
  }

  return {
    marker: 'razorpay_application_webhook_observation',
    eventId,
    eventType: value.event,
    accountId:
      typeof value.account_id === 'string' && value.account_id
        ? value.account_id
        : null,
    payloadSha256: createHash('sha256').update(rawBody).digest('hex'),
    receivedAt: receivedAt.toISOString(),
  };
}

export class RazorpayWebhookObservationError extends Error {
  constructor(
    readonly code:
      'payload_too_large' | 'malformed_payload' | 'missing_event_type'
  ) {
    super(code);
    this.name = 'RazorpayWebhookObservationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
