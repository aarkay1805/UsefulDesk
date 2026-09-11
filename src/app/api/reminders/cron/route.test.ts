import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  authorized: true,
  configured: true,
  run: vi.fn(),
}));

vi.mock('@/lib/cron/auth', () => ({
  cronSecretConfigured: () => h.configured,
  isAuthorizedCronRequest: () => h.authorized,
}));
vi.mock('@/lib/reminders/worker', () => ({ runLifecycleReminderWorker: h.run }));

import { GET } from './route';

describe('GET /api/reminders/cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.authorized = true;
    h.configured = true;
    h.run.mockResolvedValue({ accepted: 0, failed: 0, notes: [] });
  });

  it('uses the shared cron boundary and returns a no-send empty run honestly', async () => {
    const response = await GET(new Request('https://desk.example/api/reminders/cron'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accepted: 0, failed: 0 });
    expect(h.run).toHaveBeenCalledOnce();
  });

  it('does not expose the worker without cron authorization', async () => {
    h.authorized = false;
    const response = await GET(new Request('https://desk.example/api/reminders/cron'));

    expect(response.status).toBe(401);
    expect(h.run).not.toHaveBeenCalled();
  });

  it('reports an ambiguous provider outcome as an actionable cron failure', async () => {
    h.run.mockResolvedValue({
      accepted: 0,
      failed: 0,
      ambiguous: 1,
      infrastructureFailures: 0,
      notes: [],
    });

    const response = await GET(new Request('https://desk.example/api/reminders/cron'));

    expect(response.status).toBe(503);
  });
});
