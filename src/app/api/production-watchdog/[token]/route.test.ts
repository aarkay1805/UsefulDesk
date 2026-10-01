import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ rpc: vi.fn(), abort: vi.fn() }));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ rpc: h.rpc }),
}));
import { GET } from './route';
import { __resetRateLimitForTests } from '@/lib/rate-limit';

const token = 'a'.repeat(64);
const context = (value = token) => ({
  params: Promise.resolve({ token: value }),
});
const request = () =>
  new Request(`https://desk.example/api/production-watchdog/${token}`, {
    headers: { 'x-forwarded-for': '192.0.2.1' },
  });
const healthy = {
  checked_at: '2026-10-01T16:00:00Z',
  groups: ['ops', 'renewals'].map((group) => ({
    group,
    active: true,
    last_response_at: '2026-10-01T16:00:00Z',
    status_code: 200,
    timed_out: false,
    failed: 0,
    dispatched: group === 'ops' ? 10 : 3,
  })),
};

beforeEach(() => {
  __resetRateLimitForTests();
  vi.clearAllMocks();
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('USEFULDESK_EXTERNAL_MONITOR_ENABLED', 'true');
  vi.stubEnv('USEFULDESK_EXTERNAL_MONITOR_TOKEN', token);
  vi.stubEnv('CRON_SECRET', 'b'.repeat(64));
  vi.stubEnv('AUTOMATION_CRON_SECRET', 'c'.repeat(64));
  h.rpc.mockReturnValue({ abortSignal: h.abort });
  h.abort.mockResolvedValue({ data: healthy, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe('external production watchdog route', () => {
  it.each(['false', '', 'TRUE'])(
    'does not query when disabled %s',
    async (value) => {
      vi.stubEnv('USEFULDESK_EXTERNAL_MONITOR_ENABLED', value);
      expect((await GET(request(), context())).status).toBe(404);
      expect(h.rpc).not.toHaveBeenCalled();
    }
  );
  it('cannot enable Preview database access', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect((await GET(request(), context())).status).toBe(404);
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it.each(['invalid', 'd'.repeat(64)])(
    'rejects the wrong token before database access',
    async (value) => {
      expect((await GET(request(), context(value))).status).toBe(404);
      expect(h.rpc).not.toHaveBeenCalled();
    }
  );
  it.each(['', '[SENSITIVE]', 'b'.repeat(64), 'c'.repeat(64)])(
    'refuses missing or dispatch-capable monitor credentials',
    async (value) => {
      vi.stubEnv('USEFULDESK_EXTERNAL_MONITOR_TOKEN', value);
      expect((await GET(request(), context())).status).toBe(503);
      expect(h.rpc).not.toHaveBeenCalled();
    }
  );
  it('queries only the read-only RPC, bounds it and returns a fixed no-store shape', async () => {
    const response = await GET(request(), context());
    expect(response.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith(
      'production_watchdog_snapshot'
    );
    expect(h.abort).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      ok: true,
      checks: [
        { group: 'ops', healthy: true, reason: 'healthy' },
        { group: 'renewals', healthy: true, reason: 'healthy' },
      ],
    });
  });
  it('does not hide a stale or failed primary worker', async () => {
    h.abort.mockResolvedValue({
      data: {
        ...healthy,
        groups: healthy.groups.map((row) => ({ ...row, failed: 1 })),
      },
      error: null,
    });
    expect((await GET(request(), context())).status).toBe(503);
  });
  it('fails closed without exposing database/provider errors', async () => {
    h.abort.mockResolvedValue({ data: null, error: { message: 'private' } });
    expect(await (await GET(request(), context())).json()).toEqual({
      ok: false,
    });
    h.abort.mockRejectedValue(new Error('private'));
    expect(await (await GET(request(), context())).json()).toEqual({
      ok: false,
    });
  });
  it('rate limits before the database', async () => {
    for (let i = 0; i < 30; i++) await GET(request(), context());
    expect((await GET(request(), context())).status).toBe(429);
    expect(h.rpc).toHaveBeenCalledTimes(30);
  });
});
