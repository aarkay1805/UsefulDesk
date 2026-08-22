import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  configured: true,
  authorized: true,
  result: {
    ok: true,
    body: {
      events: { claimed: 0, processed: 0, failed: 0, busy: 0 },
      pages: { claimed: 0, healthy: 0, repaired: 0, attention: 0, failed: 0 },
      notes: [],
    },
  },
}));

vi.mock('@/lib/cron/auth', () => ({
  cronSecretConfigured: () => mocks.configured,
  isAuthorizedCronRequest: () => mocks.authorized,
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({}),
}));
vi.mock('@/lib/meta/recovery', () => ({
  runMetaLeadRecovery: vi.fn(async () => mocks.result),
}));

import { GET } from './route';

describe('Meta recovery cron boundary', () => {
  beforeEach(() => {
    mocks.configured = true;
    mocks.authorized = true;
    mocks.result.ok = true;
  });

  it('returns 503 when cron auth is not configured', async () => {
    mocks.configured = false;
    expect((await GET(new Request('https://desk.test'))).status).toBe(503);
  });

  it('returns 401 to an unauthorized caller', async () => {
    mocks.authorized = false;
    expect((await GET(new Request('https://desk.test'))).status).toBe(401);
  });

  it('returns aggregate results and phase-aware status', async () => {
    expect((await GET(new Request('https://desk.test'))).status).toBe(200);
    mocks.result.ok = false;
    expect((await GET(new Request('https://desk.test'))).status).toBe(500);
  });
});
