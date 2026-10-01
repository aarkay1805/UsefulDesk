import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as ops } from '@/app/api/platform-cron/ops/route';
import { GET as renewals } from '@/app/api/platform-cron/renewals/route';

const NATIVE_SECRET = 'native-secret-that-is-private';
const WORKER_SECRET = 'worker-secret-that-is-private';
const rejectedHeaders: Record<string, string>[] = [
  {},
  { authorization: 'Bearer wrong' },
  { authorization: `Basic ${NATIVE_SECRET}` },
  { authorization: `Bearer ${WORKER_SECRET}` },
  { 'x-cron-secret': NATIVE_SECRET },
];

function request(headers = { authorization: `Bearer ${NATIVE_SECRET}` }) {
  return new Request('https://untrusted.example/api/platform-cron/ops', {
    headers,
  });
}

describe('native Vercel scheduler', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('USEFULDESK_VERCEL_CRONS_ENABLED', 'true');
    vi.stubEnv('CRON_SECRET', NATIVE_SECRET);
    vi.stubEnv('AUTOMATION_CRON_SECRET', WORKER_SECRET);
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://desk.example');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ processed: 0 }))
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each(['', 'false', 'TRUE', '1', '[SENSITIVE]'])(
    'does not dispatch without a literal enabled flag (%s)',
    async (flag) => {
      vi.stubEnv('USEFULDESK_VERCEL_CRONS_ENABLED', flag);
      vi.stubEnv('CRON_SECRET', '');
      const response = await ops(request({ authorization: '' }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        group: 'ops',
        dispatched: 0,
        failed: 0,
        skipped: 'disabled',
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(console.info).not.toHaveBeenCalled();
    }
  );

  it.each(['preview', 'development', ''])(
    'cannot enable work outside Vercel Production (%s)',
    async (environment) => {
      vi.stubEnv('VERCEL_ENV', environment);
      const response = await renewals(request());
      expect(await response.json()).toMatchObject({
        dispatched: 0,
        skipped: 'disabled',
      });
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it.each(rejectedHeaders)(
    'requires the reserved bearer secret (%j)',
    async (headers) => {
      const response = await ops(
        new Request('https://desk.example/api/platform-cron/ops', { headers })
      );
      expect(response.status).toBe(401);
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it('fails closed when the native secret is missing, even with a worker secret', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const response = await ops(request());
    expect(response.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    '',
    'not-a-url',
    'http://desk.example',
    'https://user:password@desk.example',
    'https://desk.example/path',
    'https://desk.example/?redirect=evil',
    'https://desk.example/#fragment',
  ])('refuses invalid configured origins (%s)', async (origin) => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', origin);
    const response = await ops(request());
    expect(response.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the configured origin, bounded requests, and worker auth for all ten ops', async () => {
    const response = await ops(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      group: 'ops',
      dispatched: 10,
      failed: 0,
    });
    expect(fetch).toHaveBeenCalledTimes(10);
    for (const [url, options] of vi.mocked(fetch).mock.calls) {
      expect(new URL(String(url)).origin).toBe('https://desk.example');
      expect(options).toMatchObject({
        method: 'GET',
        cache: 'no-store',
        redirect: 'error',
        headers: { 'x-cron-secret': WORKER_SECRET },
        signal: expect.any(AbortSignal),
      });
    }
  });

  it('dispatches all three renewal workers and supports only CRON_SECRET being set', async () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', '');
    const response = await renewals(request());
    expect(await response.json()).toMatchObject({
      group: 'renewals',
      dispatched: 3,
      failed: 0,
    });
    expect(
      vi.mocked(fetch).mock.calls.map(([url]) => new URL(String(url)).pathname)
    ).toEqual([
      '/api/renewals/cron',
      '/api/payment-installments/cron',
      '/api/reminders/cron',
    ]);
    expect(fetch).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: { 'x-cron-secret': NATIVE_SECRET },
      })
    );
  });

  it('reports failures without suppressing siblings or exposing worker bodies/errors', async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(
        new Error(`redirect to private-provider/${WORKER_SECRET}`)
      )
      .mockResolvedValueOnce(
        Response.json(
          { privateProviderId: 'private-id', failed: 1 },
          { status: 503 }
        )
      );
    const response = await ops(request());
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body).toMatchObject({ dispatched: 10, failed: 2 });
    expect(fetch).toHaveBeenCalledTimes(10);
    expect(body.results[0]).toEqual({
      path: '/api/follow-ups/cron',
      status: 0,
      ok: false,
    });
    expect(body.results[1]).toEqual({
      path: '/api/automations/cron',
      status: 503,
      ok: false,
    });
    expect(JSON.stringify(body)).not.toContain('private');
    expect(console.info).toHaveBeenCalledExactlyOnceWith(
      '[native cron]',
      JSON.stringify(body)
    );
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(
      WORKER_SECRET
    );
  });
});
