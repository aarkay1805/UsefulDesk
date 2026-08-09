import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deliveryMocks = vi.hoisted(() => ({
  record: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ serviceRole: true }),
}));
vi.mock('@/lib/payments/razorpay-webhook-delivery', async (importActual) => {
  const actual =
    await importActual<
      typeof import('@/lib/payments/razorpay-webhook-delivery')
    >();
  return {
    ...actual,
    recordRazorpayWebhookDelivery: deliveryMocks.record,
    resolveRazorpayApplicationAccount: deliveryMocks.resolve,
  };
});

import { POST } from './route';

const secret = 'acceptance-test-secret';

describe('Razorpay application webhook shadow route', () => {
  beforeEach(() => {
    configureEnvironment();
    deliveryMocks.record.mockResolvedValue(undefined);
    deliveryMocks.resolve.mockResolvedValue({
      accountId: 'account-id',
      canonicalIngress: 'legacy_account',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('rejects a payload with an invalid signature without a database write', async () => {
    const response = await POST(buildRequest('{}', 'invalid'));

    expect(response.status).toBe(400);
    expect(deliveryMocks.record).not.toHaveBeenCalled();
  });

  it('stays hidden outside the isolated provider-acceptance deployment', async () => {
    vi.stubEnv('RAZORPAY_PROVIDER_ACCEPTANCE_ONLY', 'false');

    const response = await POST(buildRequest('{}', 'invalid'));

    expect(response.status).toBe(404);
    expect(deliveryMocks.record).not.toHaveBeenCalled();
  });

  it('durably records a redacted shadow observation and performs no canonical mutation', async () => {
    const rawBody = JSON.stringify({
      event: 'payment_link.cancelled',
      account_id: 'acc_test',
      payload: { payment_link: { entity: { contact: '9999999999' } } },
    });

    const response = await POST(
      buildRequest(rawBody, createSignature(rawBody), 'evt_test')
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      observed: true,
    });
    expect(deliveryMocks.record).toHaveBeenCalledWith(
      { serviceRole: true },
      expect.objectContaining({
        ingress: 'application',
        accountId: 'account-id',
        externalAccountId: 'acc_test',
        shadowOnly: true,
        signatureSecretGeneration: 'current',
      })
    );
    expect(JSON.stringify(deliveryMocks.record.mock.calls)).not.toContain(
      '9999999999'
    );
  });

  it('fails closed if canonical application ingress is selected prematurely', async () => {
    deliveryMocks.resolve.mockResolvedValue({
      accountId: 'account-id',
      canonicalIngress: 'application',
    });
    const rawBody = JSON.stringify({
      event: 'subscription.charged',
      account_id: 'acc_test',
    });

    const response = await POST(
      buildRequest(rawBody, createSignature(rawBody), 'evt_test')
    );

    expect(response.status).toBe(503);
    expect(deliveryMocks.record).not.toHaveBeenCalled();
  });

  it('accepts the previous secret during a bounded rotation window', async () => {
    vi.stubEnv('RAZORPAY_WEBHOOK_SECRET_PREVIOUS', 'previous-secret');
    const rawBody = JSON.stringify({
      event: 'subscription.pending',
      account_id: 'acc_test',
    });
    const signature = createHmac('sha256', 'previous-secret')
      .update(rawBody)
      .digest('hex');

    const response = await POST(buildRequest(rawBody, signature, 'evt_test'));

    expect(response.status).toBe(200);
    expect(deliveryMocks.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ signatureSecretGeneration: 'previous' })
    );
  });
});

function configureEnvironment() {
  vi.stubEnv('RAZORPAY_MODE', 'test');
  vi.stubEnv('RAZORPAY_PROVIDER_ACCEPTANCE_ONLY', 'true');
  vi.stubEnv('RAZORPAY_WEBHOOK_SECRET_CURRENT', secret);
}

function createSignature(rawBody: string) {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

function buildRequest(rawBody: string, signature: string, eventId?: string) {
  const headers = new Headers({
    'content-type': 'application/json',
    'x-razorpay-signature': signature,
  });
  if (eventId) headers.set('x-razorpay-event-id', eventId);

  return new Request('https://example.test/api/payments/razorpay/webhook', {
    method: 'POST',
    headers,
    body: rawBody,
  });
}
