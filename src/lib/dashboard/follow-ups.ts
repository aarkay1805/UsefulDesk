import type { SupabaseClient } from '@supabase/supabase-js';

import type { FollowUp } from '@/types';

export type DashboardFollowUpMode = 'due' | 'upcoming';
export type DashboardFollowUpContext = 'lead' | 'member';

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

export interface DashboardFollowUpResult {
  rows: DashboardFollowUpRow[];
  total: number;
  mode: DashboardFollowUpMode;
}

const COLUMNS =
  'id, contact_id, membership_id, task_type, reason, due_date, remind_at, assigned_to, note, contact:contacts(name, phone, avatar_url)';

/**
 * Load a focused dashboard follow-up queue for leads or members.
 *
 * Due and overdue work always wins. Only an empty due result triggers a
 * second query for the nearest upcoming work, so future tasks never displace
 * something that needs action today.
 */
export async function loadDashboardFollowUps(
  db: SupabaseClient,
  today: string,
  limit: number,
  context: DashboardFollowUpContext = 'lead'
): Promise<DashboardFollowUpResult> {
  let dueQuery = db
    .from('follow_ups')
    .select(COLUMNS, { count: 'exact' })
    .eq('status', 'open');
  dueQuery =
    context === 'lead'
      ? dueQuery.is('membership_id', null)
      : dueQuery.not('membership_id', 'is', null);
  const dueResult = await dueQuery
    .lte('due_date', today)
    .order('due_date', { ascending: true })
    .limit(limit);

  if (dueResult.error) throw dueResult.error;

  const dueRows = (dueResult.data ?? []) as unknown as DashboardFollowUpRow[];
  if (dueRows.length > 0) {
    return {
      rows: dueRows,
      total: dueResult.count ?? 0,
      mode: 'due',
    };
  }

  let upcomingQuery = db
    .from('follow_ups')
    .select(COLUMNS, { count: 'exact' })
    .eq('status', 'open');
  upcomingQuery =
    context === 'lead'
      ? upcomingQuery.is('membership_id', null)
      : upcomingQuery.not('membership_id', 'is', null);
  const upcomingResult = await upcomingQuery
    .gt('due_date', today)
    .order('due_date', { ascending: true })
    .order('remind_at', { ascending: true, nullsFirst: false })
    .limit(limit);

  if (upcomingResult.error) throw upcomingResult.error;

  return {
    rows: (upcomingResult.data ?? []) as unknown as DashboardFollowUpRow[],
    total: upcomingResult.count ?? 0,
    mode: 'upcoming',
  };
}
