import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import {
  loadDashboardFollowUpCounts,
  loadDashboardFollowUps,
  type DashboardFollowUpRow,
} from './follow-ups';

type QueryResult = {
  data: DashboardFollowUpRow[] | null;
  count: number | null;
  error: Error | null;
};

type RecordedCall = [method: string, ...args: unknown[]];

/**
 * A head-count query resolves without ever calling `.limit()`, so the recorder
 * has to be thenable as well as chainable.
 */
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

  is(...args: unknown[]) {
    return this.record('is', args);
  }

  not(...args: unknown[]) {
    return this.record('not', args);
  }

  order(...args: unknown[]) {
    return this.record('order', args);
  }

  limit(...args: unknown[]) {
    return this.record('limit', args);
  }

  then<Resolved = QueryResult, Rejected = never>(
    onFulfilled?:
      ((value: QueryResult) => Resolved | PromiseLike<Resolved>) | null,
    onRejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null
  ): PromiseLike<Resolved | Rejected> {
    return Promise.resolve(this.result).then(onFulfilled, onRejected);
  }
}

function followUp(
  id: string,
  dueDate: string,
  remindAt: string | null = null
): DashboardFollowUpRow {
  return {
    id,
    contact_id: `contact-${id}`,
    membership_id: null,
    task_type: 'call',
    reason: 'other',
    due_date: dueDate,
    remind_at: remindAt,
    assigned_to: null,
    note: null,
    contact: { name: `Lead ${id}`, phone: null, avatar_url: null },
  };
}

function database(...results: QueryResult[]) {
  const queries: RecordingQuery[] = [];
  const db = {
    from(table: string) {
      expect(table).toBe('follow_ups');
      const result = results[queries.length];
      if (!result) throw new Error('Unexpected follow-up query');
      const query = new RecordingQuery(result);
      queries.push(query);
      return query;
    },
  } as unknown as SupabaseClient;
  return { db, queries };
}

const LIMIT = 8;

describe('loadDashboardFollowUps', () => {
  it('returns one chronological list without filtering by date', async () => {
    const overdue = followUp('overdue', '2026-07-20');
    const upcoming = followUp('upcoming', '2026-08-02');
    const { db, queries } = database({
      data: [overdue, upcoming],
      count: null,
      error: null,
    });

    await expect(loadDashboardFollowUps(db, LIMIT)).resolves.toEqual([
      overdue,
      upcoming,
    ]);

    // One query, and no `lte`/`gt` on due_date — a date filter here is what
    // used to hide upcoming work behind a mode the caller could not see.
    expect(queries).toHaveLength(1);
    expect(queries[0].calls).toEqual([
      ['select', expect.stringContaining('membership_id')],
      ['eq', 'status', 'open'],
      ['order', 'due_date', { ascending: true }],
      ['order', 'remind_at', { ascending: true, nullsFirst: false }],
      ['limit', LIMIT],
    ]);
  });

  it('scopes lead work to follow-ups with no membership', async () => {
    const { db, queries } = database({ data: [], count: null, error: null });

    await loadDashboardFollowUps(db, LIMIT, 'lead');

    expect(queries[0].calls).toContainEqual(['is', 'membership_id', null]);
  });

  it('scopes member work to membership-linked follow-ups', async () => {
    const memberFollowUp = {
      ...followUp('member', '2026-07-25'),
      membership_id: 'membership-1',
    };
    const { db, queries } = database({
      data: [memberFollowUp],
      count: null,
      error: null,
    });

    await expect(loadDashboardFollowUps(db, LIMIT, 'member')).resolves.toEqual([
      memberFollowUp,
    ]);

    expect(queries[0].calls).toContainEqual([
      'not',
      'membership_id',
      'is',
      null,
    ]);
  });

  it('surfaces a failed query instead of returning an empty queue', async () => {
    const error = new Error('follow-up query failed');
    const { db } = database({ data: null, count: null, error });

    await expect(loadDashboardFollowUps(db, LIMIT)).rejects.toBe(error);
  });
});

describe('loadDashboardFollowUpCounts', () => {
  it('counts each scope separately and derives the total', async () => {
    const { db, queries } = database(
      { data: null, count: 9, error: null },
      { data: null, count: 14, error: null }
    );

    await expect(loadDashboardFollowUpCounts(db)).resolves.toEqual({
      all: 23,
      lead: 9,
      member: 14,
    });

    expect(queries[0].calls).toEqual([
      ['select', 'id', { count: 'exact', head: true }],
      ['eq', 'status', 'open'],
      ['is', 'membership_id', null],
    ]);
    expect(queries[1].calls).toContainEqual([
      'not',
      'membership_id',
      'is',
      null,
    ]);
  });

  it('treats a missing count as zero rather than NaN', async () => {
    const { db } = database(
      { data: null, count: null, error: null },
      { data: null, count: null, error: null }
    );

    await expect(loadDashboardFollowUpCounts(db)).resolves.toEqual({
      all: 0,
      lead: 0,
      member: 0,
    });
  });

  it('surfaces a failed count query', async () => {
    const error = new Error('count failed');
    const { db } = database(
      { data: null, count: null, error },
      { data: null, count: 3, error: null }
    );

    await expect(loadDashboardFollowUpCounts(db)).rejects.toBe(error);
  });
});
