import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { requireSubscriptionOwner, ownerRpc, adminRpc } = vi.hoisted(() => ({
  requireSubscriptionOwner: vi.fn(),
  ownerRpc: vi.fn(),
  adminRpc: vi.fn(),
}));
vi.mock('@/lib/subscriptions/owner', () => ({ requireSubscriptionOwner }));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ rpc: adminRpc }),
}));
import { POST } from './route';
const organizationId = 'f1000000-0000-4000-8000-000000000001';
const accountId = 'f2000000-0000-4000-8000-000000000001';
const preparationId = 'f4000000-0000-4000-8000-000000000001';
const body = {
  organizationId,
  accountId,
  preparationId,
  seenAmountMinor: 79900,
  termsAccepted: true,
};
const request = (
  fields: Record<string, unknown> = body,
  origin = 'https://desk.example'
) =>
  new Request('https://desk.example/api/subscriptions/live-customer-review', {
    method: 'POST',
    headers: { origin },
    body: JSON.stringify(fields),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_MODE', 'live');
  vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID', 'rzp_live_Synthetic');
  vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_SECRET', 'synthetic-secret');
  vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_LIVE_WEBHOOK_SECRET', 'synthetic-hook');
  vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID', 'acc_TCJwBqanN9LTrK');
  vi.stubEnv(
    'USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID',
    '8826d9aa-03f2-4ad7-ae91-0553052131f8'
  );
  vi.stubEnv('USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED', 'true');
  vi.stubEnv('USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED', 'true');
  vi.stubEnv('USEFULDESK_SAAS_LIVE_CUSTOMER_SCOPE_ENABLED', 'true');
  vi.stubEnv('USEFULDESK_SAAS_LIVE_CUSTOMER_CHECKOUT_ENABLED', 'true');
  requireSubscriptionOwner.mockResolvedValue({
    userId: 'actual-owner',
    supabase: { rpc: ownerRpc },
  });
  ownerRpc.mockResolvedValue({
    data: {
      review_id: preparationId,
      organization_id: organizationId,
      billing_account_id: accountId,
    },
    error: null,
  });
  adminRpc.mockResolvedValue({
    data: {
      review_id: preparationId,
      organization_id: organizationId,
      checkout_open: true,
    },
    error: null,
  });
});
afterEach(() => vi.unstubAllEnvs());
describe('genuine customer owner review', () => {
  it('keeps closed and Preview requests out of auth and database', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect((await POST(request())).status).toBe(404);
    expect(requireSubscriptionOwner).not.toHaveBeenCalled();
  });
  it.each([
    { ...body, termsAccepted: false },
    { ...body, seenAmountMinor: 79901 },
    { ...body, actorUserId: 'impersonated' },
  ])('refuses absent consent or changed terms %j', async (fields) => {
    expect((await POST(request(fields))).status).toBe(400);
    expect(ownerRpc).not.toHaveBeenCalled();
    expect(adminRpc).not.toHaveBeenCalled();
  });
  it('rejects foreign origin before touching owner authority', async () => {
    expect((await POST(request(body, 'https://foreign.example'))).status).toBe(
      403
    );
    expect(requireSubscriptionOwner).not.toHaveBeenCalled();
  });
  it('commits the actual authenticated review before separately opening exact authority', async () => {
    expect((await POST(request())).status).toBe(200);
    expect(ownerRpc).toHaveBeenCalledWith(
      'subscription_approve_customer_review',
      {
        p_preparation_id: preparationId,
        p_seen_amount_minor: 79900,
        p_terms_accepted: true,
      }
    );
    expect(adminRpc).toHaveBeenCalledWith(
      'subscription_open_reviewed_customer_scope',
      {
        p_review_id: preparationId,
        p_organization_id: organizationId,
        p_actor_user_id: 'actual-owner',
      }
    );
    expect(ownerRpc.mock.invocationCallOrder[0]).toBeLessThan(
      adminRpc.mock.invocationCallOrder[0]
    );
  });
  it('never opens a mismatched owner result', async () => {
    ownerRpc.mockResolvedValue({
      data: {
        review_id: preparationId,
        organization_id: organizationId,
        billing_account_id: organizationId,
      },
    });
    expect((await POST(request())).status).toBe(500);
    expect(adminRpc).not.toHaveBeenCalled();
  });
  it('preserves a saved closed review if opening is contained', async () => {
    adminRpc.mockResolvedValue({ data: null, error: { code: '55000' } });
    const result = await POST(request());
    expect(result.status).toBe(409);
    expect((await result.json()).error).toContain('review was saved');
  });
  it('does not open on a rejected genuine review', async () => {
    ownerRpc.mockResolvedValue({ error: { code: '55000' } });
    expect((await POST(request())).status).toBe(409);
    expect(adminRpc).not.toHaveBeenCalled();
  });
});
