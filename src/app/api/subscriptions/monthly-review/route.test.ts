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
import { POST as originalReview } from '../live-customer-review/route';
import { ForbiddenError } from '@/lib/auth/account';
import { monthlyCatalogOffer } from '@/lib/subscriptions/monthly-contract';
const organizationId = '11111111-1111-4111-8111-111111111111';
const accountId = '22222222-2222-4222-8222-222222222222';
const offerSetId = '33333333-3333-4333-8333-333333333333';
const offerId = '44444444-4444-4444-8444-444444444444';
const reviewId = '55555555-5555-4555-8555-555555555555';
const archiveId = '77777777-7777-4777-8777-777777777777';
const preview = {
  offerSetId,
  organizationId,
  billingAccountId: accountId,
  contractVersion: 'monthly_first_v1',
  catalogVersion: 'monthly_inr_2026_10_v1',
  sourceSnapshot: 'synthetic-snapshot',
  activeBranches: [
    { accountId, name: 'Billing' },
    { accountId: archiveId, name: 'Other' },
  ],
  selectedOfferId: null,
  choices: [
    {
      available: true,
      offerId,
      identity: monthlyCatalogOffer('growth'),
      taxNote: 'Reviewed',
      termsNote: 'Reviewed',
      refundNote: 'Reviewed',
      documentTreatment: 'usefulmade_unregistered_invoice_receipt_v1',
    },
  ],
  capabilitiesEnabled: true,
  openingEnabled: false,
};
const body = {
  organizationId,
  accountId,
  offerSetId,
  offerId,
  seenAmountMinor: 149900,
  termsAccepted: true,
};
function request(fields: unknown = body, origin = 'https://desk.example') {
  return new Request('https://desk.example/api/subscriptions/monthly-review', {
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
  ownerRpc.mockImplementation(async (name) =>
    name === 'subscription_monthly_offer_preview'
      ? { data: preview }
      : {
          data: {
            review_id: reviewId,
            organization_id: organizationId,
            billing_account_id: accountId,
            monthly_offer_id: offerId,
          },
        }
  );
  adminRpc.mockResolvedValue({
    data: {
      review_id: reviewId,
      organization_id: organizationId,
      checkout_open: true,
      monthly_offer_id: offerId,
    },
  });
});
afterEach(() => vi.unstubAllEnvs());
describe('monthly-review strict owner boundary', () => {
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
  it('saves approval under auth.uid before separately opening as actual owner', async () => {
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ reviewed: true, reviewId, offerId });
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(ownerRpc).toHaveBeenCalledWith(
      'subscription_approve_monthly_review',
      {
        p_offer_set_id: offerSetId,
        p_offer_id: offerId,
        p_seen_amount_minor: 149900,
        p_terms_accepted: true,
      }
    );
    expect(adminRpc).toHaveBeenCalledWith(
      'subscription_open_reviewed_customer_scope',
      {
        p_review_id: reviewId,
        p_organization_id: organizationId,
        p_actor_user_id: 'actual-owner',
      }
    );
    expect(ownerRpc.mock.invocationCallOrder.at(-1)).toBeLessThan(
      adminRpc.mock.invocationCallOrder[0]
    );
  });
  it.each([
    { termsAccepted: false },
    { seenAmountMinor: 0 },
    { seenAmountMinor: 149901 },
  ])('rejects changed payable review %j', async (extra) => {
    expect([400, 409]).toContain(
      (await POST(request({ ...body, ...extra }))).status
    );
    expect(adminRpc).not.toHaveBeenCalled();
    expect(
      ownerRpc.mock.calls.some(
        ([name]) => name === 'subscription_approve_monthly_review'
      )
    ).toBe(false);
  });
  it.each(['55000', '22023', '23505', '40001', '42501'])(
    'maps rejected review %s without opening',
    async (code) => {
      ownerRpc.mockImplementation(async (name) =>
        name === 'subscription_monthly_offer_preview'
          ? { data: preview }
          : { error: { code, message: 'Synthetic internal detail' } }
      );
      expect((await POST(request())).status).toBe(code === '42501' ? 403 : 409);
      expect(adminRpc).not.toHaveBeenCalled();
    }
  );
  it.each([
    { organization_id: archiveId },
    { billing_account_id: archiveId },
    { monthly_offer_id: archiveId },
    { review_id: 'bad' },
  ])('does not open mismatched committed review %j', async (extra) => {
    ownerRpc.mockImplementation(async (name) =>
      name === 'subscription_monthly_offer_preview'
        ? { data: preview }
        : {
            data: {
              review_id: reviewId,
              organization_id: organizationId,
              billing_account_id: accountId,
              monthly_offer_id: offerId,
              ...extra,
            },
          }
    );
    expect((await POST(request())).status).toBe(500);
    expect(adminRpc).not.toHaveBeenCalled();
  });
  it.each([
    { error: { code: '55000' } },
    { error: { code: 'XX000', message: 'private SQL detail' } },
    {
      data: {
        review_id: reviewId,
        organization_id: organizationId,
        checkout_open: true,
        monthly_offer_id: archiveId,
      },
    },
  ])(
    'truthfully reports saved review when opening fails %j',
    async (output) => {
      adminRpc.mockResolvedValue(output);
      const result = await POST(request());
      expect(result.status).toBe(409);
      expect(await result.json()).toEqual({
        error: 'Your review was saved. Contact support to open payment.',
      });
    }
  );
  it('truthfully reports saved review on thrown opening failure', async () => {
    adminRpc.mockRejectedValue(new Error('network internal'));
    expect(await (await POST(request())).json()).toEqual({
      error: 'Your review was saved. Contact support to open payment.',
    });
  });
  it.each([
    { offerSetId: archiveId },
    { organizationId: archiveId },
    { billingAccountId: archiveId },
    { choices: [] },
    { choices: [{ available: false, tier: 'growth', reason: 'Expired' }] },
    { capabilitiesEnabled: false },
  ])(
    'prevents writes on stale/foreign/unready prepared facts %j',
    async (extra) => {
      ownerRpc.mockResolvedValue({ data: { ...preview, ...extra } });
      expect((await POST(request())).status).toBe(409);
      expect(ownerRpc).toHaveBeenCalledTimes(1);
      expect(adminRpc).not.toHaveBeenCalled();
    }
  );
  it('refuses a second owner who did not author the review', async () => {
    requireSubscriptionOwner.mockResolvedValue({
      userId: 'second-actual-owner',
      supabase: { rpc: ownerRpc },
    });
    ownerRpc.mockImplementation(async (name) =>
      name === 'subscription_monthly_offer_preview'
        ? { data: preview }
        : { error: { code: '42501' } }
    );
    expect((await POST(request())).status).toBe(403);
    expect(adminRpc).not.toHaveBeenCalled();
  });
});

