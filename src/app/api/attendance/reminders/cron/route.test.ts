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
vi.mock('@/lib/reminders/worker', () => ({
  runAttendanceAbsenceReminderWorker: h.run,
}));

import { GET } from './route';

describe('GET /api/attendance/reminders/cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.authorized = true;
    h.configured = true;
    h.run.mockResolvedValue({
      accepted: 0,
      failed: 0,
      ambiguous: 0,
      infrastructureFailures: 0,
    });
  });

  it('runs only behind the shared cron boundary', async () => {
    const request = new Request(
      'https://desk.example/api/attendance/reminders/cron'
    );
    expect((await GET(request)).status).toBe(200);
    expect(h.run).toHaveBeenCalledOnce();
    h.authorized = false;
    expect((await GET(request)).status).toBe(401);
    expect(h.run).toHaveBeenCalledOnce();
  });

  it('surfaces provider uncertainty to the scheduler', async () => {
    h.run.mockResolvedValue({
      accepted: 0,
      failed: 0,
      ambiguous: 1,
      infrastructureFailures: 0,
    });
    const response = await GET(
      new Request('https://desk.example/api/attendance/reminders/cron')
    );
    expect(response.status).toBe(503);
  });
});
