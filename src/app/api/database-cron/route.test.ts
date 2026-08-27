import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ rpc: h.rpc }),
}));

import { GET } from './route';

const DATABASE_SECRET = 'a'.repeat(64);

function request(group = 'ops', token = DATABASE_SECRET) {
  return new Request(`https://desk.example/api/database-cron?group=${group}`, {
    headers: { 'x-database-cron-secret': token },
  });
}

describe('GET /api/database-cron', () => {
  beforeEach(() => {
    h.rpc.mockReset();
    h.rpc.mockResolvedValue({ data: true, error: null });
    vi.stubEnv('AUTOMATION_CRON_SECRET', 'internal-cron-secret');
    vi.stubEnv('CRON_SECRET', '');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ processed: 0 }, { status: 200 }))
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('rejects malformed tokens before touching the database', async () => {
    const response = await GET(request('ops', 'short'));

    expect(response.status).toBe(401);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('rejects a well-formed token that Vault verification does not accept', async () => {
    h.rpc.mockResolvedValue({ data: false, error: null });

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('dispatches the complete ops group through the existing cron boundary', async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ group: 'ops', dispatched: 7, failed: 0 });
    expect(fetch).toHaveBeenCalledTimes(7);
    for (const [, options] of vi.mocked(fetch).mock.calls) {
      expect(options?.headers).toEqual({
        'x-cron-secret': 'internal-cron-secret',
      });
      expect(options?.headers).not.toEqual({
        'x-database-cron-secret': DATABASE_SECRET,
      });
    }
  });

  it('returns 503 when any delegated route fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error: 'failed' }, { status: 503 })
    );

    const response = await GET(request('renewals'));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      group: 'renewals',
      dispatched: 2,
      failed: 1,
    });
  });

  it('rejects unknown groups without dispatching work', async () => {
    const response = await GET(request('unknown'));

    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed when the existing internal cron secret is absent', async () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', '');
    vi.stubEnv('CRON_SECRET', '');

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
});
