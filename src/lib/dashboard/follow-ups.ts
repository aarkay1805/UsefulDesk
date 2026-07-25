import type { SupabaseClient } from '@supabase/supabase-js';

import type { FollowUp } from '@/types';

export type DashboardFollowUpMode = 'due' | 'upcoming';

export interface DashboardFollowUpRow {
  id: string;
  contact_id: string;
  task_type: FollowUp['task_type'];
  due_date: string;
  remind_at: string | null;
  assigned_to: string | null;
  note: string | null;
  contact: { name: string | null; phone: string | null } | null;
}

export interface DashboardFollowUpResult {
  rows: DashboardFollowUpRow[];
  total: number;
  mode: DashboardFollowUpMode;
}

const COLUMNS =
  'id, contact_id, task_type, due_date, remind_at, assigned_to, note, contact:contacts(name, phone)';

/**
 * Load the dashboard's focused lead follow-up queue.
 *
 * Due and overdue work always wins. Only an empty due result triggers a
 * second query for the nearest upcoming work, so future tasks never displace
 * something that needs action today.
 */
export async function loadDashboardFollowUps(
  db: SupabaseClient,
  today: string,
  limit: number
): Promise<DashboardFollowUpResult> {
  const dueResult = await db
    .from('follow_ups')
    .select(COLUMNS, { count: 'exact' })
    .eq('status', 'open')
    .is('membership_id', null)
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

  const upcomingResult = await db
    .from('follow_ups')
    .select(COLUMNS, { count: 'exact' })
    .eq('status', 'open')
    .is('membership_id', null)
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
