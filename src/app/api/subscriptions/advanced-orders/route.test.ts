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

import { POST } from './route';

const organizationId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
function request(kind = 'upgrade') {
  return new Request('https://desk.example/api/subscriptions/advanced-orders', {
    method: 'POST',
    headers: {
      origin: 'https://desk.example',
      'sec-fetch-site': 'same-origin',
    },
    body: JSON.stringify({ organizationId, requestId, kind }),
  });
}

describe('advanced Test order route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('USEFULDESK_SUBSCRIPTION_INTENTS_ENABLED', 'true');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_MODE', 'test');
    requireSubscriptionOwner.mockResolvedValue({ userId: 'owner-1' });
    prepareTestCheckout.mockResolvedValue({ orderId: 'order_Test123' });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('is closed in Production and rejects nonpayable review kinds', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect((await POST(request())).status).toBe(404);
    vi.stubEnv('NODE_ENV', 'test');
    expect((await POST(request('addon_cancel'))).status).toBe(400);
    expect(prepareTestCheckout).not.toHaveBeenCalled();
  });

  it('passes the owner and exact advanced kind to the claim', async () => {
    expect((await POST(request('restart'))).status).toBe(200);
    expect(prepareTestCheckout).toHaveBeenCalledWith({
      organizationId,
      requestId,
      actorUserId: 'owner-1',
      kind: 'restart',
    });
  });
});
