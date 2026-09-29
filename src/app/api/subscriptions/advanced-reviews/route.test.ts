import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requireSubscriptionOwner, rpc } = vi.hoisted(() => ({
  requireSubscriptionOwner: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/subscriptions/owner', () => ({ requireSubscriptionOwner }));

import { ForbiddenError } from '@/lib/auth/account';
import { POST } from './route';

const organizationId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const accountId = '33333333-3333-4333-8333-333333333333';
const branchId = '44444444-4444-4444-8444-444444444444';

function request(overrides: Record<string, unknown> = {}, sameOrigin = true) {
  return new Request(
    'https://desk.example/api/subscriptions/advanced-reviews',
    {
      method: 'POST',
      headers: sameOrigin
        ? { origin: 'https://desk.example', 'sec-fetch-site': 'same-origin' }
        : {},
      body: JSON.stringify({
        organizationId,
        requestId,
        accountId,
        kind: 'restart',
        targetTier: 'growth',
        requestedSlots: 0,
        archiveAccountIds: [branchId],
        starterReminderResetAccepted: false,
        starterReminderPolicyVersion: null,
        ...overrides,
      }),
    }
  );
}

describe('Test advanced billing review route', () => {
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
      data: {
        organization_id: organizationId,
        request_id: requestId,
        state: 'awaiting_policy',
      },
      error: null,
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('is unavailable in Production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect((await POST(request())).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('requires same-origin and owner authorization', async () => {
    expect((await POST(request({}, false))).status).toBe(403);
    requireSubscriptionOwner.mockRejectedValueOnce(new ForbiddenError());
    expect((await POST(request())).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects invalid or duplicate branch choices before the RPC', async () => {
    expect(
      (await POST(request({ archiveAccountIds: [branchId, branchId] }))).status
    ).toBe(400);
    expect((await POST(request({ requestedSlots: -1 }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('requires a versioned owner choice for a Starter reminder reset', async () => {
    expect(
      (await POST(request({ starterReminderResetAccepted: true }))).status
    ).toBe(400);
    expect(
      (
        await POST(
          request({
            starterReminderResetAccepted: true,
            starterReminderPolicyVersion: 'proposal-1',
            targetTier: 'growth',
          })
        )
      ).status
    ).toBe(400);
    expect(
      (
        await POST(
          request({
            starterReminderResetAccepted: true,
            starterReminderPolicyVersion: 'proposal-1',
            targetTier: 'starter',
          })
        )
      ).status
    ).toBe(202);
  });

  it('records a review without returning a checkout', async () => {
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      review: {
        organization_id: organizationId,
        request_id: requestId,
        state: 'awaiting_policy',
      },
    });
    expect(rpc).toHaveBeenCalledWith(
      'subscription_create_test_advanced_review',
      {
        p_organization_id: organizationId,
        p_request_id: requestId,
        p_billing_account_id: accountId,
        p_kind: 'restart',
        p_target_tier: 'growth',
        p_requested_slots: 0,
        p_archive_account_ids: [branchId],
        p_starter_reminder_reset_accepted: false,
        p_starter_reminder_policy_version: null,
      }
    );
  });
});
