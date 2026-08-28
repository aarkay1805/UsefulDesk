import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DASHBOARD_ACTION_LIST_LIMIT,
  loadDashboardActionDateContext,
  loadDashboardActionSnapshot,
  parseDashboardActionSnapshot,
  selectDashboardActionSection,
} from './action-snapshot';

const context = { timeZone: 'Asia/Kolkata', today: '2026-08-27' };

function validPayload() {
  const lead = {
    id: 'follow-up-1',
    contact_id: 'contact-1',
    membership_id: null,
    task_type: 'call',
    reason: 'other',
    due_date: '2026-08-27',
    remind_at: null,
    assigned_to: 'user-1',
    note: null,
    contact: { name: 'Lead One', phone: null, avatar_url: null },
  };
  return {
    today: context.today,
    gymMetrics: {
      expiring7: 2,
      feesDueCount: 3,
      feesDueAmount: 4000,
      collectedToday: 5000,
      collectionDailyAverage7d: 4500,
      missedVisitRisk: 1,
      neverVisitedRisk: 1,
    },
    followUps: {
      counts: { all: 1, lead: 1, member: 0 },
      rows: { all: [lead], lead: [lead], member: [] },
      staff: [{ user_id: 'user-1', full_name: 'Owner', avatar_url: null }],
    },
    expiringMemberships: {
      total: 1,
      rows: [
        {
          id: 'membership-1',
          end_date: '2026-08-29',
          contact: { name: 'Member One', phone: null, avatar_url: null },
          plan: { name: 'Monthly', plan_type: 'recurring' },
        },
      ],
    },
    uncontactedLeads: {
      total: 1,
      rows: [
        {
          id: 'contact-2',
          name: 'Lead Two',
          avatarUrl: null,
          messagePreview: 'No message yet',
          waitingDays: 2,
        },
      ],
    },
    attention: { churnRisk: 3, trialFollowups: 2, failedMandates: 1 },
    errors: [],
  };
}

function rpcDb(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}

afterEach(() => vi.restoreAllMocks());

describe('dashboard action snapshot', () => {
  it('derives today from the authorized selected branch timezone', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { timezone: 'America/New_York' },
      error: null,
    });
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    await expect(
      loadDashboardActionDateContext(
        { from } as unknown as SupabaseClient,
        'account-1',
        new Date('2026-08-27T01:00:00.000Z')
      )
    ).resolves.toEqual({
      timeZone: 'America/New_York',
      today: '2026-08-26',
    });
    expect(from).toHaveBeenCalledWith('accounts');
    expect(eq).toHaveBeenCalledWith('id', 'account-1');
  });

  it('loads and validates all five bounded sections through exactly one RPC', async () => {
    const { db, rpc } = rpcDb({ data: validPayload(), error: null });
    const now = new Date('2026-08-27T12:00:00.000Z');
    const timingSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const snapshot = await loadDashboardActionSnapshot(db, context, now);

    expect(snapshot).toEqual(validPayload());
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('dashboard_action_snapshot', {
      p_today: context.today,
      p_time_zone: context.timeZone,
      p_now: now.toISOString(),
      p_limit: DASHBOARD_ACTION_LIST_LIMIT,
    });
    expect(timingSpy).toHaveBeenCalledWith('[dashboard timing]', {
      stage: 'actions.snapshot',
      status: 'ok',
      durationMs: expect.any(Number),
    });
  });

  it('turns malformed or unbounded section data into a section-local error', () => {
    const payload = validPayload();
    payload.expiringMemberships.rows = Array.from(
      { length: DASHBOARD_ACTION_LIST_LIMIT + 1 },
      () => payload.expiringMemberships.rows[0]
    );

    const snapshot = parseDashboardActionSnapshot(payload);
    const followUps = selectDashboardActionSection(snapshot, 'followUps');
    const expiring = selectDashboardActionSection(
      snapshot,
      'expiringMemberships'
    );

    expect(snapshot.followUps).not.toBeNull();
    expect(snapshot.expiringMemberships).toBeNull();
    expect(snapshot.errors).toEqual(['expiringMemberships']);
    expect(followUps.followUps?.staff[0]?.full_name).toBe('Owner');
    expect(followUps.errors).toEqual([]);
    expect(expiring.expiringMemberships).toBeNull();
    expect(expiring.errors).toEqual(['expiringMemberships']);
  });

  it('preserves zero counts, empty queues, and null section failure semantics', () => {
    const payload = {
      ...validPayload(),
      gymMetrics: {
        expiring7: 0,
        feesDueCount: 0,
        feesDueAmount: 0,
        collectedToday: 0,
        collectionDailyAverage7d: 0,
        missedVisitRisk: 0,
        neverVisitedRisk: 0,
      },
      followUps: {
        counts: { all: 0, lead: 0, member: 0 },
        rows: { all: [], lead: [], member: [] },
        staff: [],
      },
      expiringMemberships: { rows: [], total: 0 },
      uncontactedLeads: { rows: [], total: 0 },
      attention: null,
      errors: ['attention'],
    };

    expect(parseDashboardActionSnapshot(payload)).toEqual(payload);
  });

  it('returns fixed-label failures for all sections when the one RPC fails', async () => {
    const { db } = rpcDb({ data: null, error: new Error('private detail') });
    const timingSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const snapshot = await loadDashboardActionSnapshot(db, context);

    expect(snapshot.errors).toEqual([
      'gymMetrics',
      'followUps',
      'expiringMemberships',
      'uncontactedLeads',
      'attention',
    ]);
    expect(timingSpy).toHaveBeenCalledWith('[dashboard timing]', {
      stage: 'actions.snapshot',
      status: 'error',
      durationMs: expect.any(Number),
    });
    expect(JSON.stringify(timingSpy.mock.calls)).not.toContain(
      'private detail'
    );
  });
});
