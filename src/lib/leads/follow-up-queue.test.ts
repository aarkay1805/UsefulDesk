import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  buildLeadAccountabilityRows,
  rowsForLeadAccountabilityView,
} from './accountability';
import { loadLeadFollowUpQueue } from './follow-up-queue';

function row(id: string, stage: string | null) {
  return {
    id,
    contact_id: id,
    membership_id: null,
    status: 'open',
    due_date: '2026-09-28',
    assigned_to: null,
    task_type: 'call',
    reason: 'other',
    contact: {
      id,
      name: id,
      phone: '',
      lead_status: stage,
      assigned_to: 'someone-else',
      created_at: '2026-09-27T12:00:00Z',
      lead_status_changed_at: null,
    },
  };
}

function client(batches: unknown[][]) {
  const requests: URL[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    requests.push(new URL(String(input)));
    return new Response(JSON.stringify(batches.shift() ?? []), {
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const db = createClient('https://fixture.supabase.co', 'fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
  return { db, requests, fetch };
}

describe('Home → enquiry Follow-ups cohort', () => {
  it('keeps open work for Not joining and converted contacts, including unassigned work', async () => {
    const { db, requests } = client([
      [
        row('not-joining', 'lost'),
        row('membership-customer', 'contacted'),
        row('service-customer', null),
      ],
    ]);
    const { leads, followUps } = await loadLeadFollowUpQueue(db);
    const rows = rowsForLeadAccountabilityView(
      buildLeadAccountabilityRows(leads, followUps, {
        today: '2026-09-28',
        now: '2026-09-28T12:00:00Z',
        scope: 'team',
        userId: 'owner',
      }),
      'followups'
    );
    expect(new Set(rows.map(({ lead }) => lead.id))).toEqual(
      new Set(['not-joining', 'membership-customer', 'service-customer'])
    );
    expect(rows.every(({ ownerId }) => ownerId === null)).toBe(true);
    expect(requests).toHaveLength(1);
    const query = requests[0].searchParams;
    expect(requests[0].pathname).toBe('/rest/v1/follow_ups');
    expect(query.get('status')).toBe('eq.open');
    expect(query.get('membership_id')).toBe('is.null');
    expect(query.get('select')).not.toMatch(
      /memberships|member_services|!inner/
    );
    expect(query.has('contact.lead_status')).toBe(false);
  });

  it('continues past a full batch with stable ordering', async () => {
    const { db, requests } = client([
      Array.from({ length: 500 }, (_, i) => row(`task-${i}`, null)),
      [row('last-task', 'lost')],
    ]);
    const result = await loadLeadFollowUpQueue(db);
    expect(result.followUps).toHaveLength(501);
    expect(requests[1].searchParams.get('offset')).toBe('500');
    expect(requests[1].searchParams.get('order')).toBe('due_date.asc,id.asc');
  });

  it('surfaces read failures instead of returning an empty queue', async () => {
    const db = createClient('https://fixture.supabase.co', 'fixture-key', {
      auth: { persistSession: false },
      global: {
        fetch: async () =>
          new Response(
            JSON.stringify({ message: 'fixture failure', code: 'XX000' }),
            { status: 500 }
          ),
      },
    });
    await expect(loadLeadFollowUpQueue(db)).rejects.toMatchObject({
      message: 'fixture failure',
    });
  });
});
