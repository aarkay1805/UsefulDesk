import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  configured: true,
  authorized: true,
  providerMode: 'live' as const,
  result: {
    webhooks: {
      claimed: 0,
      processed: 0,
      failed: 0,
      oldestAgeSeconds: null,
    },
    chargeExceptions: {
      claimed: 0,
      applied: 0,
      deferred: 0,
      failed: 0,
      oldestAgeSeconds: null,
    },
    subscriptionReconciliation: {
      claimed: 0,
      scanned: 0,
      observations: 0,
      failed: 0,
      oldestAgeSeconds: null,
    },
    tokens: {
      disabled: false,
      claimed: 0,
      refreshed: 0,
      readinessVerified: 0,
      skippedNotDue: 0,
      failed: 0,
    },
    paymentLinks: {
      claimed: 0,
      reconciled: 0,
      failed: 0,
      oldestAgeSeconds: null,
    },
    refunds: {
      disabled: false,
      claimed: 0,
      reconciled: 0,
      failed: 0,
      oldestAgeSeconds: null,
    },
    refundReconciliation: {
      disabled: false,
      initializedAccounts: 0,
      claimed: 0,
      scanned: 0,
      unrelated: 0,
      failed: 0,
    },
    notes: [] as string[],
  },
}));

vi.mock('@/lib/cron/auth', () => ({
  cronSecretConfigured: () => mocks.configured,
  isAuthorizedCronRequest: () => mocks.authorized,
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({}),
}));
vi.mock('@/lib/payments/razorpay-config', () => ({
  getRazorpayProviderMode: () => mocks.providerMode,
}));
vi.mock('@/lib/payments/razorpay-recovery', () => ({
  runRazorpayRecovery: vi.fn(async () => mocks.result),
}));

import { GET } from './route';

describe('Razorpay recovery cron boundary', () => {
  beforeEach(() => {
    mocks.configured = true;
    mocks.authorized = true;
    for (const phase of [
      'webhooks',
      'chargeExceptions',
      'subscriptionReconciliation',
      'tokens',
      'paymentLinks',
      'refunds',
      'refundReconciliation',
    ] as const) {
      mocks.result[phase].failed = 0;
    }
    mocks.result.notes = [];
  });

  it('returns the aggregate result with 200 when every recovery phase succeeds', async () => {
    const response = await GET(new Request('https://desk.test'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(mocks.result);
  });

  it('returns 503 with the aggregate result when any isolated phase fails', async () => {
    for (const phase of [
      'webhooks',
      'chargeExceptions',
      'subscriptionReconciliation',
      'tokens',
      'paymentLinks',
      'refunds',
      'refundReconciliation',
    ] as const) {
      mocks.result[phase].failed = 1;
      mocks.result.notes = [`${phase}:failed`];

      const response = await GET(new Request('https://desk.test'));

      expect(response.status, phase).toBe(503);
      await expect(response.json()).resolves.toEqual(mocks.result);
      mocks.result[phase].failed = 0;
    }
  });
});
