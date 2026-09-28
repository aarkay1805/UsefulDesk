import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const { requireSubscriptionOwner, executeTestFirstRefund } = vi.hoisted(() => ({
  requireSubscriptionOwner: vi.fn(),
  executeTestFirstRefund: vi.fn(),
}));
vi.mock('@/lib/subscriptions/owner', () => ({ requireSubscriptionOwner }));
vi.mock('@/lib/subscriptions/test-refunds', () => ({ executeTestFirstRefund }));
import { ForbiddenError } from '@/lib/auth/account';
import { __resetRateLimitForTests } from '@/lib/rate-limit';
import { POST } from './route';
const body = { organizationId: '11111111-1111-4111-8111-111111111111' };
function request(value: unknown = body, sameOrigin = true) {
  return new Request('https://desk.example/api/subscriptions/test-refunds', {
    method: 'POST',
    headers: sameOrigin ? { origin: 'https://desk.example' } : {},
    body: JSON.stringify(value),
  });
}
describe('Test refund execution route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    __resetRateLimitForTests();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('USEFULDESK_SUBSCRIPTION_INTENTS_ENABLED', 'true');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_MODE', 'test');
    vi.stubEnv('USEFULDESK_SUBSCRIPTION_REFUNDS_ENABLED', 'true');
    requireSubscriptionOwner.mockResolvedValue({ userId: 'owner' });
    executeTestFirstRefund.mockResolvedValue({
      status: 'processed',
      confirmed: true,
    });
  });
  afterEach(() => vi.unstubAllEnvs());
  it.each([
    ['NODE_ENV', 'production'],
    ['USEFULDESK_SUBSCRIPTION_REFUNDS_ENABLED', 'false'],
    ['USEFULDESK_SUBSCRIPTION_INTENTS_ENABLED', 'false'],
    ['USEFULDESK_SAAS_RAZORPAY_MODE', 'live'],
  ])('closes before auth when %s is %s', async (key, value) => {
    vi.stubEnv(key, value);
    expect((await POST(request())).status).toBe(404);
    expect(requireSubscriptionOwner).not.toHaveBeenCalled();
  });
  it('requires same origin and owner before any provider action', async () => {
    expect((await POST(request(body, false))).status).toBe(403);
    expect(requireSubscriptionOwner).not.toHaveBeenCalled();
    requireSubscriptionOwner.mockRejectedValueOnce(
      new ForbiddenError('Owner required')
    );
    expect((await POST(request())).status).toBe(403);
    expect(executeTestFirstRefund).not.toHaveBeenCalled();
  });
  it.each([
    { amountMinor: 1 },
    { paymentId: 'pay_Other' },
    { requestId: 'other' },
    { actorUserId: 'other' },
  ])('rejects client supplied refund facts %o', async (extra) => {
    expect((await POST(request({ ...body, ...extra }))).status).toBe(400);
    expect(executeTestFirstRefund).not.toHaveBeenCalled();
  });
  it('returns confirmation only from the verified flow', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      refund: { status: 'processed', confirmed: true },
    });
    expect(executeTestFirstRefund).toHaveBeenCalledWith({
      ...body,
      actorUserId: 'owner',
    });
  });
  it('leaves uncertain provider actions review-held', async () => {
    executeTestFirstRefund.mockRejectedValueOnce(
      new Error('Test refund needs review')
    );
    expect((await POST(request())).status).toBe(409);
    expect(executeTestFirstRefund).toHaveBeenCalledTimes(1);
  });
});
