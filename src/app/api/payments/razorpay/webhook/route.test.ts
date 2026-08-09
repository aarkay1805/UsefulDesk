import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  record: vi.fn(),
  resolve: vi.fn(),
  createStore: vi.fn(),
  claim: vi.fn(),
  processClaimed: vi.fn(),
  consumeRetryAcceptance: vi.fn(),
  acknowledgeRetryAcceptance: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/server', async (importActual) => {
  const actual = await importActual<typeof import('next/server')>();
  return { ...actual, after: mocks.after };
});
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
    recordRazorpayWebhookDelivery: mocks.record,
    resolveRazorpayApplicationAccount: mocks.resolve,
  };
});
vi.mock('@/lib/payments/razorpay-webhook-processor', async (importActual) => {
  const actual =
    await importActual<
      typeof import('@/lib/payments/razorpay-webhook-processor')
    >();
  return {
    ...actual,
    createRazorpayWebhookEventStore: mocks.createStore,
    processClaimedRazorpayWebhook: mocks.processClaimed,
  };
});
vi.mock('@/lib/payments/razorpay-webhook-retry-acceptance', () => ({
  consumeRazorpayRetryAcceptance: mocks.consumeRetryAcceptance,
  acknowledgeRazorpayRetryAcceptance: mocks.acknowledgeRetryAcceptance,
}));

import { POST } from './route';

const secret = 'acceptance-test-secret';

