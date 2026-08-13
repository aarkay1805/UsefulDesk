import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  supabaseAdmin: vi.fn(),
}));

vi.mock('@/lib/cron/auth', () => ({
  cronSecretConfigured: () => true,
  isAuthorizedCronRequest: () => true,
}));

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: h.supabaseAdmin,
}));

import { GET } from './route';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const STALE_ADVANCE = '2026-08-12T12:00:00.000Z';
const CONCURRENT_ADVANCE = '2026-08-14T11:59:59.000Z';

function makeAdmin(currentLastAdvancedAt: string) {
  const state = {
    status: 'active',
    lastAdvancedAt: currentLastAdvancedAt,
    eventInserts: [] as Record<string, unknown>[],
    updateFilters: new Map<string, unknown>(),
  };

  function from(table: string) {
    if (table === 'flow_run_events') {
      return {
        insert: vi.fn((payload: Record<string, unknown>) => {
          state.eventInserts.push(payload);
          return Promise.resolve({ error: null });
        }),
      };
    }

    if (table !== 'flow_runs') throw new Error(`unexpected table: ${table}`);

    let operation: 'scan' | 'update' = 'scan';
    let updatePayload: Record<string, unknown> | null = null;
    const builder: Record<string, unknown> = {};

    builder.select = vi.fn(() => builder);
    builder.update = vi.fn((payload: Record<string, unknown>) => {
      operation = 'update';
      updatePayload = payload;
      return builder;
    });
    builder.eq = vi.fn((column: string, value: unknown) => {
      if (operation === 'update') state.updateFilters.set(column, value);
      return builder;
    });
    builder.then = (resolve: (value: unknown) => unknown) => {
      if (operation === 'scan') {
        return resolve({
          data: [
            {
              id: RUN_ID,
              flow_id: 'flow-1',
              user_id: 'user-1',
              contact_id: 'contact-1',
              last_advanced_at: STALE_ADVANCE,
              flows: { fallback_policy: { on_timeout_hours: 24 } },
            },
          ],
          error: null,
        });
      }

      const matches =
        state.updateFilters.get('id') === RUN_ID &&
        state.updateFilters.get('status') === state.status &&
        (!state.updateFilters.has('last_advanced_at') ||
          state.updateFilters.get('last_advanced_at') === state.lastAdvancedAt);

      if (matches && updatePayload) {
        state.status = String(updatePayload.status);
        return resolve({ data: [{ id: RUN_ID }], error: null });
      }
      return resolve({ data: [], error: null });
    };

    return builder;
  }

  return { client: { from }, state };
}

describe('GET /api/flows/cron timeout CAS', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T12:00:00.000Z'));
    h.supabaseAdmin.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not time out a run advanced after the stale scan', async () => {
    const admin = makeAdmin(CONCURRENT_ADVANCE);
    h.supabaseAdmin.mockReturnValue(admin.client);

    const response = await GET(
      new Request('https://desk.example/api/flows/cron')
    );

    expect(await response.json()).toEqual({ swept: 0 });
    expect(admin.state.status).toBe('active');
    expect(admin.state.eventInserts).toHaveLength(0);
    expect(admin.state.updateFilters.get('last_advanced_at')).toBe(
      STALE_ADVANCE
    );
  });

  it('times out a run whose observed advance timestamp is still current', async () => {
    const admin = makeAdmin(STALE_ADVANCE);
    h.supabaseAdmin.mockReturnValue(admin.client);

    const response = await GET(
      new Request('https://desk.example/api/flows/cron')
    );

    expect(await response.json()).toEqual({ swept: 1 });
    expect(admin.state.status).toBe('timed_out');
    expect(admin.state.eventInserts).toEqual([
      expect.objectContaining({
        flow_run_id: RUN_ID,
        event_type: 'timeout',
      }),
    ]);
  });
});
