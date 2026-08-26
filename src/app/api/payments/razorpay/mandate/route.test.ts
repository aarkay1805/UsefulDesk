import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getConnection: vi.fn(),
  createPlan: vi.fn(),
  createSubscription: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/account', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/auth/account')>();
  return { ...actual, requireRole: mocks.requireRole };
});
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ serviceRole: true }),
}));
vi.mock('@/lib/payments/credentials', () => ({
  getRazorpayConnection: mocks.getConnection,
  runRazorpayOperation: vi.fn(),
}));
vi.mock('@/lib/payments/razorpay', () => ({
  RazorpayError: class RazorpayError extends Error {
    status = 500;
  },
  cancelSubscription: vi.fn(),
  createPlan: mocks.createPlan,
  createSubscription: mocks.createSubscription,
}));

import { POST } from './route';

const activeMembership = {
  id: 'membership-id',
  account_id: 'account-id',
  contact_id: 'contact-id',
  end_date: '2026-09-30',
  fee_amount: 1500,
  status: 'active',
  is_trial: false,
  plan: {
    name: 'Monthly',
    duration_days: 30,
    plan_type: 'recurring',
  },
  pricing_option: {
    id: 'option-id',
    duration_count: 1,
    duration_unit: 'month',
    price: 1500,
  },
  contact: { name: 'Asha', phone: '+919876543210' },
};

function context(input?: {
  membership?: Record<string, unknown>;
  account?: Record<string, unknown> | null;
  accountError?: { message: string } | null;
}) {
  const from = vi.fn((table: string) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () =>
        table === 'memberships'
          ? {
              data: input?.membership ?? activeMembership,
              error: null,
            }
          : {
              data:
                input && 'account' in input
                  ? input.account
                  : { default_currency: 'INR' },
              error: input?.accountError ?? null,
            }
      ),
    };
    return query;
  });
  return {
    accountId: 'account-id',
    userId: 'user-id',
    role: 'owner',
    supabase: { from },
  };
}

function request(origin = 'https://desk.example') {
  return new Request('https://desk.example/api/payments/razorpay/mandate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      'sec-fetch-site':
        origin === 'https://desk.example' ? 'same-origin' : 'cross-site',
    },
    body: JSON.stringify({ membership_id: 'membership-id' }),
  });
}

describe('Razorpay mandate route safeguards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue(context());
  });

  it('rejects a cross-site mutation before loading the caller', async () => {
    const response = await POST(request('https://evil.example'));

    expect(response.status).toBe(403);
    expect(mocks.requireRole).not.toHaveBeenCalled();
  });

  it('rejects a frozen membership before any provider access', async () => {
    mocks.requireRole.mockResolvedValue(
      context({ membership: { ...activeMembership, status: 'frozen' } })
    );

    const response = await POST(request());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Auto-pay can be set up only for an active, non-trial membership',
    });
    expect(mocks.getConnection).not.toHaveBeenCalled();
  });

  it('rejects an expired membership before any provider access', async () => {
    mocks.requireRole.mockResolvedValue(
      context({ membership: { ...activeMembership, status: 'expired' } })
    );

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(mocks.getConnection).not.toHaveBeenCalled();
  });

  it('fails closed when the account currency cannot be loaded', async () => {
    mocks.requireRole.mockResolvedValue(
      context({ account: null, accountError: { message: 'database offline' } })
    );

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(mocks.getConnection).not.toHaveBeenCalled();
  });

  it('fails closed when the account has no configured currency', async () => {
    mocks.requireRole.mockResolvedValue(context({ account: null }));

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(mocks.getConnection).not.toHaveBeenCalled();
  });
});