describe('Razorpay application webhook route', () => {
  beforeEach(() => {
    configureEnvironment();
    mocks.record.mockResolvedValue(undefined);
    mocks.resolve.mockResolvedValue({
      accountId: 'account-id',
      canonicalIngress: 'legacy_account',
    });
    mocks.claim.mockResolvedValue('claimed');
    mocks.createStore.mockReturnValue({
      store: { claim: mocks.claim },
      processingOwner: 'owner-id',
    });
    mocks.processClaimed.mockResolvedValue({ outcome: 'processed' });
    mocks.consumeRetryAcceptance.mockResolvedValue({
      action: 'pass',
      acceptanceId: null,
    });
    mocks.acknowledgeRetryAcceptance.mockResolvedValue(undefined);
    mocks.after.mockImplementation((callback: () => unknown) => callback());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('rejects an invalid signature without a database write', async () => {
    const response = await POST(buildRequest('{}', 'invalid'));

    expect(response.status).toBe(400);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('stays hidden outside the isolated provider-acceptance deployment', async () => {
    vi.stubEnv('RAZORPAY_PROVIDER_ACCEPTANCE_ONLY', 'false');

    const response = await POST(buildRequest('{}', 'invalid'));

    expect(response.status).toBe(404);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('records only a shadow observation while legacy remains canonical', async () => {
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
    expect(mocks.record).toHaveBeenCalledWith(
      { serviceRole: true },
      expect.objectContaining({
        ingress: 'application',
        accountId: 'account-id',
        externalAccountId: 'acc_test',
        shadowOnly: true,
        signatureSecretGeneration: 'current',
      })
    );
    expect(mocks.createStore).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.record.mock.calls)).not.toContain('9999999999');
  });

  it('claims before acknowledgement and schedules shared canonical processing after cutover', async () => {
    mocks.resolve.mockResolvedValue({
      accountId: 'account-id',
      canonicalIngress: 'application',
    });
    const rawBody = eventBody('subscription.charged');

    const response = await POST(
      buildRequest(rawBody, createSignature(rawBody), 'evt_charged')
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      accepted: true,
    });
    expect(mocks.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ shadowOnly: false })
    );
    expect(mocks.createStore).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-id',
        externalAccountId: 'acc_test',
        providerMode: 'test',
      })
    );
    expect(mocks.consumeRetryAcceptance).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-id',
        providerEventId: 'evt_charged',
      })
    );
    expect(mocks.claim).toHaveBeenCalledOnce();
    expect(mocks.after).toHaveBeenCalledOnce();
    expect(mocks.processClaimed).toHaveBeenCalledWith({
      admin: { serviceRole: true },
      accountId: 'account-id',
      eventId: 'evt_charged',
      processingOwner: 'owner-id',
      event: JSON.parse(rawBody),
      ingress: 'application',
    });
  });

  it('requests exactly one provider retry before creating canonical state', async () => {
    mocks.resolve.mockResolvedValue({
      accountId: 'account-id',
      canonicalIngress: 'application',
    });
    mocks.consumeRetryAcceptance.mockResolvedValue({
      action: 'retry',
      acceptanceId: 'acceptance-id',
    });
    const rawBody = eventBody('subscription.cancelled', 'acc_test', 'sub_new');

    const response = await POST(
      buildRequest(rawBody, createSignature(rawBody), 'evt_cancelled')
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(mocks.record).toHaveBeenCalledOnce();
    expect(mocks.createStore).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('claims and acknowledges an identical provider redelivery', async () => {
    mocks.resolve.mockResolvedValue({
      accountId: 'account-id',
      canonicalIngress: 'application',
    });
    mocks.consumeRetryAcceptance.mockResolvedValue({
      action: 'redelivery',
      acceptanceId: 'acceptance-id',
    });
    const rawBody = eventBody('subscription.cancelled', 'acc_test', 'sub_new');

    const response = await POST(
      buildRequest(rawBody, createSignature(rawBody), 'evt_cancelled')
    );

    expect(response.status).toBe(200);
    expect(mocks.claim).toHaveBeenCalledOnce();
    expect(mocks.acknowledgeRetryAcceptance).toHaveBeenCalledWith({
      admin: { serviceRole: true },
      acceptanceId: 'acceptance-id',
      accountId: 'account-id',
      providerEventId: 'evt_cancelled',
      payloadSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      claimResult: 'claimed',
    });
    expect(mocks.after).toHaveBeenCalledOnce();
  });

  it('fails closed when a matching acceptance identity conflicts', async () => {
    mocks.resolve.mockResolvedValue({
      accountId: 'account-id',
      canonicalIngress: 'application',
    });
    mocks.consumeRetryAcceptance.mockResolvedValue({
      action: 'conflict',
      acceptanceId: 'acceptance-id',
    });
    const rawBody = eventBody('subscription.cancelled', 'acc_test', 'sub_new');

    const response = await POST(
      buildRequest(rawBody, createSignature(rawBody), 'evt_conflict')
    );

    expect(response.status).toBe(409);
    expect(mocks.createStore).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('acknowledges a processed replay without another mutation', async () => {
    mocks.resolve.mockResolvedValue({
      accountId: 'account-id',
      canonicalIngress: 'application',
    });
    mocks.claim.mockResolvedValue('processed');
    const rawBody = eventBody('subscription.activated');

    const response = await POST(
      buildRequest(rawBody, createSignature(rawBody), 'evt_replay')
    );

    await expect(response.json()).resolves.toEqual({
      ok: true,
      deduped: true,
    });
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.processClaimed).not.toHaveBeenCalled();
  });

  it('keeps an unknown signed account observation-only after application cutover', async () => {
    mocks.resolve.mockResolvedValue(null);
    const rawBody = eventBody('subscription.pending', 'acc_unknown');

    const response = await POST(
      buildRequest(rawBody, createSignature(rawBody), 'evt_unknown')
    );

    expect(response.status).toBe(200);
    expect(mocks.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ accountId: null, shadowOnly: true })
    );
    expect(mocks.createStore).not.toHaveBeenCalled();
  });

  it('returns a conflict when immutable canonical identity differs', async () => {
    mocks.resolve.mockResolvedValue({
      accountId: 'account-id',
      canonicalIngress: 'application',
    });
    mocks.claim.mockResolvedValue('conflict');
    const rawBody = eventBody('subscription.charged');

    const response = await POST(
      buildRequest(rawBody, createSignature(rawBody), 'evt_conflict')
    );

    expect(response.status).toBe(409);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('accepts the previous secret during a bounded rotation window', async () => {
    vi.stubEnv('RAZORPAY_WEBHOOK_SECRET_PREVIOUS', 'previous-secret');
    const rawBody = eventBody('subscription.pending');
    const signature = createHmac('sha256', 'previous-secret')
      .update(rawBody)
      .digest('hex');

    const response = await POST(buildRequest(rawBody, signature, 'evt_test'));

    expect(response.status).toBe(200);
    expect(mocks.record).toHaveBeenCalledWith(
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

function eventBody(
  event: string,
  accountId = 'acc_test',
  subscriptionId?: string
) {
  return JSON.stringify({
    event,
    account_id: accountId,
    payload: subscriptionId
      ? {
          subscription: { entity: { id: subscriptionId, status: 'cancelled' } },
        }
      : {},
  });
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
