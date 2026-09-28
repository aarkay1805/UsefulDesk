import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const { requireSubscriptionOwner, reserveTestFirstRefund } = vi.hoisted(() => ({
  requireSubscriptionOwner: vi.fn(),
  reserveTestFirstRefund: vi.fn(),
}));
vi.mock('@/lib/subscriptions/owner', () => ({ requireSubscriptionOwner }));
vi.mock('@/lib/subscriptions/test-refund-claims', () => ({
  reserveTestFirstRefund,
}));
import { ForbiddenError } from '@/lib/auth/account';
import { __resetRateLimitForTests } from '@/lib/rate-limit';
import { POST } from './route';
const body = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
};
function request(value: unknown = body, sameOrigin = true) {
  return new Request(
    'https://desk.example/api/subscriptions/test-refund-claims',
    {
      method: 'POST',
      headers: sameOrigin ? { origin: 'https://desk.example' } : {},
      body: JSON.stringify(value),
    }
  );
}
describe('Test refund request route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    __resetRateLimitForTests();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('USEFULDESK_SUBSCRIPTION_INTENTS_ENABLED', 'true');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_MODE', 'test');
    requireSubscriptionOwner.mockResolvedValue({ userId: 'owner' });
    reserveTestFirstRefund.mockResolvedValue({ state: 'requested' });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('is closed in Production and without local opt-in', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect((await POST(request())).status).toBe(404);
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('USEFULDESK_SUBSCRIPTION_INTENTS_ENABLED', 'false');
    expect((await POST(request())).status).toBe(404);
    expect(requireSubscriptionOwner).not.toHaveBeenCalled();
  });
  it('requires same origin and owner identity before payment lookup', async () => {
    expect((await POST(request(body, false))).status).toBe(403);
    expect(requireSubscriptionOwner).not.toHaveBeenCalled();
    requireSubscriptionOwner.mockRejectedValueOnce(
      new ForbiddenError('Owner required')
    );
    expect((await POST(request())).status).toBe(403);
    expect(reserveTestFirstRefund).not.toHaveBeenCalled();
  });
  it.each([
    { amountMinor: 1 },
    { receivedAt: '2026-01-01T00:00:00Z' },
    { billingTimezone: 'UTC' },
    { paymentId: 'pay_Other' },
  ])('refuses caller-supplied refund facts %o', async (extra) => {
    expect((await POST(request({ ...body, ...extra }))).status).toBe(400);
    expect(reserveTestFirstRefund).not.toHaveBeenCalled();
  });
  it('reports requested status and supplies only a server receipt timestamp', async () => {
    const before = Date.now();
    const response = await POST(request());
    const after = Date.now();
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ claim: { state: 'requested' } });
    const supplied = reserveTestFirstRefund.mock.calls[0][0];
    expect(supplied).toMatchObject({ ...body, actorUserId: 'owner' });
    expect(Date.parse(supplied.receivedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(supplied.receivedAt)).toBeLessThanOrEqual(after);
  });
});
