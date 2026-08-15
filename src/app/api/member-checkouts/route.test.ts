import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : 'Request failed' },
      { status: 500 }
    ),
}));

vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { adminAction: {} },
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: vi.fn(),
}));

import { POST } from './route';

const CONTACT_ID = '11111111-1111-4111-8111-111111111111';
const MEMBERSHIP_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_ID = '33333333-3333-4333-8333-333333333333';
const OPTION_ID = '44444444-4444-4444-8444-444444444444';
const IDEMPOTENCY_KEY = '55555555-5555-4555-8555-555555555555';

const validMembership = {
  plan_id: PLAN_ID,
  pricing_option_id: OPTION_ID,
  period_start: '2026-08-16',
  discount_type: null,
  discount_value: null,
  bonus_months: 0,
};

function request(overrides: Record<string, unknown> = {}) {
  return new Request('https://desk.example/api/member-checkouts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: 'membership_renewal',
      contact_id: CONTACT_ID,
      membership_id: MEMBERSHIP_ID,
      membership: validMembership,
      selections: [],
      collection: {
        collect_now: false,
        timing: 'full',
        method: 'cash',
        paid_at: '2026-08-16T10:00:00.000Z',
      },
      idempotency_key: IDEMPOTENCY_KEY,
      ...overrides,
    }),
  });
}

async function post(overrides: Record<string, unknown> = {}) {
  return POST(request(overrides));
}

describe('POST /api/member-checkouts intent contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.rpc.mockResolvedValue({
      data: { membership_id: MEMBERSHIP_ID },
      error: null,
    });
    h.requireRole.mockResolvedValue({
      accountId: 'account',
      userId: 'user',
      role: 'owner',
      supabase: { rpc: h.rpc },
    });
  });

  it.each([
    ['fee_amount', 1],
    ['period_end', '2026-10-01'],
    ['discount_amount', 999],
    ['list_price', 1],
    ['standard_period_end', '2026-09-01'],
  ])('rejects browser-authored membership field %s', async (field, value) => {
    const response = await post({
      membership: { ...validMembership, [field]: value },
    });

    expect(response.status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['discount_type', 'bogus'],
    ['bonus_months', -1],
    ['bonus_months', 121],
    ['period_start', '16-08-2026'],
    ['plan_id', 'not-a-uuid'],
    ['pricing_option_id', 'not-a-uuid'],
  ])('rejects invalid membership intent %s', async (field, value) => {
    const response = await post({
      membership: { ...validMembership, [field]: value },
    });

    expect(response.status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['timing', 'half'],
    ['method', 'crypto'],
    ['collect_now', 'yes'],
  ])('rejects invalid collection intent %s', async (field, value) => {
    const response = await post({
      collection: {
        collect_now: false,
        timing: 'full',
        method: 'cash',
        [field]: value,
      },
    });

    expect(response.status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('rejects browser-authored collection amounts and non-array selections', async () => {
    expect(
      (
        await post({
          collection: {
            collect_now: true,
            timing: 'full',
            method: 'cash',
            amount: 1,
          },
        })
      ).status
    ).toBe(400);
    expect((await post({ selections: {} })).status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('requires membership identifiers, option, and start date', async () => {
    expect((await post({ membership_id: undefined })).status).toBe(400);
    expect(
      (
        await post({
          membership: { ...validMembership, plan_id: undefined },
        })
      ).status
    ).toBe(400);
    expect(
      (
        await post({
          membership: {
            ...validMembership,
            pricing_option_id: undefined,
          },
        })
      ).status
    ).toBe(400);
    expect(
      (
        await post({
          membership: { ...validMembership, period_start: undefined },
        })
      ).status
    ).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('accepts deferred conversion intent and supplies authoritative tenancy', async () => {
    const response = await post({
      mode: 'convert',
      membership_id: undefined,
      membership: validMembership,
      collection: {
        collect_now: false,
        timing: 'full',
        method: 'cash',
      },
    });

    expect(response.status).toBe(201);
    expect(h.rpc).toHaveBeenCalledWith('perform_join_checkout', {
      p_payload: expect.objectContaining({
        account_id: 'account',
        mode: 'convert',
      }),
    });
  });

  it('routes trial conversion and renewal through member checkout', async () => {
    expect((await post({ mode: 'convert' })).status).toBe(201);
    expect((await post()).status).toBe(201);
    expect(h.rpc).toHaveBeenNthCalledWith(1, 'perform_member_checkout', {
      p_payload: expect.any(Object),
    });
    expect(h.rpc).toHaveBeenNthCalledWith(2, 'perform_member_checkout', {
      p_payload: expect.any(Object),
    });
  });
});
