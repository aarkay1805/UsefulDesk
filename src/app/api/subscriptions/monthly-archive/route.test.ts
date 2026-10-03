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
import { ForbiddenError } from '@/lib/auth/account';
import { monthlyCatalogOffer } from '@/lib/subscriptions/monthly-contract';
const organizationId = '11111111-1111-4111-8111-111111111111';
const accountId = '22222222-2222-4222-8222-222222222222';
const offerSetId = '33333333-3333-4333-8333-333333333333';
const offerId = '44444444-4444-4444-8444-444444444444';
const requestId = '66666666-6666-4666-8666-666666666666';
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
const body = { organizationId, accountId, offerSetId, accountIds: [archiveId] };
function request(fields: unknown = body, origin = 'https://desk.example') {
  return new Request('https://desk.example/api/subscriptions/monthly-archive', {
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
            archived_account_ids: [archiveId],
            requires_new_preparation: true,
          },
        }
  );
});
afterEach(() => vi.unstubAllEnvs());
describe('monthly-archive strict owner boundary', () => {
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
  it('archives exact confirmed IDs and maps private result to public count', async () => {
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(await result.json()).toEqual({
      result: { archived_count: 1, preparation_stale: true },
    });
    expect(ownerRpc).toHaveBeenCalledWith(
      'subscription_archive_monthly_branches',
      { p_offer_set_id: offerSetId, p_account_ids: [archiveId] }
    );
    expect(adminRpc).not.toHaveBeenCalled();
  });
  it.each([
    { accountIds: [] },
    { accountIds: [archiveId, archiveId] },
    { accountIds: [accountId] },
    { accountIds: ['bad'] },
  ])(
    'rejects duplicate/billing/invalid archive IDs %j',
    async ({ accountIds }) => {
      expect((await POST(request({ ...body, accountIds }))).status).toBe(400);
      expect(ownerRpc).not.toHaveBeenCalled();
    }
  );
  it('refuses foreign roster IDs before archive', async () => {
    expect(
      (await POST(request({ ...body, accountIds: [requestId] }))).status
    ).toBe(409);
    expect(ownerRpc).toHaveBeenCalledTimes(1);
  });
  it.each([
    { offerSetId: requestId },
    { organizationId: requestId },
    { billingAccountId: requestId },
    { selectedOfferId: offerId },
    { capabilitiesEnabled: false },
  ])('refuses stale/foreign/selected preparation %j', async (extra) => {
    ownerRpc.mockResolvedValue({ data: { ...preview, ...extra } });
    expect((await POST(request())).status).toBe(409);
    expect(ownerRpc).toHaveBeenCalledTimes(1);
  });
  it.each(['55000', '22023', '40001', '42501'])(
    'maps database archive rejection %s',
    async (code) => {
      ownerRpc.mockImplementation(async (name) =>
        name === 'subscription_monthly_offer_preview'
          ? { data: preview }
          : { error: { code, message: 'Synthetic internal detail' } }
      );
      expect((await POST(request())).status).toBe(code === '42501' ? 403 : 409);
    }
  );
  it.each([
    { archived_account_ids: [requestId] },
    { archived_account_ids: [archiveId, archiveId] },
    { archived_account_ids: [] },
    { requires_new_preparation: false },
    { archived_count: 1, preparation_stale: true },
  ])('rejects mismatched archive result %j', async (extra) => {
    ownerRpc.mockImplementation(async (name) =>
      name === 'subscription_monthly_offer_preview'
        ? { data: preview }
        : { data: extra }
    );
    expect((await POST(request())).status).toBe(500);
  });
});

it('binds the offer set before archiving for an owner of two gyms', async () => {
  ownerRpc.mockResolvedValue({
    data: {
      ...preview,
      organizationId: requestId,
      billingAccountId: requestId,
    },
  });
  expect((await POST(request())).status).toBe(409);
  expect(
    ownerRpc.mock.calls.some(
      ([name]) => name === 'subscription_archive_monthly_branches'
    )
  ).toBe(false);
});
it('preserves one branch and accepts a reordered exact archived set', async () => {
  const branches = [
    ...preview.activeBranches,
    { accountId: requestId, name: 'Third' },
  ];
  ownerRpc.mockImplementation(async (name) =>
    name === 'subscription_monthly_offer_preview'
      ? { data: { ...preview, activeBranches: branches } }
      : {
          data: {
            archived_account_ids: [requestId, archiveId],
            requires_new_preparation: true,
          },
        }
  );
  expect(
    await (
      await POST(request({ ...body, accountIds: [archiveId, requestId] }))
    ).json()
  ).toEqual({ result: { archived_count: 2, preparation_stale: true } });
});
it('contains archive before its mutation if initiation closes during preview', async () => {
  ownerRpc.mockImplementation(async () => {
    vi.stubEnv('USEFULDESK_SAAS_LIVE_MONTHLY_CHECKOUT_ENABLED', 'false');
    return { data: preview };
  });
  expect((await POST(request())).status).toBe(409);
  expect(ownerRpc).toHaveBeenCalledTimes(1);
});
it('allows five explicit archives from an existing six-branch roster', async () => {
  const ids = [
    archiveId,
    requestId,
    offerSetId,
    offerId,
    '88888888-8888-4888-8888-888888888888',
  ];
  ownerRpc.mockImplementation(async (name) =>
    name === 'subscription_monthly_offer_preview'
      ? {
          data: {
            ...preview,
            activeBranches: [
              { accountId, name: 'Billing' },
              ...ids.map((accountId) => ({
                accountId,
                name: 'Existing branch',
              })),
            ],
          },
        }
      : { data: { archived_account_ids: ids, requires_new_preparation: true } }
  );
  const result = await POST(request({ ...body, accountIds: ids }));
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({
    result: { archived_count: 5, preparation_stale: true },
  });
});
