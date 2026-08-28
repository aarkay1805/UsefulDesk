import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  loadGymStats: vi.fn(),
  loadFollowUps: vi.fn(),
  loadOwnerAttention: vi.fn(),
}));

vi.mock('@/lib/memberships/stats', () => ({
  loadGymStats: h.loadGymStats,
}));
vi.mock('./follow-ups', () => ({
  loadDashboardFollowUpSnapshot: h.loadFollowUps,
}));
vi.mock('@/lib/reports/reporting', () => ({
  loadOwnerAttention: h.loadOwnerAttention,
}));

import {
  DASHBOARD_ACTION_LIST_LIMIT,
  DASHBOARD_MESSAGE_PREVIEW_LIMIT,
  loadDashboardActionDateContext,
  loadDashboardActionSnapshot,
} from './action-snapshot';

type QueryResult = {
  data: unknown;
  count?: number | null;
  error: unknown;
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

  is(...args: unknown[]) {
    return this.record('is', args);
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

  in(...args: unknown[]) {
    return this.record('in', args);
  }

  order(...args: unknown[]) {
    return this.record('order', args);
  }

  limit(...args: unknown[]) {
    return this.record('limit', args);
  }

  maybeSingle() {
    this.calls.push(['maybeSingle']);
    return Promise.resolve(this.result);
  }

  then<Resolved = QueryResult, Rejected = never>(
    onFulfilled?:
      ((value: QueryResult) => Resolved | PromiseLike<Resolved>) | null,
    onRejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null
  ): PromiseLike<Resolved | Rejected> {
    return Promise.resolve(this.result).then(onFulfilled, onRejected);
  }
}

function actionDb(results: Record<string, QueryResult[]>) {
  const queries: Record<string, RecordingQuery[]> = {};
  const db = {
    from(table: string) {
      const tableQueries = (queries[table] ??= []);
      const result = results[table]?.[tableQueries.length];
      if (!result) throw new Error(`Unexpected ${table} query`);
      const query = new RecordingQuery(result);
      tableQueries.push(query);
      return query;
    },
  } as unknown as SupabaseClient;
  return { db, queries };
}

function membership(id: string, endDate: string) {
  return {
    id,
    end_date: endDate,
    contact: { name: id, phone: null, avatar_url: null },
    plan: { name: 'Monthly', plan_type: 'recurring' },
  };
}

function staleLead(index: number) {
  return {
    id: `lead-${index}`,
    name: `Lead ${index}`,
    avatar_url: null,
    created_at: '2026-08-20T00:00:00.000Z',
  };
}

const context = { timeZone: 'Asia/Kolkata', today: '2026-08-27' };

describe('dashboard action snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.loadGymStats.mockResolvedValue({ expiring7: 2 });
    h.loadFollowUps.mockResolvedValue({
      counts: { all: 2, lead: 1, member: 1 },
      rows: { all: [], lead: [], member: [] },
      staff: [],
    });
    h.loadOwnerAttention.mockResolvedValue({ churnRisk: 3 });
  });

  it('derives today from the selected branch timezone', async () => {
    const { db, queries } = actionDb({
      accounts: [{ data: { timezone: 'America/New_York' }, error: null }],
    });

    await expect(
      loadDashboardActionDateContext(
        db,
        'account-1',
        new Date('2026-08-27T01:00:00.000Z')
      )
    ).resolves.toEqual({
      timeZone: 'America/New_York',
      today: '2026-08-26',
    });
    expect(queries.accounts[0].calls).toContainEqual(['eq', 'id', 'account-1']);
  });

  it('bounds every row queue and preloads both follow-up scopes', async () => {
    const legacy = Array.from({ length: 6 }, (_, index) =>
      membership(`legacy-${index}`, `2026-08-${27 + (index % 2)}`)
    );
    const recurring = Array.from({ length: 6 }, (_, index) =>
      membership(`recurring-${index}`, `2026-08-${27 + (index % 2)}`)
    );
    const contacts = Array.from({ length: 12 }, (_, index) => staleLead(index));
    const conversations = contacts.slice(0, 8).map((lead) => ({
      contact_id: lead.id,
      last_message_text: 'x'.repeat(DASHBOARD_MESSAGE_PREVIEW_LIMIT + 40),
    }));
    const { db, queries } = actionDb({
      memberships: [
        { data: legacy, count: 6, error: null },
        { data: recurring, count: 6, error: null },
      ],
      contacts: [{ data: contacts, count: 12, error: null }],
      conversations: [{ data: conversations, error: null }],
    });

    const snapshot = await loadDashboardActionSnapshot(
      db,
      'account-1',
      context,
      new Date('2026-08-27T12:00:00.000Z')
    );

    expect(snapshot.expiringMemberships).toMatchObject({ total: 12 });
    expect(snapshot.expiringMemberships?.rows).toHaveLength(
      DASHBOARD_ACTION_LIST_LIMIT
    );
    expect(snapshot.uncontactedLeads).toMatchObject({ total: 12 });
    expect(snapshot.uncontactedLeads?.rows).toHaveLength(
      DASHBOARD_ACTION_LIST_LIMIT
    );
    expect(snapshot.uncontactedLeads?.rows[0]?.messagePreview.length).toBe(
      DASHBOARD_MESSAGE_PREVIEW_LIMIT
    );
    expect(h.loadFollowUps).toHaveBeenCalledWith(
      db,
      'account-1',
      DASHBOARD_ACTION_LIST_LIMIT
    );
    expect(queries.memberships).toHaveLength(2);
    expect(queries.memberships[0].calls).toContainEqual([
      'limit',
      DASHBOARD_ACTION_LIST_LIMIT,
    ]);
    expect(queries.memberships[0].calls).toContainEqual([
      'is',
      'plan_id',
      null,
    ]);
    expect(queries.memberships[1].calls).toContainEqual([
      'limit',
      DASHBOARD_ACTION_LIST_LIMIT,
    ]);
    expect(queries.memberships[1].calls).toContainEqual([
      'eq',
      'membership_plans.plan_type',
      'recurring',
    ]);
    expect(queries.contacts[0].calls).toContainEqual([
      'limit',
      DASHBOARD_ACTION_LIST_LIMIT,
    ]);
    expect(queries.conversations[0].calls).toContainEqual([
      'limit',
      DASHBOARD_ACTION_LIST_LIMIT,
    ]);
  });

  it('keeps successful sections when the expiring queue fails', async () => {
    const expiringError = new Error('expiring unavailable');
    const { db } = actionDb({
      memberships: [
        { data: null, count: null, error: expiringError },
        { data: [], count: 0, error: null },
      ],
      contacts: [{ data: [], count: 0, error: null }],
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const snapshot = await loadDashboardActionSnapshot(
      db,
      'account-1',
      context,
      new Date('2026-08-27T12:00:00.000Z')
    );

    expect(snapshot.gymMetrics).toEqual({ expiring7: 2 });
    expect(snapshot.followUps).not.toBeNull();
    expect(snapshot.expiringMemberships).toBeNull();
    expect(snapshot.uncontactedLeads).toEqual({ rows: [], total: 0 });
    expect(snapshot.attention).toEqual({ churnRisk: 3 });
    expect(snapshot.errors).toEqual(['expiringMemberships']);
    expect(errorSpy).toHaveBeenCalledOnce();
  });
});
