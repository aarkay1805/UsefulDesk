import type { Contact, FollowUp } from '@/types';

export const FIRST_RESPONSE_HOURS = 24;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type LeadAccountabilityIssue =
  | 'overdue'
  | 'due_today'
  | 'first_response_overdue'
  | 'missing_next_action'
  | 'upcoming';

export type LeadAccountabilityScope = 'mine' | 'team';
export type LeadAccountabilityView = 'followups' | 'first_response';

export type AccountabilityLead = Pick<
  Contact,
  | 'id'
  | 'name'
  | 'phone'
  | 'avatar_url'
  | 'lead_status'
  | 'lead_status_changed_at'
  | 'assigned_to'
  | 'created_at'
>;

export type AccountabilityFollowUp = Pick<
  FollowUp,
  | 'id'
  | 'contact_id'
  | 'membership_id'
  | 'assigned_to'
  | 'created_by'
  | 'reason'
  | 'task_type'
  | 'due_date'
  | 'status'
  | 'outcome'
  | 'note'
  | 'completed_at'
  | 'created_at'
  | 'updated_at'
>;

export interface LeadAccountabilityRow {
  lead: AccountabilityLead;
  followUp: AccountabilityFollowUp | null;
  ownerId: string | null;
  issues: LeadAccountabilityIssue[];
  primaryIssue: LeadAccountabilityIssue;
  stageAgeDays: number;
}

export interface LeadAccountabilitySummary {
  overdue: number;
  dueToday: number;
  firstResponseOverdue: number;
  missingNextAction: number;
  unassigned: number;
}

function ageDays(value: string | null | undefined, nowMs: number): number {
  if (!value) return 0;
  const at = new Date(value).getTime();
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, Math.floor((nowMs - at) / MS_PER_DAY));
}

function issueRank(issue: LeadAccountabilityIssue): number {
  switch (issue) {
    case 'overdue':
      return 0;
    case 'first_response_overdue':
      return 1;
    case 'due_today':
      return 2;
    case 'missing_next_action':
      return 3;
    case 'upcoming':
      return 4;
  }
}

/**
 * Build one actionable row per active lead. The open follow-up owns the work
 * when one exists; otherwise the lead assignee owns the missing-follow-up
 * exception. "Won" leads are already removed from the lead pool by gaining a
 * membership, while Lost is the only terminal lead status kept in contacts.
 */
export function buildLeadAccountabilityRows(
  leads: AccountabilityLead[],
  followUps: AccountabilityFollowUp[],
  options: {
    today: string;
    now: string | Date;
    scope: LeadAccountabilityScope;
    userId: string | null;
  }
): LeadAccountabilityRow[] {
  const nowMs =
    options.now instanceof Date
      ? options.now.getTime()
      : new Date(options.now).getTime();
  const firstResponseCutoff = nowMs - FIRST_RESPONSE_HOURS * 60 * 60 * 1000;

  const openByContact = new Map<string, AccountabilityFollowUp>();
  for (const followUp of followUps) {
    if (followUp.status !== 'open' || followUp.membership_id) continue;
    const current = openByContact.get(followUp.contact_id);
    if (!current || followUp.due_date < current.due_date) {
      openByContact.set(followUp.contact_id, followUp);
    }
  }

  const rows: LeadAccountabilityRow[] = [];
  for (const lead of leads) {
    if (lead.lead_status === 'lost') continue;

    const followUp = openByContact.get(lead.id) ?? null;
    // A task can deliberately be assigned to someone other than the lead's
    // general owner, so the task owner is authoritative while it is open.
    const ownerId = followUp
      ? (followUp.assigned_to ?? null)
      : (lead.assigned_to ?? null);
    if (
      options.scope === 'mine' &&
      (!options.userId || ownerId !== options.userId)
    ) {
      continue;
    }

    const issues: LeadAccountabilityIssue[] = [];
    if (followUp) {
      if (followUp.due_date < options.today) issues.push('overdue');
      else if (followUp.due_date === options.today) issues.push('due_today');
      else issues.push('upcoming');
    } else {
      issues.push('missing_next_action');
    }

    const createdMs = new Date(lead.created_at).getTime();
    if (
      lead.lead_status == null &&
      Number.isFinite(createdMs) &&
      createdMs <= firstResponseCutoff
    ) {
      issues.push('first_response_overdue');
    }

    const primaryIssue = [...issues].sort(
      (a, b) => issueRank(a) - issueRank(b)
    )[0];
    rows.push({
      lead,
      followUp,
      ownerId,
      issues,
      primaryIssue,
      stageAgeDays: ageDays(
        lead.lead_status_changed_at ?? lead.created_at,
        nowMs
      ),
    });
  }

  return rows.sort((a, b) => {
    const issueOrder = issueRank(a.primaryIssue) - issueRank(b.primaryIssue);
    if (issueOrder !== 0) return issueOrder;
    if (a.followUp && b.followUp) {
      const dueOrder = a.followUp.due_date.localeCompare(b.followUp.due_date);
      if (dueOrder !== 0) return dueOrder;
    }
    return a.lead.created_at.localeCompare(b.lead.created_at);
  });
}

export function summarizeLeadAccountability(
  rows: LeadAccountabilityRow[]
): LeadAccountabilitySummary {
  return rows.reduce<LeadAccountabilitySummary>(
    (summary, row) => {
      if (row.issues.includes('overdue')) summary.overdue += 1;
      if (row.issues.includes('due_today')) summary.dueToday += 1;
      if (row.issues.includes('first_response_overdue')) {
        summary.firstResponseOverdue += 1;
      }
      if (row.issues.includes('missing_next_action')) {
        summary.missingNextAction += 1;
      }
      if (!row.ownerId) summary.unassigned += 1;
      return summary;
    },
    {
      overdue: 0,
      dueToday: 0,
      firstResponseOverdue: 0,
      missingNextAction: 0,
      unassigned: 0,
    }
  );
}

/**
 * Keep the page-level queues conceptually separate: Follow-ups is only open
 * scheduled work, while First response is every lead still in the New stage.
 * A New lead with an open follow-up can intentionally appear in both queues.
 */
export function rowsForLeadAccountabilityView(
  rows: LeadAccountabilityRow[],
  view: LeadAccountabilityView
): LeadAccountabilityRow[] {
  if (view === 'followups') {
    return rows.filter((row) => row.followUp !== null);
  }

  return rows
    .filter((row) => row.lead.lead_status == null)
    .sort((a, b) => a.lead.created_at.localeCompare(b.lead.created_at));
}
