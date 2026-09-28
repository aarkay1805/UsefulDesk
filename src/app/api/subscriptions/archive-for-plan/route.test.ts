import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requireSubscriptionOwner, rpc } = vi.hoisted(() => ({
  requireSubscriptionOwner: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/subscriptions/owner', () => ({ requireSubscriptionOwner }));

import { ForbiddenError } from '@/lib/auth/account';
import { POST } from './route';

const organizationId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
function request(accountIds: string[], sameOrigin = true) {
  return new Request(
    'https://desk.example/api/subscriptions/archive-for-plan',
    {
      method: 'POST',
      headers: sameOrigin
        ? { origin: 'https://desk.example', 'sec-fetch-site': 'same-origin' }
        : {},
      body: JSON.stringify({ organizationId, accountIds }),
    }
  );
}

describe('expired-trial branch selection route', () => {
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
      data: { archived_count: 1, active_count: 1 },
      error: null,
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('is unavailable in Production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect((await POST(request([branchId]))).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects cross-origin, non-owner, and duplicate selections', async () => {
    expect((await POST(request([branchId], false))).status).toBe(403);
    requireSubscriptionOwner.mockRejectedValueOnce(new ForbiddenError());
    expect((await POST(request([branchId]))).status).toBe(403);
    expect((await POST(request([branchId, branchId]))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('submits only the owner-selected branch IDs to the database', async () => {
    const response = await POST(request([branchId]));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      'subscription_archive_branches_for_conversion',
      { p_organization_id: organizationId, p_account_ids: [branchId] }
    );
  });

  it('asks the owner to recheck a changed roster', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '22023' } });
    expect((await POST(request([branchId]))).status).toBe(409);
  });
});
