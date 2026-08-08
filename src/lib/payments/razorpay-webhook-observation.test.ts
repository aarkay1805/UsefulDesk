import { describe, expect, it } from 'vitest';

import {
  buildRazorpayWebhookObservation,
  RAZORPAY_ACCEPTANCE_MAX_BODY_BYTES,
  RazorpayWebhookObservationError,
} from './razorpay-webhook-observation';

describe('buildRazorpayWebhookObservation', () => {
  it('retains only provider identity and a payload hash', () => {
    const raw = JSON.stringify({
      event: 'payment_link.paid',
      account_id: 'acc_test',
      payload: { payment_link: { entity: { contact: '9999999999' } } },
    });

    const observation = buildRazorpayWebhookObservation(
      raw,
      'evt_test',
      new Date('2026-08-08T12:00:00.000Z')
    );

    expect(observation).toEqual({
      marker: 'razorpay_application_webhook_observation',
      eventId: 'evt_test',
      eventType: 'payment_link.paid',
      accountId: 'acc_test',
      payloadSha256:
        '375f664a87a0f374211c1206931863b9c8cf70cc8797e9a9b3aedf8e8c4cd3f4',
      receivedAt: '2026-08-08T12:00:00.000Z',
    });
    expect(JSON.stringify(observation)).not.toContain('9999999999');
  });

  it.each([
    ['not json', 'malformed_payload'],
    ['{}', 'missing_event_type'],
    ['[]', 'missing_event_type'],
  ] as const)('rejects %s', (raw, code) => {
    expectObservationError(raw, code);
  });

  it('rejects an oversized body before parsing it', () => {
    const raw = 'x'.repeat(RAZORPAY_ACCEPTANCE_MAX_BODY_BYTES + 1);
    expectObservationError(raw, 'payload_too_large');
  });
});

function expectObservationError(
  raw: string,
  code: RazorpayWebhookObservationError['code']
) {
  try {
    buildRazorpayWebhookObservation(raw, null);
    throw new Error('Expected observation parsing to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(RazorpayWebhookObservationError);
    expect((error as RazorpayWebhookObservationError).code).toBe(code);
  }
}
