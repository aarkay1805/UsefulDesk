import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import {
  loadGymStats,
  summarizeAttendanceRisk,
  summarizeCollections,
} from './stats';

function gymStatsDb(): SupabaseClient {
  const results: Record<string, unknown> = {
    member_activity: { data: [], error: null },
    memberships: {
      count: 3,
      data: [
        { id: 'recurring', plan: { plan_type: 'recurring' } },
        { id: 'fixed-term', plan: { plan_type: 'non_recurring' } },
        { id: 'session-pack', plan: { plan_type: 'session_pack' } },
      ],
      error: null,
    },
    membership_dues: { data: [], error: null },
    payments: { data: [], error: null },
  };

  return {
    from(table: string) {
      const query = {
        select: () => query,
        eq: () => query,
        gt: () => query,
        gte: () => query,
        lte: () => query,
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(results[table]).then(resolve),
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

describe('loadGymStats', () => {
  it('counts the same seven-day renewal chase shown by the destination', async () => {
    const stats = await loadGymStats(
      gymStatsDb(),
      '2026-08-14',
      'Asia/Kolkata'
    );

    expect(stats.expiring7).toBe(1);
  });

  it('surfaces a failed aggregate read instead of publishing zeroes', async () => {
    const error = new Error('payments unavailable');
    const db = gymStatsDb();
    const from = db.from.bind(db);
    db.from = ((table: string) => {
      if (table !== 'payments') return from(table);
      const query = {
        select: () => query,
        eq: () => query,
        gte: () => query,
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: null, error }).then(resolve),
      };
      return query;
    }) as typeof db.from;

    await expect(loadGymStats(db, '2026-08-14', 'Asia/Kolkata')).rejects.toBe(
      error
    );
  });
});

describe('summarizeAttendanceRisk', () => {
  it('separates missed visits from members who never checked in', () => {
    expect(
      summarizeAttendanceRisk(
        [
          { last_visit_at: '2026-07-14T03:30:00.000Z' },
          { last_visit_at: '2026-07-15T03:30:00.000Z' },
          { last_visit_at: null },
        ],
        '2026-07-24',
        'Asia/Kolkata'
      )
    ).toEqual({
      missedVisitRisk: 1,
      neverVisitedRisk: 1,
    });
  });

  it('uses the account-local visit day at timezone boundaries', () => {
    expect(
      summarizeAttendanceRisk(
        [{ last_visit_at: '2026-07-14T20:00:00.000Z' }],
        '2026-07-24',
        'Asia/Kolkata'
      )
    ).toEqual({
      missedVisitRisk: 0,
      neverVisitedRisk: 0,
    });
  });
});

describe('summarizeCollections', () => {
  it('compares today with the average of the seven complete prior days', () => {
    expect(
      summarizeCollections(
        [
          { amount: 700, paid_at: '2026-07-17T06:30:00.000Z' },
          { amount: 350, paid_at: '2026-07-23T06:30:00.000Z' },
          { amount: 500, paid_at: '2026-07-24T06:30:00.000Z' },
          { amount: 999, paid_at: '2026-07-16T06:30:00.000Z' },
        ],
        '2026-07-24',
        'Asia/Kolkata'
      )
    ).toEqual({
      collectedToday: 500,
      collectionDailyAverage7d: 150,
    });
  });
});
