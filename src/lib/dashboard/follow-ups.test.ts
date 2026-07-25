import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import {
  loadDashboardFollowUps,
  type DashboardFollowUpRow,
} from './follow-ups';

type QueryResult = {
  data: DashboardFollowUpRow[] | null;
  count: number | null;
  error: Error | null;
};

type RecordedCall = [method: string, ...args: unknown[]];

class RecordingQuery {
  calls: RecordedCall[] = [];

  constructor(private readonly result: QueryResult) {}

  select(...args: unknown[]) {
    this.calls.push(['select', ...args]);
    return this;
  }

  eq(...args: unknown[]) {
    this.calls.push(['eq', ...args]);
    return this;
  }

  is(...args: unknown[]) {
    this.calls.push(['is', ...args]);
    return this;
  }

  not(...args: unknown[]) {
    this.calls.push(['not', ...args]);
    return this;
  }

  lte(...args: unknown[]) {
    this.calls.push(['lte', ...args]);
    return this;
  }

  gt(...args: unknown[]) {
    this.calls.push(['gt', ...args]);
    return this;
  }

  order(...args: unknown[]) {
    this.calls.push(['order', ...args]);
    return this;
  }

  limit(...args: unknown[]) {
    this.calls.push(['limit', ...args]);
    return Promise.resolve(this.result);
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

const TODAY = '2026-07-25';
const LIMIT = 8;

describe('loadDashboardFollowUps', () => {
  it('returns due work without querying upcoming follow-ups', async () => {
    const due = followUp('due', TODAY);
    const { db, queries } = database({
      data: [due],
      count: 3,
      error: null,
    });

    await expect(loadDashboardFollowUps(db, TODAY, LIMIT)).resolves.toEqual({
      rows: [due],
      total: 3,
      mode: 'due',
    });
    expect(queries).toHaveLength(1);
    expect(queries[0].calls).toEqual(
      expect.arrayContaining([
        ['eq', 'status', 'open'],
        ['is', 'membership_id', null],
        ['lte', 'due_date', TODAY],
        ['order', 'due_date', { ascending: true }],
        ['limit', LIMIT],
      ])
    );
  });

  it('falls back to upcoming work ordered by nearest date and time', async () => {
    const nearest = followUp(
      'nearest',
      '2026-07-26',
      '2026-07-26T03:30:00.000Z'
    );
    const later = followUp('later', '2026-07-27');
    const { db, queries } = database(
      { data: [], count: 0, error: null },
      { data: [nearest, later], count: 5, error: null }
    );

    await expect(loadDashboardFollowUps(db, TODAY, LIMIT)).resolves.toEqual({
      rows: [nearest, later],
      total: 5,
      mode: 'upcoming',
    });
    expect(queries).toHaveLength(2);
    expect(queries[1].calls).toEqual(
      expect.arrayContaining([
        ['eq', 'status', 'open'],
        ['is', 'membership_id', null],
        ['gt', 'due_date', TODAY],
        ['order', 'due_date', { ascending: true }],
        ['order', 'remind_at', { ascending: true, nullsFirst: false }],
        ['limit', LIMIT],
      ])
    );
  });

  it('does not hide a failed due query behind the upcoming fallback', async () => {
    const error = new Error('due query failed');
    const { db, queries } = database({
      data: null,
      count: null,
      error,
    });

    await expect(loadDashboardFollowUps(db, TODAY, LIMIT)).rejects.toBe(error);
    expect(queries).toHaveLength(1);
  });

  it('scopes member work to membership-linked follow-ups', async () => {
    const memberFollowUp = {
      ...followUp('member', TODAY),
      membership_id: 'membership-1',
    };
    const { db, queries } = database({
      data: [memberFollowUp],
      count: 1,
      error: null,
    });

    await expect(
      loadDashboardFollowUps(db, TODAY, LIMIT, 'member')
    ).resolves.toEqual({
      rows: [memberFollowUp],
      total: 1,
      mode: 'due',
    });

    expect(queries[0].calls).toContainEqual([
      'not',
      'membership_id',
      'is',
      null,
    ]);
    expect(queries[0].calls[0]).toEqual([
      'select',
      expect.stringContaining('membership_id'),
      { count: 'exact' },
    ]);
  });
});
