import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  configured: true,
  authorized: true,
  drainPushDeliveries: vi.fn(),
}));

vi.mock('@/lib/cron/auth', () => ({
  cronSecretConfigured: () => h.configured,
  isAuthorizedCronRequest: () => h.authorized,
}));
vi.mock('@/lib/push/dispatcher', () => ({
  drainPushDeliveries: h.drainPushDeliveries,
}));

import { GET } from './route';

describe('GET /api/push/cron', () => {
  beforeEach(() => {
    h.configured = true;
    h.authorized = true;
    h.drainPushDeliveries.mockReset();
    h.drainPushDeliveries.mockResolvedValue({
      claimed: 4,
      ticketed: 2,
      delivered: 1,
      retried: 1,
      failed: 0,
      cancelled: 3,
      installationsRetired: 0,
    });
  });

  it('fails closed when cron authentication is not configured', async () => {
    h.configured = false;

    expect((await GET(new Request('https://desk.test'))).status).toBe(503);
    expect(h.drainPushDeliveries).not.toHaveBeenCalled();
  });

  it('rejects unauthorized callers', async () => {
    h.authorized = false;

    expect((await GET(new Request('https://desk.test'))).status).toBe(401);
    expect(h.drainPushDeliveries).not.toHaveBeenCalled();
  });

  it('returns only aggregate delivery counts', async () => {
    const response = await GET(new Request('https://desk.test'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      claimed: 4,
      ticketed: 2,
      delivered: 1,
      retried: 1,
      failed: 0,
      cancelled: 3,
      installationsRetired: 0,
    });
    expect(h.drainPushDeliveries).toHaveBeenCalledWith({ claimLimit: 100 });
  });

  it('returns a generic 503 when the dispatcher fails', async () => {
    h.drainPushDeliveries.mockRejectedValueOnce(
      new Error('ExponentPushToken[secret] Ada hello')
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await GET(new Request('https://desk.test'));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Push delivery unavailable',
    });
    expect(JSON.stringify(error.mock.calls)).not.toMatch(
      /ExponentPushToken|secret|Ada|hello/
    );
  });
});
