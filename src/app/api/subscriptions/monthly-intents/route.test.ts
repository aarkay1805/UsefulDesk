import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient }));

import { __resetRateLimitForTests } from '@/lib/rate-limit';
import { POST } from './route';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_ID = '44444444-4444-4444-8444-444444444444';

function request(body: unknown, sameOrigin = true): Request {
  return new Request('https://desk.example/api/subscriptions/monthly-intents', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(sameOrigin
        ? { origin: 'https://desk.example', 'sec-fetch-site': 'same-origin' }
        : {}),
    },
    body: JSON.stringify(body),
  });
}

function identity(options?: {
  owner?: boolean;
  currency?: string;
  rpcError?: { code: string; message: string };
  result?: unknown;
}) {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'my_branch_accounts') {
      return {
        data: [
          {
            organization_id: ORGANIZATION_ID,
            account_id: ACCOUNT_ID,
            is_organization_owner: options?.owner ?? true,
            default_currency: options?.currency ?? 'INR',
            branch_status: 'active',
          },
        ],
        error: null,
      };
    }
    return {
      data: options?.result ?? {
        request_id: REQUEST_ID,
        organization_id: ORGANIZATION_ID,
        tier: 'growth',
        amount_minor: 149900,
        currency: 'INR',
        state: 'pending',
      },
      error: options?.rpcError ?? null,
    };
  });
  createClient.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'owner-1' } },
        error: null,
      })),
    },
    rpc,
  });
  return rpc;
}

describe('local monthly plan intent route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitForTests();
    vi.stubEnv('USEFULDESK_SUBSCRIPTION_INTENTS_ENABLED', 'true');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_MODE', 'test');
  });

  afterEach(() => vi.unstubAllEnvs());

  it('is disabled by default without reading identity or billing state', async () => {
    vi.stubEnv('USEFULDESK_SUBSCRIPTION_INTENTS_ENABLED', '');
    const response = await POST(
      request({
        organizationId: ORGANIZATION_ID,
        accountId: ACCOUNT_ID,
        requestId: REQUEST_ID,
        tier: 'growth',
      })
    );
    expect(response.status).toBe(404);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('stays disabled in Production even with the local opt-in set', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const response = await POST(
      request({
        organizationId: ORGANIZATION_ID,
        accountId: ACCOUNT_ID,
        requestId: REQUEST_ID,
        tier: 'growth',
      })
    );
    expect(response.status).toBe(404);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('rejects cross-site requests before identity or billing access', async () => {
    const response = await POST(
      request(
        {
          organizationId: ORGANIZATION_ID,
          accountId: ACCOUNT_ID,
          requestId: REQUEST_ID,
          tier: 'growth',
        },
        false
      )
    );
    expect(response.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('records only a pending plan intent for the organization owner', async () => {
    const rpc = identity();
    const response = await POST(
      request({
        organizationId: ORGANIZATION_ID,
        accountId: ACCOUNT_ID,
        requestId: REQUEST_ID,
        tier: 'growth',
      })
    );
    expect(response.status).toBe(202);
    expect((await response.json()).intent).toMatchObject({ state: 'pending' });
    expect(rpc).toHaveBeenCalledWith('subscription_create_monthly_intent', {
      p_organization_id: ORGANIZATION_ID,
      p_request_id: REQUEST_ID,
      p_tier: 'growth',
      p_billing_account_id: ACCOUNT_ID,
    });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('returns the canonical pending request after the browser loses its request ID', async () => {
    identity();
    const response = await POST(
      request({
        organizationId: ORGANIZATION_ID,
        accountId: ACCOUNT_ID,
        requestId: '55555555-5555-4555-8555-555555555555',
        tier: 'growth',
      })
    );
    expect(response.status).toBe(202);
    expect((await response.json()).intent.request_id).toBe(REQUEST_ID);
  });

  it('refuses a non-Test mode even when intent creation is opted in', async () => {
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_MODE', 'live');
    expect((await POST(request({}))).status).toBe(404);
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    { owner: false, currency: 'INR' },
    { owner: true, currency: 'USD' },
  ])('rejects unqualified organization identity %o', async (options) => {
    const rpc = identity(options);
    const response = await POST(
      request({
        organizationId: ORGANIZATION_ID,
        accountId: ACCOUNT_ID,
        requestId: REQUEST_ID,
        tier: 'growth',
      })
    );
    expect(response.status).toBe(403);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('does not turn a disabled database gate into an accepted intent', async () => {
    identity({ rpcError: { code: '55000', message: 'disabled' } });
    const response = await POST(
      request({
        organizationId: ORGANIZATION_ID,
        accountId: ACCOUNT_ID,
        requestId: REQUEST_ID,
        tier: 'growth',
      })
    );
    expect(response.status).toBe(503);
  });

  it('fails closed if the database returns another organization', async () => {
    identity({
      result: {
        request_id: REQUEST_ID,
        organization_id: '33333333-3333-4333-8333-333333333333',
        tier: 'growth',
        amount_minor: 149900,
        currency: 'INR',
        state: 'pending',
      },
    });
    const response = await POST(
      request({
        organizationId: ORGANIZATION_ID,
        accountId: ACCOUNT_ID,
        requestId: REQUEST_ID,
        tier: 'growth',
      })
    );
    expect(response.status).toBe(500);
  });
});
