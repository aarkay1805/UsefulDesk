import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  saveSecret: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ serviceRole: true }),
}));
vi.mock('@/lib/auth/account', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/auth/account')>();
  return {
    ...actual,
    requirePaymentGatewayAccess: mocks.requireAccess,
  };
});
vi.mock('@/lib/payments/credentials', () => ({
  saveRazorpayLegacyWebhookSecret: mocks.saveSecret,
}));

import { POST } from './route';

describe('Razorpay legacy webhook secret acceptance route', () => {
  beforeEach(() => {
    vi.stubEnv('RAZORPAY_MODE', 'test');
    vi.stubEnv('RAZORPAY_PROVIDER_ACCEPTANCE_ONLY', 'true');
    mocks.requireAccess.mockResolvedValue({ accountId: 'account-id' });
    mocks.saveSecret.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('stores only the scoped account secret without returning it', async () => {
    const response = await POST(buildRequest('test-webhook-secret-123'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.saveSecret).toHaveBeenCalledWith(
      { serviceRole: true },
      'account-id',
      'test-webhook-secret-123'
    );
  });

  it('is unavailable outside the isolated acceptance deployment', async () => {
    vi.stubEnv('RAZORPAY_PROVIDER_ACCEPTANCE_ONLY', 'false');

    const response = await POST(buildRequest('test-webhook-secret-123'));

    expect(response.status).toBe(404);
    expect(mocks.requireAccess).not.toHaveBeenCalled();
    expect(mocks.saveSecret).not.toHaveBeenCalled();
  });

  it('rejects short secrets before storage', async () => {
    const response = await POST(buildRequest('too-short'));

    expect(response.status).toBe(400);
    expect(mocks.saveSecret).not.toHaveBeenCalled();
  });
});

function buildRequest(webhookSecret: string) {
  return new Request(
    'https://usefuldesk-razorpay-test.vercel.app/api/payments/razorpay/webhook/legacy-secret',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://usefuldesk-razorpay-test.vercel.app',
        'sec-fetch-site': 'same-origin',
      },
      body: JSON.stringify({ webhookSecret }),
    }
  );
}
