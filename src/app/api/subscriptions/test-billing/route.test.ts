import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const { requireSubscriptionOwner, rpc } = vi.hoisted(() => ({
  requireSubscriptionOwner: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/subscriptions/owner', () => ({ requireSubscriptionOwner }));
import { ForbiddenError } from '@/lib/auth/account';
import { GET } from './route';
const org = '11111111-1111-4111-8111-111111111111';
const request = () =>
  new Request(
    `https://desk.example/api/subscriptions/test-billing?organizationId=${org}`
  );
describe('Test billing recovery snapshot', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('USEFULDESK_SUBSCRIPTION_INTENTS_ENABLED', 'true');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_MODE', 'test');
    vi.stubEnv('USEFULDESK_SUBSCRIPTION_REFUNDS_ENABLED', 'false');
    requireSubscriptionOwner.mockResolvedValue({ supabase: { rpc } });
    rpc.mockResolvedValue({
      data: { organization_id: org, refunds_enabled: true },
      error: null,
    });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('keeps recovery behind owner auth and outside Production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect((await GET(request())).status).toBe(404);
    expect(requireSubscriptionOwner).not.toHaveBeenCalled();
    vi.stubEnv('NODE_ENV', 'test');
    requireSubscriptionOwner.mockRejectedValueOnce(
      new ForbiddenError('Owner required')
    );
    expect((await GET(request())).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('prevents caching and requires both refund gates', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      billing: { organization_id: org, refunds_enabled: false },
    });
    expect(rpc).toHaveBeenCalledWith('subscription_test_billing_snapshot', {
      p_organization_id: org,
    });
  });
});
