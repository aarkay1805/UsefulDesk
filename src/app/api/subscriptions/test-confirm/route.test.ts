import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requireSubscriptionOwner, confirmTestPayment } = vi.hoisted(() => ({
  requireSubscriptionOwner: vi.fn(),
  confirmTestPayment: vi.fn(),
}));
vi.mock('@/lib/subscriptions/owner', () => ({ requireSubscriptionOwner }));
vi.mock('@/lib/subscriptions/test-flow', () => ({ confirmTestPayment }));

import { ForbiddenError } from '@/lib/auth/account';
import { POST } from './route';

const organizationId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
function request() {
  return new Request('https://desk.example/api/subscriptions/test-confirm', {
    method: 'POST',
    headers: { origin: 'https://desk.example', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ organizationId, requestId,
      orderId: 'order_Test123', paymentId: 'pay_Test456', signature: 'a'.repeat(64) }),
  });
}

describe('Test-only subscription confirmation route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('USEFULDESK_SUBSCRIPTION_INTENTS_ENABLED', 'true');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_MODE', 'test');
    requireSubscriptionOwner.mockResolvedValue({ userId: 'owner-1' });
    confirmTestPayment.mockResolvedValue({ organizationId });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('cannot confirm or grant from Production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect((await POST(request())).status).toBe(404);
    expect(confirmTestPayment).not.toHaveBeenCalled();
  });

  it('requires the organization owner before payment verification', async () => {
    requireSubscriptionOwner.mockRejectedValueOnce(new ForbiddenError());
    expect((await POST(request())).status).toBe(403);
    expect(confirmTestPayment).not.toHaveBeenCalled();
  });

  it('passes exact organization and intent expectations into verification', async () => {
    expect((await POST(request())).status).toBe(200);
    expect(confirmTestPayment).toHaveBeenCalledWith(expect.objectContaining({
      source: 'checkout', expectedOrganizationId: organizationId,
      expectedRequestId: requestId, orderId: 'order_Test123',
      paymentId: 'pay_Test456',
    }));
  });
});
