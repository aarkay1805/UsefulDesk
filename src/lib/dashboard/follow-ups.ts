import type { SupabaseClient } from '@supabase/supabase-js';

import type { FollowUp } from '@/types';

/** Which side of the business a follow-up belongs to. */
export type DashboardFollowUpScope = 'all' | 'lead' | 'member';

export interface DashboardFollowUpRow {
  id: string;
  contact_id: string;
  membership_id: string | null;
  task_type: FollowUp['task_type'];
  reason: FollowUp['reason'];
  due_date: string;
  remind_at: string | null;
  assigned_to: string | null;
  note: string | null;
  contact: {
    name: string | null;
    phone: string | null;
    avatar_url: string | null;
  } | null;
}

/** Open follow-ups per scope, for the queue's filter chips. */
export interface DashboardFollowUpCounts {
  all: number;
  lead: number;
  member: number;
}

const COLUMNS =
  'id, contact_id, membership_id, task_type, reason, due_date, remind_at, assigned_to, note, contact:contacts(name, phone, avatar_url)';

/**
 * One chronological page of open follow-ups — overdue first, then due today,
 * then upcoming, all in the same list.
 *
 * This deliberately does NOT filter by date. An earlier version queried only
 * due work and fell back to upcoming when that came back empty, which meant
 * the queue silently changed what it was showing and its heading had to change
 * with it. Ascending `due_date` already puts the late work on top, so the
 * caller can render one list and let each row state its own due state.
 */
export async function loadDashboardFollowUps(
  db: SupabaseClient,
  limit: number,
  scope: DashboardFollowUpScope = 'all'
): Promise<DashboardFollowUpRow[]> {
  const base = db.from('follow_ups').select(COLUMNS).eq('status', 'open');
  // A lead follow-up carries no membership; a member follow-up always does.
  const scoped =
    scope === 'lead'
      ? base.is('membership_id', null)
      : scope === 'member'
        ? base.not('membership_id', 'is', null)
        : base;

  const result = await scoped
    .order('due_date', { ascending: true })
    .order('remind_at', { ascending: true, nullsFirst: false })
    .limit(limit);

  if (result.error) throw result.error;
  return (result.data ?? []) as unknown as DashboardFollowUpRow[];
}

/**
 * Live open-follow-up totals for the queue chips. Counted separately from the
 * rows because the row query is capped at the dashboard's list limit, and a
 * chip must report the whole queue it filters to.
 */
export async function loadDashboardFollowUpCounts(
  db: SupabaseClient
): Promise<DashboardFollowUpCounts> {
  const open = () =>
    db
      .from('follow_ups')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open');

  const [leadResult, memberResult] = await Promise.all([
    open().is('membership_id', null),
    open().not('membership_id', 'is', null),
  ]);

  if (leadResult.error) throw leadResult.error;
  if (memberResult.error) throw memberResult.error;

  const lead = leadResult.count ?? 0;
  const member = memberResult.count ?? 0;
  return { all: lead + member, lead, member };
}
