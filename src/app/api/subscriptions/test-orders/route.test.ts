import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requireSubscriptionOwner, prepareTestCheckout } = vi.hoisted(() => ({
  requireSubscriptionOwner: vi.fn(),
  prepareTestCheckout: vi.fn(),
}));
vi.mock('@/lib/subscriptions/owner', () => ({ requireSubscriptionOwner }));
vi.mock('@/lib/subscriptions/test-flow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/subscriptions/test-flow')>()),
  prepareTestCheckout,
}));

import { ForbiddenError } from '@/lib/auth/account';
import { POST } from './route';

const organizationId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
function request(origin = true) {
  return new Request('https://desk.example/api/subscriptions/test-orders', {
    method: 'POST',
    headers: origin ? { origin: 'https://desk.example',
      'sec-fetch-site': 'same-origin' } : {},
    body: JSON.stringify({ organizationId, requestId }),
  });
}

describe('Test-only subscription order route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('USEFULDESK_SUBSCRIPTION_INTENTS_ENABLED', 'true');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_MODE', 'test');
    requireSubscriptionOwner.mockResolvedValue({ userId: 'owner-1' });
    prepareTestCheckout.mockResolvedValue({ orderId: 'order_Test123' });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('cannot make an order in Production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect((await POST(request())).status).toBe(404);
    expect(prepareTestCheckout).not.toHaveBeenCalled();
  });

  it('checks same-origin and organization ownership before provider work', async () => {
    expect((await POST(request(false))).status).toBe(403);
    requireSubscriptionOwner.mockRejectedValueOnce(new ForbiddenError());
    expect((await POST(request())).status).toBe(403);
    expect(prepareTestCheckout).not.toHaveBeenCalled();
  });

  it('hands the authenticated owner identity to the atomic order claim', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(prepareTestCheckout).toHaveBeenCalledWith({
      organizationId, requestId, actorUserId: 'owner-1',
    });
  });
});
