import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requireSubscriptionOwner, rpc } = vi.hoisted(() => ({
  requireSubscriptionOwner: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/subscriptions/owner', () => ({ requireSubscriptionOwner }));

import { POST } from './route';

const organizationId = '11111111-1111-4111-8111-111111111111';
const accountId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
function request() {
  return new Request('https://desk.example/api/subscriptions/advanced-quotes', {
    method: 'POST',
    headers: {
      origin: 'https://desk.example',
      'sec-fetch-site': 'same-origin',
    },
    body: JSON.stringify({ organizationId, accountId, requestId }),
  });
}

describe('advanced Test quote route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('USEFULDESK_SUBSCRIPTION_INTENTS_ENABLED', 'true');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_MODE', 'test');
    requireSubscriptionOwner.mockResolvedValue({
      userId: 'owner-1',
      supabase: { rpc },
    });
    rpc.mockResolvedValue({
      data: {
        organization_id: organizationId,
        request_id: requestId,
        kind: 'upgrade',
        tier: 'growth',
        amount_minor: 34789,
        currency: 'INR',
        state: 'pending',
        quote_expires_at: '2026-09-29T12:00:00Z',
        commercial_policy_version: 'approved-v1',
      },
      error: null,
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('is closed in Production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect((await POST(request())).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns only the frozen owner quote fields', async () => {
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      quote: {
        organizationId,
        requestId,
        kind: 'upgrade',
        tier: 'growth',
        amountMinor: 34789,
        currency: 'INR',
        expiresAt: '2026-09-29T12:00:00Z',
        policyVersion: 'approved-v1',
      },
    });
    expect(rpc).toHaveBeenCalledWith(
      'subscription_create_test_advanced_quote',
      {
        p_request_id: requestId,
      }
    );
  });

  it('keeps the commercial gate closed when SQL rejects the quote', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '55000' } });
    expect((await POST(request())).status).toBe(409);
  });
});
