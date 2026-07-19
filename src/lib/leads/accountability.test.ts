import { describe, expect, it } from 'vitest';

import type {
  AccountabilityFollowUp,
  AccountabilityLead,
} from './accountability';
import {
  buildLeadAccountabilityRows,
  rowsForLeadAccountabilityView,
  summarizeLeadAccountability,
} from './accountability';

const NOW = '2026-07-19T12:00:00.000Z';
const TODAY = '2026-07-19';

function lead(
  id: string,
  patch: Partial<AccountabilityLead> = {}
): AccountabilityLead {
  return {
    id,
    name: `Lead ${id}`,
    phone: `900000000${id}`,
    avatar_url: undefined,
    lead_status: 'contacted',
    lead_status_changed_at: '2026-07-18T12:00:00.000Z',
    assigned_to: 'rep-a',
    created_at: '2026-07-18T12:00:00.000Z',
    ...patch,
  };
}

function followUp(
  id: string,
  contactId: string,
  patch: Partial<AccountabilityFollowUp> = {}
): AccountabilityFollowUp {
  return {
    id,
    contact_id: contactId,
    membership_id: null,
    assigned_to: 'rep-a',
    created_by: 'owner',
    reason: 'other',
    task_type: 'call',
    due_date: TODAY,
    status: 'open',
    outcome: null,
    note: null,
    completed_at: null,
    created_at: '2026-07-18T12:00:00.000Z',
    updated_at: '2026-07-18T12:00:00.000Z',
    ...patch,
  };
}

describe('buildLeadAccountabilityRows', () => {
  it('prioritizes overdue work and keeps one row per active lead', () => {
    const rows = buildLeadAccountabilityRows(
      [lead('1'), lead('2'), lead('3')],
      [followUp('f1', '1', { due_date: '2026-07-18' }), followUp('f2', '2')],
      { today: TODAY, now: NOW, scope: 'team', userId: 'owner' }
    );

    expect(rows.map((row) => row.lead.id)).toEqual(['1', '2', '3']);
    expect(rows[0].primaryIssue).toBe('overdue');
    expect(rows[1].primaryIssue).toBe('due_today');
    expect(rows[2].primaryIssue).toBe('missing_next_action');
  });

  it('flags a New lead after 24 hours even when it has a future task', () => {
    const rows = buildLeadAccountabilityRows(
      [
        lead('1', {
          lead_status: null,
          created_at: '2026-07-18T11:59:59.000Z',
        }),
      ],
      [followUp('f1', '1', { due_date: '2026-07-21' })],
      { today: TODAY, now: NOW, scope: 'team', userId: 'owner' }
    );

    expect(rows[0].issues).toEqual(['upcoming', 'first_response_overdue']);
    expect(rows[0].primaryIssue).toBe('first_response_overdue');
  });

  it('uses the open task owner for My work instead of the lead owner', () => {
    const leads = [lead('1', { assigned_to: 'rep-a' })];
    const tasks = [followUp('f1', '1', { assigned_to: 'rep-b' })];

    expect(
      buildLeadAccountabilityRows(leads, tasks, {
        today: TODAY,
        now: NOW,
        scope: 'mine',
        userId: 'rep-a',
      })
    ).toHaveLength(0);
    expect(
      buildLeadAccountabilityRows(leads, tasks, {
        today: TODAY,
        now: NOW,
        scope: 'mine',
        userId: 'rep-b',
      })
    ).toHaveLength(1);
  });

  it('excludes Lost leads and member follow-ups', () => {
    const rows = buildLeadAccountabilityRows(
      [lead('1', { lead_status: 'lost' }), lead('2')],
      [followUp('f2', '2', { membership_id: 'membership-1' })],
      { today: TODAY, now: NOW, scope: 'team', userId: 'owner' }
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].lead.id).toBe('2');
    expect(rows[0].primaryIssue).toBe('missing_next_action');
  });
});

describe('summarizeLeadAccountability', () => {
  it('counts independent exception signals, including unassigned work', () => {
    const rows = buildLeadAccountabilityRows(
      [
        lead('1', { assigned_to: null }),
        lead('2', {
          lead_status: null,
          created_at: '2026-07-17T12:00:00.000Z',
        }),
      ],
      [followUp('f2', '2', { due_date: '2026-07-18' })],
      { today: TODAY, now: NOW, scope: 'team', userId: 'owner' }
    );

    expect(summarizeLeadAccountability(rows)).toEqual({
      overdue: 1,
      dueToday: 0,
      firstResponseOverdue: 1,
      missingNextAction: 1,
      unassigned: 1,
    });
  });
});

describe('rowsForLeadAccountabilityView', () => {
  it('keeps only open scheduled work in Follow-ups', () => {
    const rows = buildLeadAccountabilityRows(
      [lead('1'), lead('2')],
      [followUp('f1', '1')],
      { today: TODAY, now: NOW, scope: 'team', userId: 'owner' }
    );

    expect(
      rowsForLeadAccountabilityView(rows, 'followups').map(
        (row) => row.lead.id
      )
    ).toEqual(['1']);
  });

  it('keeps all New leads in First response and orders oldest first', () => {
    const rows = buildLeadAccountabilityRows(
      [
        lead('1', {
          lead_status: null,
          created_at: '2026-07-19T10:00:00.000Z',
        }),
        lead('2', { lead_status: 'contacted' }),
        lead('3', {
          lead_status: null,
          created_at: '2026-07-17T10:00:00.000Z',
        }),
      ],
      [followUp('f1', '1')],
      { today: TODAY, now: NOW, scope: 'team', userId: 'owner' }
    );

    expect(
      rowsForLeadAccountabilityView(rows, 'first_response').map(
        (row) => row.lead.id
      )
    ).toEqual(['3', '1']);
  });
});
