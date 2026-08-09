import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  rpc: vi.fn(),
  getConnection: vi.fn(),
  runOperation: vi.fn(),
  cancelSubscription: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/account', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/auth/account')>();
  return { ...actual, requirePaymentGatewayAccess: mocks.requireAccess };
});
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ rpc: mocks.rpc }),
}));
vi.mock('@/lib/payments/credentials', () => ({
  getRazorpayConnection: mocks.getConnection,
  runRazorpayOperation: mocks.runOperation,
}));
vi.mock('@/lib/payments/razorpay', () => ({
  cancelSubscription: mocks.cancelSubscription,
}));

import { POST } from './route';

describe('Razorpay provider retry acceptance route', () => {
  beforeEach(() => {
    vi.stubEnv('RAZORPAY_MODE', 'test');
    vi.stubEnv('RAZORPAY_PROVIDER_ACCEPTANCE_ONLY', 'true');
    mocks.requireAccess.mockResolvedValue({
      accountId: 'account-id',
      userId: 'user-id',
      role: 'owner',
    });
    mocks.rpc.mockResolvedValue({
      data: {
        acceptance_id: '13bd1e30-9a5a-4b59-9491-f8f740d32dc1',
      },
      error: null,
    });
    mocks.getConnection.mockResolvedValue({
      accountId: 'account-id',
      authenticationMode: 'oauth',
      authentication: { mode: 'oauth', accessToken: 'test-token' },
    });
    mocks.runOperation.mockImplementation(
      async (_admin, connection, operation) =>
        operation(connection.authentication)
    );
    mocks.cancelSubscription.mockResolvedValue({ id: 'sub_test123' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('arms one exact cancellation for ten minutes', async () => {
    const response = await POST(
      buildRequest({ action: 'arm', subscriptionId: 'sub_test123' })
    );

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'arm_razorpay_webhook_retry_acceptance',
      {
        p_account_id: 'account-id',
        p_provider_mode: 'test',
        p_expected_event_type: 'subscription.cancelled',
        p_expected_subscription_id: 'sub_test123',
        p_armed_by: 'user-id',
        p_ttl_seconds: 600,
      }
    );
  });

  it('cancels an unfinished account-scoped exercise', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const acceptanceId = '13bd1e30-9a5a-4b59-9491-f8f740d32dc1';

    const response = await POST(
      buildRequest({ action: 'cancel', acceptanceId })
    );

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'cancel_razorpay_webhook_retry_acceptance',
      {
        p_acceptance_id: acceptanceId,
        p_account_id: 'account-id',
        p_cancelled_by: 'user-id',
      }
    );
  });

  it('audits and triggers provider cancellation for the exact armed subscription', async () => {
    const acceptanceId = '13bd1e30-9a5a-4b59-9491-f8f740d32dc1';
    mocks.rpc.mockResolvedValue({
      data: {
        acceptance_id: acceptanceId,
        subscription_id: 'sub_test123',
      },
      error: null,
    });

    const response = await POST(
      buildRequest({ action: 'trigger', acceptanceId })
    );

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'trigger_razorpay_webhook_retry_acceptance',
      {
        p_acceptance_id: acceptanceId,
        p_account_id: 'account-id',
        p_triggered_by: 'user-id',
      }
    );
    expect(mocks.cancelSubscription).toHaveBeenCalledWith(
      { mode: 'oauth', accessToken: 'test-token' },
      'sub_test123',
      false
    );
  });

  it('stays hidden outside isolated Test acceptance', async () => {
    vi.stubEnv('RAZORPAY_PROVIDER_ACCEPTANCE_ONLY', 'false');

    const response = await POST(
      buildRequest({ action: 'arm', subscriptionId: 'sub_test123' })
    );

    expect(response.status).toBe(404);
    expect(mocks.requireAccess).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects cross-origin requests before authentication', async () => {
    const request = buildRequest({
      action: 'arm',
      subscriptionId: 'sub_test123',
    });
    request.headers.set('origin', 'https://attacker.test');

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(mocks.requireAccess).not.toHaveBeenCalled();
  });

  it('rejects a malformed subscription id without an RPC call', async () => {
    const response = await POST(
      buildRequest({ action: 'arm', subscriptionId: 'not-a-subscription' })
    );

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

function buildRequest(body: Record<string, unknown>) {
  return new Request(
    'https://example.test/api/payments/razorpay/webhook/retry-acceptance',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://example.test',
        'sec-fetch-site': 'same-origin',
      },
      body: JSON.stringify(body),
    }
  );
}