it('binds the offer set before approving for an owner of two gyms', async () => {
  ownerRpc.mockResolvedValue({
    data: {
      ...preview,
      organizationId: archiveId,
      billingAccountId: archiveId,
    },
  });
  expect((await POST(request())).status).toBe(409);
  expect(
    ownerRpc.mock.calls.some(
      ([name]) => name === 'subscription_approve_monthly_review'
    )
  ).toBe(false);
});
it('preserves original Starter review when monthly initiation is closed', async () => {
  vi.stubEnv('USEFULDESK_SAAS_LIVE_MONTHLY_CHECKOUT_ENABLED', 'false');
  ownerRpc.mockResolvedValue({
    data: {
      review_id: reviewId,
      organization_id: organizationId,
      billing_account_id: accountId,
    },
  });
  adminRpc.mockResolvedValue({
    data: {
      review_id: reviewId,
      organization_id: organizationId,
      checkout_open: true,
    },
  });
  expect(
    (
      await originalReview(
        request({
          organizationId,
          accountId,
          preparationId: reviewId,
          seenAmountMinor: 79900,
          termsAccepted: true,
        })
      )
    ).status
  ).toBe(200);
  expect((await POST(request())).status).toBe(404);
});
it('allows retry of the same selected saved review while opening stays separately closed', async () => {
  ownerRpc.mockImplementation(async (name) =>
    name === 'subscription_monthly_offer_preview'
      ? {
          data: { ...preview, selectedOfferId: offerId, openingEnabled: false },
        }
      : {
          data: {
            review_id: reviewId,
            organization_id: organizationId,
            billing_account_id: accountId,
            monthly_offer_id: offerId,
          },
        }
  );
  expect((await POST(request())).status).toBe(200);
});
it('refuses replacing an already-selected offer', async () => {
  ownerRpc.mockResolvedValue({
    data: { ...preview, selectedOfferId: archiveId },
  });
  expect((await POST(request())).status).toBe(409);
  expect(ownerRpc).toHaveBeenCalledTimes(1);
});
it('contains review before approval if initiation closes during preview', async () => {
  ownerRpc.mockImplementation(async () => {
    vi.stubEnv('USEFULDESK_SAAS_LIVE_MONTHLY_CHECKOUT_ENABLED', 'false');
    return { data: preview };
  });
  expect((await POST(request())).status).toBe(409);
  expect(ownerRpc).toHaveBeenCalledTimes(1);
  expect(adminRpc).not.toHaveBeenCalled();
});
it('reports saved review if containment closes after approval', async () => {
  ownerRpc.mockImplementation(async (name) => {
    if (name === 'subscription_monthly_offer_preview') return { data: preview };
    vi.stubEnv('USEFULDESK_SAAS_LIVE_MONTHLY_CHECKOUT_ENABLED', 'false');
    return {
      data: {
        review_id: reviewId,
        organization_id: organizationId,
        billing_account_id: accountId,
        monthly_offer_id: offerId,
      },
    };
  });
  expect(await (await POST(request())).json()).toEqual({
    error: 'Your review was saved. Contact support to open payment.',
  });
  expect(adminRpc).not.toHaveBeenCalled();
});
