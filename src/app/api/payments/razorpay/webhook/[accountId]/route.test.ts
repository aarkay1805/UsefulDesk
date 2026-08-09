import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getBinding: vi.fn(),
  record: vi.fn(),
  processCanonical: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ serviceRole: true }),
}));
vi.mock('@/lib/payments/credentials', () => ({
  getRazorpayLegacyWebhookBinding: mocks.getBinding,
}));
vi.mock('@/lib/payments/razorpay-webhook-delivery', async (importActual) => {
  const actual =
    await importActual<
      typeof import('@/lib/payments/razorpay-webhook-delivery')
    >();
  return { ...actual, recordRazorpayWebhookDelivery: mocks.record };
});
vi.mock('@/lib/payments/razorpay-webhook-processor', async (importActual) => {
  const actual =
    await importActual<
      typeof import('@/lib/payments/razorpay-webhook-processor')
    >();
  return {
    ...actual,
    processCanonicalRazorpayWebhook: mocks.processCanonical,
  };
});

import { POST } from './route';

const secret = 'legacy-test-secret';

describe('Razorpay legacy account webhook route', () => {
  beforeEach(() => {
    vi.stubEnv('RAZORPAY_MODE', 'test');
    mocks.getBinding.mockResolvedValue({
      secret,
      externalAccountId: 'acc_test',
      canonicalIngress: 'legacy_account',
    });
    mocks.record.mockResolvedValue(undefined);
    mocks.processCanonical.mockResolvedValue({ outcome: 'processed' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('uses the shared canonical processor while legacy is selected', async () => {
    const rawBody = eventBody('subscription.activated');

    const response = await POST(buildRequest(rawBody, 'evt_legacy'), context());

    expect(response.status).toBe(200);
    expect(mocks.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ingress: 'legacy_account', shadowOnly: false })
    );
    expect(mocks.processCanonical).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-id',
        externalAccountId: 'acc_test',
        ingress: 'legacy_account',
      })
    );
  });

  it('remains durable observation-only after application cutover', async () => {
    mocks.getBinding.mockResolvedValue({
      secret,
      externalAccountId: 'acc_test',
      canonicalIngress: 'application',
    });
    const rawBody = eventBody('subscription.charged');

    const response = await POST(buildRequest(rawBody, 'evt_shadow'), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      observed: true,
    });
    expect(mocks.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ingress: 'legacy_account', shadowOnly: true })
    );
    expect(mocks.processCanonical).not.toHaveBeenCalled();
  });

  it('rejects an application-account mismatch before observation', async () => {
    const rawBody = eventBody('subscription.pending', 'acc_other');

    const response = await POST(buildRequest(rawBody, 'evt_wrong'), context());

    expect(response.status).toBe(400);
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.processCanonical).not.toHaveBeenCalled();
  });
});

function eventBody(event: string, accountId = 'acc_test') {
  return JSON.stringify({ event, account_id: accountId, payload: {} });
}

function buildRequest(rawBody: string, eventId: string) {
  const signature = createHmac('sha256', secret).update(rawBody).digest('hex');
  return new Request(
    'https://example.test/api/payments/razorpay/webhook/account-id',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': signature,
        'x-razorpay-event-id': eventId,
      },
      body: rawBody,
    }
  );
}

function context() {
  return { params: Promise.resolve({ accountId: 'account-id' }) };
}
