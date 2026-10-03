import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { requireSubscriptionOwner, ownerRpc, adminRpc, checkRateLimit } =
  vi.hoisted(() => ({
    requireSubscriptionOwner: vi.fn(),
    ownerRpc: vi.fn(),
    adminRpc: vi.fn(),
    checkRateLimit: vi.fn(),
  }));
vi.mock('@/lib/subscriptions/owner', () => ({ requireSubscriptionOwner }));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ rpc: adminRpc }),
}));
vi.mock('@/lib/rate-limit', async (original) => ({
  ...(await original<typeof import('@/lib/rate-limit')>()),
  checkRateLimit,
}));
import { POST } from './route';
import { POST as originalQuotes } from '../live-quotes/route';
import { ForbiddenError } from '@/lib/auth/account';
import { monthlyCatalogOffer } from '@/lib/subscriptions/monthly-contract';
const organizationId = '11111111-1111-4111-8111-111111111111';
const accountId = '22222222-2222-4222-8222-222222222222';
const offerSetId = '33333333-3333-4333-8333-333333333333';
const offerId = '44444444-4444-4444-8444-444444444444';
const reviewId = '55555555-5555-4555-8555-555555555555';
const requestId = '66666666-6666-4666-8666-666666666666';
const archiveId = '77777777-7777-4777-8777-777777777777';
const quote = {
  request_id: requestId,
  organization_id: organizationId,
  approval_id: offerSetId,
  monthly_offer_id: offerId,
  offer_contract_version: 'monthly_first_v1',
  catalog_version: 'monthly_inr_2026_10_v1',
  tier: 'growth',
  amount_minor: 149900,
  currency: 'INR',
  included_branches: 1,
  paid_extra_branch_slots: 0,
  expires_at: '2099-10-03T12:00:00Z',
};
const body = {
  organizationId,
  accountId,
  requestId,
  reviewId,
  offerId,
  seenAmountMinor: 149900,
};
function request(fields: unknown = body, origin = 'https://desk.example') {
  return new Request('https://desk.example/api/subscriptions/monthly-quotes', {
    method: 'POST',
    headers: { origin },
    body: JSON.stringify(fields),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  for (const [key, value] of Object.entries({
    NODE_ENV: 'production',
    VERCEL_ENV: 'production',
    USEFULDESK_SAAS_RAZORPAY_MODE: 'live',
    USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID: 'rzp_live_Synthetic',
    USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_SECRET: 'synthetic-secret',
    USEFULDESK_SAAS_RAZORPAY_LIVE_WEBHOOK_SECRET: 'synthetic-hook',
    USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID: 'acc_Synthetic',
    USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID:
      '99999999-9999-4999-8999-999999999999',
    USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED: 'true',
    USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED: 'true',
    USEFULDESK_SAAS_LIVE_CUSTOMER_SCOPE_ENABLED: 'true',
    USEFULDESK_SAAS_LIVE_CUSTOMER_CHECKOUT_ENABLED: 'true',
    USEFULDESK_SAAS_LIVE_MONTHLY_CHECKOUT_ENABLED: 'true',
  }))
    vi.stubEnv(key, value);
  requireSubscriptionOwner.mockResolvedValue({
    userId: 'actual-owner',
    supabase: { rpc: ownerRpc },
  });
  checkRateLimit.mockReturnValue({ success: true });
  adminRpc.mockResolvedValue({ data: quote });
});
afterEach(() => vi.unstubAllEnvs());
describe('monthly-quotes strict owner boundary', () => {
  it.each([
    'USEFULDESK_SAAS_LIVE_MONTHLY_CHECKOUT_ENABLED',
    'USEFULDESK_SAAS_LIVE_CUSTOMER_CHECKOUT_ENABLED',
    'USEFULDESK_SAAS_LIVE_CUSTOMER_SCOPE_ENABLED',
    'USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED',
    'USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED',
  ])('closes %s before auth or writes', async (flag) => {
    vi.stubEnv(flag, 'false');
    const result = await POST(request());
    expect(result.status).toBe(404);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(requireSubscriptionOwner).not.toHaveBeenCalled();
    expect(ownerRpc).not.toHaveBeenCalled();
    expect(adminRpc).not.toHaveBeenCalled();
  });
  it.each([
    { VERCEL_ENV: 'preview' },
    { USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_SECRET: '' },
    { USEFULDESK_SAAS_RAZORPAY_TEST_KEY_ID: 'rzp_test_Synthetic' },
  ])('fails closed for config %j', async (env) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    expect((await POST(request())).status).toBe(404);
    expect(requireSubscriptionOwner).not.toHaveBeenCalled();
  });
  it('checks origin before owner identity', async () => {
    expect((await POST(request(body, 'https://foreign.example'))).status).toBe(
      403
    );
    expect(requireSubscriptionOwner).not.toHaveBeenCalled();
  });
  it.each([
    null,
    [],
    true,
    3,
    {},
    { ...body, actorUserId: 'supplied' },
    { ...body, merchantId: 'acc_Foreign' },
    { ...body, tier: 'ultimate' },
    { ...body, paidExtraBranchSlots: 1 },
    { ...body, organizationId: 'bad' },
  ])('rejects malformed or caller authority %j', async (fields) => {
    expect((await POST(request(fields))).status).toBe(400);
    expect(ownerRpc).not.toHaveBeenCalled();
    expect(adminRpc).not.toHaveBeenCalled();
  });
  it('rejects invalid JSON', async () => {
    const req = request();
    const bad = new Request(req.url, {
      method: 'POST',
      headers: req.headers,
      body: '{',
    });
    expect((await POST(bad)).status).toBe(400);
    expect(ownerRpc).not.toHaveBeenCalled();
  });
  it('refuses staff and tenant mismatch before RPCs', async () => {
    requireSubscriptionOwner.mockRejectedValue(
      new ForbiddenError('Only the gym owner can choose a plan')
    );
    expect((await POST(request())).status).toBe(403);
    expect(requireSubscriptionOwner).toHaveBeenCalledWith(
      organizationId,
      accountId
    );
    expect(ownerRpc).not.toHaveBeenCalled();
    expect(adminRpc).not.toHaveBeenCalled();
  });
  it('rate limits before database writes', async () => {
    checkRateLimit.mockReturnValue({
      success: false,
      reset: Date.now() + 60000,
      remaining: 0,
      limit: 30,
    });
    const result = await POST(request());
    expect(result.status).toBe(429);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(ownerRpc).not.toHaveBeenCalled();
    expect(adminRpc).not.toHaveBeenCalled();
  });
  it.each(['starter', 'growth', 'ultimate'] as const)(
    'validates frozen %s identity with no caller tier',
    async (tier) => {
      const identity = monthlyCatalogOffer(tier);
      adminRpc.mockResolvedValue({
        data: {
          ...quote,
          tier,
          amount_minor: identity.amountMinor,
          included_branches: identity.includedBranches,
        },
      });
      const result = await POST(
        request({ ...body, seenAmountMinor: identity.amountMinor })
      );
      expect(result.status).toBe(202);
      expect(result.headers.get('Cache-Control')).toBe('no-store');
      expect((await result.json()).quote.monthly_offer_id).toBe(offerId);
      expect(adminRpc).toHaveBeenCalledWith(
        'subscription_create_monthly_quote',
        {
          p_request_id: requestId,
          p_organization_id: organizationId,
          p_billing_account_id: accountId,
          p_actor_user_id: 'actual-owner',
          p_review_id: reviewId,
          p_offer_id: offerId,
          p_seen_amount_minor: identity.amountMinor,
          p_provider_merchant_id: 'acc_Synthetic',
        }
      );
    }
  );
  it.each(['55000', '22023', '23505', '40001', '42501'])(
    'maps stale/closed/author mismatch %s',
    async (code) => {
      adminRpc.mockResolvedValue({
        error: { code, message: 'Synthetic internal detail' },
      });
      const result = await POST(request());
      expect(result.status).toBe(code === '42501' ? 403 : 409);
      expect((await result.json()).error).not.toContain('Synthetic');
    }
  );
  it.each([
    { monthly_offer_id: archiveId },
    { offer_contract_version: 'starter_v1' },
    { catalog_version: null },
    { tier: 'ultimate' },
    { included_branches: 5 },
    { paid_extra_branch_slots: 1 },
    { amount_minor: 149901 },
    { request_id: archiveId },
    { organization_id: archiveId },
    { approval_id: 'bad' },
    { currency: 'USD' },
    { expires_at: 'bad' },
    { expires_at: '2000-01-01T00:00:00Z' },
  ])('withholds mismatched or expired SQL output %j', async (extra) => {
    adminRpc.mockResolvedValue({ data: { ...quote, ...extra } });
    expect((await POST(request())).status).toBe(500);
  });
  it('uses the second actual owner identity and refuses review takeover', async () => {
    requireSubscriptionOwner.mockResolvedValue({
      userId: 'second-actual-owner',
    });
    adminRpc.mockResolvedValue({ error: { code: '55000' } });
    expect((await POST(request())).status).toBe(409);
    expect(adminRpc).toHaveBeenCalledWith(
      'subscription_create_monthly_quote',
      expect.objectContaining({ p_actor_user_id: 'second-actual-owner' })
    );
  });
  it('contains a delayed quote when initiation closes', async () => {
    adminRpc.mockImplementation(async () => {
      vi.stubEnv('USEFULDESK_SAAS_LIVE_MONTHLY_CHECKOUT_ENABLED', 'false');
      return { data: quote };
    });
    expect((await POST(request())).status).toBe(409);
  });
});

it('preserves original Starter quote with its unchanged input while monthly is closed', async () => {
  vi.stubEnv('USEFULDESK_SAAS_LIVE_MONTHLY_CHECKOUT_ENABLED', 'false');
  adminRpc.mockResolvedValue({
    data: {
      request_id: requestId,
      organization_id: organizationId,
      approval_id: offerSetId,
      tier: 'starter',
      amount_minor: 79900,
      currency: 'INR',
      expires_at: quote.expires_at,
    },
  });
  expect(
    (
      await originalQuotes(
        request({
          organizationId,
          accountId,
          requestId,
          approvalId: offerSetId,
          tier: 'starter',
          seenAmountMinor: 79900,
        })
      )
    ).status
  ).toBe(202);
  expect((await POST(request())).status).toBe(404);
});
it('refuses noncatalog client amount through SQL without changing its authority', async () => {
  adminRpc.mockResolvedValue({ error: { code: '55000' } });
  expect(
    (await POST(request({ ...body, seenAmountMinor: 149901 }))).status
  ).toBe(409);
  expect(adminRpc).toHaveBeenCalledWith(
    'subscription_create_monthly_quote',
    expect.objectContaining({ p_seen_amount_minor: 149901 })
  );
});
