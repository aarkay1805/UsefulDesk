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
import { ForbiddenError } from '@/lib/auth/account';

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

  it('forwards only an explicit Starter conversion acknowledgement', async () => {
    vi.stubEnv('USEFULDESK_SAAS_LIVE_QUOTES_ENABLED', 'true');
    expect(
      (await POST(request({ ...body, complimentaryConversionAccepted: true })))
        .status
    ).toBe(400);
    expect(
      (
        await POST(
          request({
            ...body,
            tier: 'starter',
            complimentaryConversionAccepted: false,
          })
        )
      ).status
    ).toBe(400);
    rpc.mockResolvedValueOnce({
      data: {
        request_id: requestId,
        organization_id: organizationId,
        approval_id: approvalId,
        tier: 'starter',
        amount_minor: 149947,
        currency: 'INR',
        expires_at: '2026-09-29T19:00:00Z',
      },
      error: null,
    });
    expect(
      (
        await POST(
          request({
            ...body,
            tier: 'starter',
            complimentaryConversionAccepted: true,
          })
        )
      ).status
    ).toBe(202);
    expect(rpc).toHaveBeenCalledWith(
      'subscription_create_live_quote',
      expect.objectContaining({ p_complimentary_conversion_accepted: true })
    );
  });
});

describe('Live renewal quote identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_MODE', 'live');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID', 'rzp_live_Usefulmade');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_SECRET', 'secret');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_LIVE_WEBHOOK_SECRET', 'secret');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID', 'acc_Usefulmade');
    vi.stubEnv('USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID', organizationId);
    vi.stubEnv('USEFULDESK_SAAS_LIVE_QUOTES_ENABLED', 'true');
    vi.stubEnv('USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED', 'true');
    requireSubscriptionOwner.mockResolvedValue({ userId: 'owner-1' });
  });
  afterEach(() => vi.unstubAllEnvs());
  const previous = '55555555-5555-4555-8555-555555555555';
  const renewal = {
    ...body,
    tier: 'starter',
    seenAmountMinor: 79900,
    renewalOfRequestId: previous,
  };
  it('binds the owner-reviewed predecessor to the dedicated renewal writer', async () => {
    rpc.mockResolvedValue({
      data: {
        request_id: requestId,
        organization_id: organizationId,
        approval_id: approvalId,
        tier: 'starter',
        amount_minor: 79900,
        currency: 'INR',
        expires_at: '2026-09-29T19:00:00Z',
        renewal_of_request_id: previous,
      },
      error: null,
    });
    expect((await POST(request(renewal))).status).toBe(202);
    expect(rpc).toHaveBeenCalledWith(
      'subscription_create_live_renewal_quote',
      expect.objectContaining({
        p_previous_request_id: previous,
        p_tier: 'starter',
        p_seen_amount_minor: 79900,
      })
    );
  });
  it.each([
    { ...renewal, tier: 'growth' },
    { ...renewal, renewalOfRequestId: null },
    { ...renewal, organizationId: previous },
  ])('rejects unsupported or cross-organization renewal %j', async (fields) => {
    expect((await POST(request(fields))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('keeps renewal closed with the quote switch off', async () => {
    vi.stubEnv('USEFULDESK_SAAS_LIVE_QUOTES_ENABLED', 'false');
    expect((await POST(request(renewal))).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('rejects a cross-site renewal before auth or writes', async () => {
    const crossSite = request(renewal);
    crossSite.headers.set('origin', 'https://other.example');
    crossSite.headers.set('sec-fetch-site', 'cross-site');
    expect((await POST(crossSite)).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('issues only the separately authorized customer Starter amount with original initiation off', async () => {
    const customer = '55555555-5555-4555-8555-555555555555';
    vi.stubEnv('USEFULDESK_SAAS_LIVE_QUOTES_ENABLED', 'false');
    vi.stubEnv('USEFULDESK_SAAS_LIVE_CUSTOMER_SCOPE_ENABLED', 'true');
    vi.stubEnv('USEFULDESK_SAAS_LIVE_CUSTOMER_CHECKOUT_ENABLED', 'true');
    rpc.mockResolvedValue({
      data: {
        request_id: requestId,
        organization_id: customer,
        approval_id: approvalId,
        tier: 'starter',
        amount_minor: 79900,
        currency: 'INR',
        expires_at: '2099-10-02T12:00:00Z',
      },
      error: null,
    });
    const fields = {
      ...body,
      organizationId: customer,
      tier: 'starter',
      seenAmountMinor: 79900,
    };
    expect((await POST(request(fields))).status).toBe(202);
    expect(requireSubscriptionOwner).toHaveBeenCalledWith(customer, accountId);
    for (const extra of [
      { tier: 'growth' },
      { seenAmountMinor: 79901 },
      { renewalOfRequestId: requestId },
      { complimentaryConversionAccepted: true },
      { organizationId },
    ]) {
      rpc.mockClear();
      expect((await POST(request({ ...fields, ...extra }))).status).toBe(400);
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it('refuses customer staff before SQL and respects closed or changed customer reviews', async () => {
    vi.stubEnv('USEFULDESK_SAAS_LIVE_QUOTES_ENABLED', 'false');
    vi.stubEnv('USEFULDESK_SAAS_LIVE_CUSTOMER_SCOPE_ENABLED', 'true');
    vi.stubEnv('USEFULDESK_SAAS_LIVE_CUSTOMER_CHECKOUT_ENABLED', 'true');
    const fields = {
      ...body,
      organizationId: '55555555-5555-4555-8555-555555555555',
      tier: 'starter',
      seenAmountMinor: 79900,
    };
    requireSubscriptionOwner.mockRejectedValueOnce(new ForbiddenError());
    expect((await POST(request(fields))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: null, error: { code: '55000' } });
    expect((await POST(request(fields))).status).toBe(409);
  });
});
