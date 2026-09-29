import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requireSubscriptionOwner, rpc } = vi.hoisted(() => ({
  requireSubscriptionOwner: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/subscriptions/owner', () => ({ requireSubscriptionOwner }));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ rpc }),
}));
import { POST } from './route';

const organizationId = '11111111-1111-4111-8111-111111111111';
const accountId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const approvalId = '44444444-4444-4444-8444-444444444444';
const body = {
  organizationId,
  accountId,
  requestId,
  approvalId,
  tier: 'growth',
  seenAmountMinor: 149947,
};

function request(fields: Record<string, unknown> = body) {
  return new Request('https://desk.example/api/subscriptions/live-quotes', {
    method: 'POST',
    headers: {
      origin: 'https://desk.example',
      'sec-fetch-site': 'same-origin',
    },
    body: JSON.stringify(fields),
  });
}

describe('Usefulmade Live quote issuance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_MODE', 'live');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID', 'rzp_live_Usefulmade');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_SECRET', 'key-secret');
    vi.stubEnv(
      'USEFULDESK_SAAS_RAZORPAY_LIVE_WEBHOOK_SECRET',
      'webhook-secret'
    );
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID', 'acc_Usefulmade');
    vi.stubEnv('USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID', organizationId);
    vi.stubEnv('USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED', 'true');
    requireSubscriptionOwner.mockResolvedValue({ userId: 'owner-1' });
    rpc.mockResolvedValue({
      data: {
        request_id: requestId,
        organization_id: organizationId,
        approval_id: approvalId,
        tier: 'growth',
        amount_minor: 149947,
        currency: 'INR',
        expires_at: '2026-09-29T19:00:00Z',
      },
      error: null,
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('does not touch auth or database while quote issuance is off', async () => {
    expect((await POST(request())).status).toBe(404);
    expect(requireSubscriptionOwner).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('binds only the amount and approval the owner saw', async () => {
    vi.stubEnv('USEFULDESK_SAAS_LIVE_QUOTES_ENABLED', 'true');
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect((await response.json()).quote.amount_minor).toBe(149947);
    expect(rpc).toHaveBeenCalledWith('subscription_create_live_quote', {
      p_request_id: requestId,
      p_organization_id: organizationId,
      p_billing_account_id: accountId,
      p_actor_user_id: 'owner-1',
      p_approval_id: approvalId,
      p_seen_amount_minor: 149947,
      p_tier: 'growth',
      p_provider_merchant_id: 'acc_Usefulmade',
    });
  });

  it('rejects a changed approved amount without issuing a quote', async () => {
    vi.stubEnv('USEFULDESK_SAAS_LIVE_QUOTES_ENABLED', 'true');
    rpc.mockResolvedValueOnce({ data: null, error: { code: '55000' } });
    expect((await POST(request())).status).toBe(409);
  });
});
