import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requireSubscriptionOwner, rpc } = vi.hoisted(() => ({
  requireSubscriptionOwner: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/subscriptions/owner', () => ({ requireSubscriptionOwner }));

import { POST } from './route';

const organizationId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const slotId = '33333333-3333-4333-8333-333333333333';
const branchId = '44444444-4444-4444-8444-444444444444';
function request(overrides: Record<string, unknown> = {}) {
  return new Request(
    'https://desk.example/api/subscriptions/paid-slot-renewal-review',
    {
      method: 'POST',
      headers: {
        origin: 'https://desk.example',
        'sec-fetch-site': 'same-origin',
      },
      body: JSON.stringify({
        organizationId,
        requestId,
        cancelSlotIds: [slotId],
        archiveAccountIds: [branchId],
        ...overrides,
      }),
    }
  );
}
describe('Test paid-slot renewal review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('USEFULDESK_SUBSCRIPTION_INTENTS_ENABLED', 'true');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_MODE', 'test');
    requireSubscriptionOwner.mockResolvedValue({
      userId: 'owner-1',
      supabase: { rpc },
    });
    rpc.mockResolvedValue({
      data: { organization_id: organizationId, request_id: requestId },
      error: null,
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('keeps Production closed and rejects duplicate choices', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect((await POST(request())).status).toBe(404);
    vi.stubEnv('NODE_ENV', 'test');
    expect(
      (await POST(request({ cancelSlotIds: [slotId, slotId] }))).status
    ).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('saves exact slot and branch IDs without creating an order', async () => {
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(rpc).toHaveBeenCalledWith(
      'subscription_review_test_paid_slot_renewal',
      {
        p_organization_id: organizationId,
        p_request_id: requestId,
        p_cancel_slot_ids: [slotId],
        p_archive_account_ids: [branchId],
      }
    );
    expect(await response.json()).toEqual({
      review: { organization_id: organizationId, request_id: requestId },
    });
  });
});
