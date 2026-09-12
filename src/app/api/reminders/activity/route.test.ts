import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  requireSettingsAccess: vi.fn(),
  calls: [] as unknown[][],
  rows: [] as unknown[],
}));

vi.mock('@/lib/auth/account', () => ({
  requireSettingsAccess: h.requireSettingsAccess,
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : 'failed' },
      { status: 500 }
    ),
}));

function db() {
  return {
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: (...args: unknown[]) => {
          h.calls.push([table, 'eq', ...args]);
          return builder;
        },
        gte: (...args: unknown[]) => {
          h.calls.push([table, 'gte', ...args]);
          return builder;
        },
        lt: (...args: unknown[]) => {
          h.calls.push([table, 'lt', ...args]);
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        or: (...args: unknown[]) => {
          h.calls.push([table, 'or', ...args]);
          return builder;
        },
        maybeSingle: async () => ({
          data: { timezone: 'Asia/Kolkata' },
          error: null,
        }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({
            data: table === 'automated_message_activity' ? h.rows : [],
            error: null,
          }).then(resolve),
      };
      return builder;
    },
  };
}

import { GET } from './route';

describe('GET /api/reminders/activity', () => {
  beforeEach(() => {
    h.calls = [];
    h.rows = [];
    h.requireSettingsAccess.mockResolvedValue({
      accountId: 'account-1',
      supabase: db(),
    });
  });

  it('scopes the view to the selected branch and applies date filters before its limit', async () => {
    const response = await GET(
      new NextRequest(
        'https://desk.test/api/reminders/activity?from=2026-09-12&to=2026-09-12&outcome=accepted'
      )
    );
    expect(response.status).toBe(200);
    expect(h.calls).toContainEqual([
      'automated_message_activity',
      'eq',
      'account_id',
      'account-1',
    ]);
    expect(h.calls).toContainEqual([
      'automated_message_activity',
      'eq',
      'outcome',
      'accepted',
    ]);
    expect(
      h.calls.some(
        (call) => call[0] === 'automated_message_activity' && call[1] === 'gte'
      )
    ).toBe(true);
  });

  it('rejects hostile cursors rather than treating them as a first page', async () => {
    const response = await GET(
      new NextRequest(
        'https://desk.test/api/reminders/activity?cursor=bad.or%28account_id.eq.other%29'
      )
    );
    expect(response.status).toBe(400);
  });

  it('returns a bounded first page and preserves a microsecond cursor for the next keyset page', async () => {
    h.rows = Array.from({ length: 31 }, (_, index) => ({
      activity_id: `lifecycle:123e4567-e89b-42d3-a456-4266141740${String(index).padStart(2, '0')}`,
      occurred_at:
        index === 29
          ? '2026-09-12T10:20:30.123456+00:00'
          : `2026-09-12T10:20:${String(59 - index).padStart(2, '0')}.000000+00:00`,
    }));
    const first = await GET(
      new NextRequest('https://desk.test/api/reminders/activity')
    );
    const body = await first.json();
    expect(body.items).toHaveLength(30);
    expect(body.nextCursor).toBeTruthy();
    const second = await GET(
      new NextRequest(
        `https://desk.test/api/reminders/activity?cursor=${encodeURIComponent(body.nextCursor)}`
      )
    );
    expect(second.status).toBe(200);
    expect(
      h.calls.some(
        (call) =>
          call[0] === 'automated_message_activity' &&
          call[1] === 'or' &&
          String(call[2]).includes('123456+00:00')
      )
    ).toBe(true);
  });

  it('uses the settings boundary before querying activity', async () => {
    h.requireSettingsAccess.mockRejectedValueOnce(new Error('denied'));
    const response = await GET(
      new NextRequest('https://desk.test/api/reminders/activity')
    );
    expect(response.status).toBe(500);
    expect(h.calls).toHaveLength(0);
  });
});
