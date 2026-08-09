import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { buildRazorpayWebhookDeliveryIdentity } from './razorpay-webhook-delivery';

describe('Razorpay webhook delivery identity', () => {
  const rawBody = JSON.stringify({
    event: 'subscription.charged',
    account_id: 'acc_test',
    payload: { payment: { entity: { id: 'pay_test' } } },
  });

  it('uses the provider event header unchanged when present', () => {
    expect(
      buildRazorpayWebhookDeliveryIdentity({
        rawBody,
        headerEventId: 'evt_test',
        providerMode: 'test',
        externalAccountId: 'acc_test',
      })
    ).toMatchObject({
      providerEventId: 'evt_test',
      eventIdentitySource: 'header',
    });
  });

  it('derives the same fallback across ingresses without using the signature', () => {
    const first = buildRazorpayWebhookDeliveryIdentity({
      rawBody,
      headerEventId: null,
      providerMode: 'test',
      externalAccountId: 'acc_test',
    });
    const second = buildRazorpayWebhookDeliveryIdentity({
      rawBody,
      headerEventId: null,
      providerMode: 'test',
      externalAccountId: 'acc_test',
    });

    expect(first.providerEventId).toMatch(/^fallback:[0-9a-f]{64}$/);
    expect(second.providerEventId).toBe(first.providerEventId);
    expect(first.eventIdentitySource).toBe('payload_hash_fallback');
  });

  it('binds a fallback identity to provider mode and external merchant', () => {
    const base = buildRazorpayWebhookDeliveryIdentity({
      rawBody,
      headerEventId: null,
      providerMode: 'test',
      externalAccountId: 'acc_test',
    });
    const otherMode = buildRazorpayWebhookDeliveryIdentity({
      rawBody,
      headerEventId: null,
      providerMode: 'live',
      externalAccountId: 'acc_test',
    });
    const otherMerchant = buildRazorpayWebhookDeliveryIdentity({
      rawBody,
      headerEventId: null,
      providerMode: 'test',
      externalAccountId: 'acc_other',
    });

    expect(otherMode.providerEventId).not.toBe(base.providerEventId);
    expect(otherMerchant.providerEventId).not.toBe(base.providerEventId);
  });
});
