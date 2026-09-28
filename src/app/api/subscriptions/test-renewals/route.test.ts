import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const { requireSubscriptionOwner, prepareTestCheckout, rpc } = vi.hoisted(
  () => ({
    requireSubscriptionOwner: vi.fn(),
    prepareTestCheckout: vi.fn(),
    rpc: vi.fn(),
  })
);
vi.mock('@/lib/subscriptions/owner', () => ({ requireSubscriptionOwner }));
vi.mock('@/lib/subscriptions/test-flow', () => ({ prepareTestCheckout }));
import { ForbiddenError } from '@/lib/auth/account';
import { __resetRateLimitForTests } from '@/lib/rate-limit';
import { POST as renew } from './route';
import { POST as change } from '../renewal-change/route';
const org = '11111111-1111-4111-8111-111111111111';
const req = '22222222-2222-4222-8222-222222222222';
const account = '33333333-3333-4333-8333-333333333333';
const canonical = '44444444-4444-4444-8444-444444444444';
const renewalBody = { organizationId: org, requestId: req, accountId: account };
const changeBody = {
  organizationId: org,
  requestId: req,
  targetTier: 'starter',
  archiveAccountIds: [account],
};
function request(body: unknown, sameOrigin = true) {
  return new Request('https://desk.example/api/subscriptions/test-renewals', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(sameOrigin ? { origin: 'https://desk.example' } : {}),
    },
    body: JSON.stringify(body),
  });
}
describe('Test renewal owner routes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    __resetRateLimitForTests();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('USEFULDESK_SUBSCRIPTION_INTENTS_ENABLED', 'true');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_MODE', 'test');
    requireSubscriptionOwner.mockResolvedValue({
      supabase: { rpc },
      userId: 'owner',
    });
    prepareTestCheckout.mockResolvedValue({ orderId: 'order_Test' });
  });
  afterEach(() => vi.unstubAllEnvs());
  it.each([
    { handler: renew, body: renewalBody },
    { handler: change, body: changeBody },
  ])(
    'preserves Production, origin, and owner boundaries',
    async ({ handler, body }) => {
      vi.stubEnv('NODE_ENV', 'production');
      expect((await handler(request(body))).status).toBe(404);
      expect(requireSubscriptionOwner).not.toHaveBeenCalled();
      vi.stubEnv('NODE_ENV', 'test');
      expect((await handler(request(body, false))).status).toBe(403);
      expect(requireSubscriptionOwner).not.toHaveBeenCalled();
      requireSubscriptionOwner.mockRejectedValueOnce(
        new ForbiddenError('Owner required')
      );
      expect((await handler(request(body))).status).toBe(403);
      expect(rpc).not.toHaveBeenCalled();
      expect(prepareTestCheckout).not.toHaveBeenCalled();
    }
  );
  it('resumes the database canonical renewal after browser request loss', async () => {
    rpc.mockResolvedValue({
      data: { organization_id: org, request_id: canonical, kind: 'renewal' },
      error: null,
    });
    expect((await renew(request(renewalBody))).status).toBe(202);
    expect(requireSubscriptionOwner).toHaveBeenCalledWith(org, account);
    expect(prepareTestCheckout).toHaveBeenCalledWith({
      organizationId: org,
      requestId: canonical,
      actorUserId: 'owner',
      kind: 'renewal',
    });
  });
  it.each([{ code: '55000' }, { code: '22023' }])(
    'does not order a cancelled or stale renewal %o',
    async (error) => {
      rpc.mockResolvedValue({ data: null, error });
      expect((await renew(request(renewalBody))).status).toBe(409);
      expect(prepareTestCheckout).not.toHaveBeenCalled();
    }
  );
  it('fails closed when an RPC returns another organization', async () => {
    rpc.mockResolvedValue({
      data: { organization_id: canonical, request_id: req, kind: 'renewal' },
      error: null,
    });
    expect((await renew(request(renewalBody))).status).toBe(500);
    expect(prepareTestCheckout).not.toHaveBeenCalled();
  });
  it.each(['starter', null])(
    'schedules a downgrade or cancellation without any provider request: %s',
    async (targetTier) => {
      const body = {
        ...changeBody,
        targetTier,
        archiveAccountIds: targetTier === null ? [] : [account],
      };
      rpc.mockResolvedValue({
        data: {
          organization_id: org,
          request_id: req,
          target_tier: targetTier,
        },
        error: null,
      });
      expect((await change(request(body))).status).toBe(202);
      expect(rpc).toHaveBeenCalledWith(
        'subscription_schedule_test_renewal_change',
        {
          p_organization_id: org,
          p_request_id: req,
          p_target_tier: targetTier,
          p_archive_account_ids: body.archiveAccountIds,
        }
      );
      expect(prepareTestCheckout).not.toHaveBeenCalled();
    }
  );
  it.each([
    { ...changeBody, targetTier: null },
    { ...changeBody, archiveAccountIds: [account, account] },
    { ...changeBody, amountMinor: 1 },
    { ...changeBody, targetTier: 'other' },
  ])(
    'rejects malformed/archive-on-cancellation instructions %o',
    async (body) => {
      expect((await change(request(body))).status).toBe(400);
      expect(requireSubscriptionOwner).not.toHaveBeenCalled();
    }
  );
});
