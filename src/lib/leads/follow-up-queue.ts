import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AccountabilityFollowUp,
  AccountabilityLead,
} from './accountability';

const BATCH_SIZE = 500;

type FollowUpWithContact = AccountabilityFollowUp & {
  contact: AccountabilityLead | null;
};

/**
 * Match Home's enquiry-follow-up cohort: open work with no membership_id.
 * The task survives a Not joining stage or a later membership/service sale.
 * Do not intersect it with today's active-enquiry directory.
 */
export async function loadLeadFollowUpQueue(db: SupabaseClient): Promise<{
  leads: AccountabilityLead[];
  followUps: AccountabilityFollowUp[];
}> {
  const rows: FollowUpWithContact[] = [];
  for (let from = 0; ; from += BATCH_SIZE) {
    const { data, error } = await db
      .from('follow_ups')
      .select(
        'id, contact_id, membership_id, assigned_to, created_by, reason, task_type, due_date, status, outcome, note, completed_at, created_at, updated_at, contact:contacts(id, name, phone, avatar_url, lead_status, lead_status_changed_at, assigned_to, created_at)'
      )
      .eq('status', 'open')
      .is('membership_id', null)
      .order('due_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + BATCH_SIZE - 1);
    if (error) throw error;
    const batch = (data ?? []) as unknown as FollowUpWithContact[];
    rows.push(...batch);
    if (batch.length < BATCH_SIZE) break;
  }
  return {
    leads: rows.flatMap(({ contact }) => (contact ? [contact] : [])),
    followUps: rows,
  };
}
