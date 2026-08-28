import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import {
  RENEWAL_PAGE_SIZE,
  loadRenewalQueueCount,
  loadRenewalQueuePage,
} from './renewal-queue';

type QueryResult = {
  data: unknown[] | null;
  count: number | null;
  error: Error | null;
};

type RecordedCall = [method: string, ...args: unknown[]];

class RecordingQuery implements PromiseLike<QueryResult> {
  calls: RecordedCall[] = [];

  constructor(private readonly result: QueryResult) {}

  private record(method: string, args: unknown[]) {
    this.calls.push([method, ...args]);
    return this;
  }

  select(...args: unknown[]) {
    return this.record('select', args);
  }
  eq(...args: unknown[]) {
    return this.record('eq', args);
  }
  gte(...args: unknown[]) {
    return this.record('gte', args);
  }
  lte(...args: unknown[]) {
    return this.record('lte', args);
  }
  lt(...args: unknown[]) {
    return this.record('lt', args);
  }
  order(...args: unknown[]) {
    return this.record('order', args);
  }
  range(...args: unknown[]) {
    return this.record('range', args);
  }
  then<Resolved = QueryResult, Rejected = never>(
    onFulfilled?:
      ((value: QueryResult) => Resolved | PromiseLike<Resolved>) | null,
    onRejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null
  ): PromiseLike<Resolved | Rejected> {
    return Promise.resolve(this.result).then(onFulfilled, onRejected);
  }
}

function database(result: QueryResult) {
  const query = new RecordingQuery(result);
  return {
    db: { from: () => query } as unknown as SupabaseClient,
    query,
  };
}

describe('loadRenewalQueuePage', () => {
  it('loads only the requested upcoming window with exact fields and pagination', async () => {
    const { db, query } = database({ data: [], count: 81, error: null });

    await expect(
      loadRenewalQueuePage(db, {
        accountId: 'account-1',
        bucket: 'expiring',
        days: 7,
        today: '2026-08-28',
        page: 1,
      })
    ).resolves.toEqual({ rows: [], total: 81 });

    expect(query.calls[0]).toEqual([
      'select',
      expect.not.stringContaining('*'),
      { count: 'exact' },
    ]);
    expect(query.calls).toContainEqual(['eq', 'account_id', 'account-1']);
    expect(query.calls).toContainEqual([
      'eq',
      'membership_plans.plan_type',
      'recurring',
    ]);
    expect(query.calls).toContainEqual(['gte', 'end_date', '2026-08-28']);
    expect(query.calls).toContainEqual(['lte', 'end_date', '2026-09-04']);
    expect(query.calls).toContainEqual([
      'range',
      RENEWAL_PAGE_SIZE,
      RENEWAL_PAGE_SIZE * 2 - 1,
    ]);
  });

  it('bounds expired queues when a lookback is selected', async () => {
    const { db, query } = database({ data: [], count: 0, error: null });

    await loadRenewalQueuePage(db, {
      accountId: 'account-1',
      bucket: 'expired',
      days: 30,
      today: '2026-08-28',
      page: 0,
    });

    expect(query.calls).toContainEqual(['lt', 'end_date', '2026-08-28']);
    expect(query.calls).toContainEqual(['gte', 'end_date', '2026-07-29']);
    expect(query.calls).toContainEqual(['range', 0, RENEWAL_PAGE_SIZE - 1]);
  });

  it('surfaces database failures', async () => {
    const error = new Error('renewals unavailable');
    const { db } = database({ data: null, count: null, error });

    await expect(
      loadRenewalQueuePage(db, {
        accountId: 'account-1',
        bucket: 'expired',
        days: null,
        today: '2026-08-28',
        page: 0,
      })
    ).rejects.toBe(error);
  });
});

describe('loadRenewalQueueCount', () => {
  it('counts the inactive bucket without fetching rows', async () => {
    const { db, query } = database({ data: null, count: 14, error: null });

    await expect(
      loadRenewalQueueCount(db, {
        accountId: 'account-1',
        bucket: 'expired',
        days: null,
        today: '2026-08-28',
      })
    ).resolves.toBe(14);

    expect(query.calls[0]).toEqual([
      'select',
      'id, plan:membership_plans!inner(id)',
      { count: 'exact', head: true },
    ]);
    expect(query.calls).not.toContainEqual([
      'range',
      expect.anything(),
      expect.anything(),
    ]);
  });
});
