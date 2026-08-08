import { createHmac } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

vi.mock('server-only', () => ({}));

const secret = 'acceptance-test-secret';

describe('Razorpay application webhook acceptance route', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('is hidden unless the test-only acceptance flags are exact', async () => {
    configureAcceptanceEnvironment('live');

    const response = await POST(buildRequest('{}', 'invalid'));

    expect(response.status).toBe(404);
  });

  it('rejects a payload with an invalid signature', async () => {
    configureAcceptanceEnvironment();

    const response = await POST(buildRequest('{}', 'invalid'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid signature',
    });
  });

  it('logs only a redacted observation for a signed payload', async () => {
    configureAcceptanceEnvironment();
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
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
    expect(info).toHaveBeenCalledOnce();
    const logged = String(info.mock.calls[0]?.[0]);
    expect(logged).toContain('razorpay_application_webhook_observation');
    expect(logged).toContain('payment_link.cancelled');
    expect(logged).not.toContain('9999999999');
  });
});

function configureAcceptanceEnvironment(mode = 'test') {
  vi.stubEnv('RAZORPAY_MODE', mode);
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
