import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { confirmTestPayment, recordTestRenewalFailure } = vi.hoisted(() => ({
  confirmTestPayment: vi.fn(),
  recordTestRenewalFailure: vi.fn(),
}));
vi.mock('@/lib/subscriptions/test-flow', () => ({
  confirmTestPayment,
  recordTestRenewalFailure,
}));

import { POST } from './route';

const merchantId = 'acc_UsefulmadeTest';
const webhookSecret = 'webhook-test-secret';

function signedRequest(event: unknown, signatureOverride?: string) {
  const raw = JSON.stringify(event);
  const signature =
    signatureOverride ??
    createHmac('sha256', webhookSecret).update(raw).digest('hex');
  return new Request('https://desk.example/api/subscriptions/test-webhook', {
    method: 'POST',
    headers: { 'x-razorpay-signature': signature },
    body: raw,
  });
}

const captured = {
  account_id: merchantId,
  event: 'payment.captured',
  payload: {
    payment: {
      entity: {
        id: 'pay_Test123',
        order_id: 'order_Test456',
        status: 'captured',
      },
    },
  },
};

describe('Usefulmade Test webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('USEFULDESK_SUBSCRIPTION_INTENTS_ENABLED', 'true');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_MODE', 'test');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_TEST_KEY_ID', 'rzp_test_key');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_TEST_KEY_SECRET', 'checkout-secret');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_TEST_WEBHOOK_SECRET', webhookSecret);
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_TEST_MERCHANT_ID', merchantId);
    confirmTestPayment.mockResolvedValue({});
  });
  afterEach(() => vi.unstubAllEnvs());

  it('is unavailable in Production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect((await POST(signedRequest(captured))).status).toBe(404);
    expect(confirmTestPayment).not.toHaveBeenCalled();
    expect(recordTestRenewalFailure).not.toHaveBeenCalled();
  });

  it('rejects changed bytes and a different merchant before any payment lookup', async () => {
    expect((await POST(signedRequest(captured, '0'.repeat(64)))).status).toBe(
      400
    );
    expect(
      (
        await POST(
          signedRequest({ ...captured, account_id: 'acc_OtherMerchant' })
        )
      ).status
    ).toBe(403);
    expect(confirmTestPayment).not.toHaveBeenCalled();
    expect(recordTestRenewalFailure).not.toHaveBeenCalled();
  });

  it('confirms only a signed captured event with the pinned merchant', async () => {
    const response = await POST(signedRequest(captured));
    expect(response.status).toBe(200);
    expect(confirmTestPayment).toHaveBeenCalledWith({
      source: 'webhook',
      orderId: 'order_Test456',
      paymentId: 'pay_Test123',
    });
  });

  it('retries transient commit failure and ignores other signed event types', async () => {
    confirmTestPayment.mockRejectedValueOnce(new Error('database unavailable'));
    expect((await POST(signedRequest(captured))).status).toBe(503);
    expect(
      (await POST(signedRequest({ ...captured, event: 'order.paid' }))).status
    ).toBe(200);
    expect(confirmTestPayment).toHaveBeenCalledTimes(1);
  });

  it('verifies a signed failed payment before granting renewal grace and retries verifier outages', async () => {
    expect(
      (await POST(signedRequest({ ...captured, event: 'payment.failed' })))
        .status
    ).toBe(200);
    expect(recordTestRenewalFailure).toHaveBeenCalledWith({
      orderId: 'order_Test456',
      paymentId: 'pay_Test123',
    });
    expect(confirmTestPayment).not.toHaveBeenCalled();
    recordTestRenewalFailure.mockRejectedValueOnce(
      new Error('provider unavailable')
    );
    expect(
      (await POST(signedRequest({ ...captured, event: 'payment.failed' })))
        .status
    ).toBe(503);
  });
});
