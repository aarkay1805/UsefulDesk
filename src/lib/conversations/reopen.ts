import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Reopen a thread when its customer writes again. The current-status filter is
 * the compare-and-set guard: pending/open (or any future state) is never
 * overwritten from a stale webhook snapshot.
 */
export async function reopenClosedConversation(
  db: SupabaseClient,
  conversation: { id: string; status?: string | null }
): Promise<boolean> {
  if (conversation.status !== 'closed') return false;

  const { data, error } = await db
    .from('conversations')
    .update({ status: 'open', updated_at: new Date().toISOString() })
    .eq('id', conversation.id)
    .eq('status', 'closed')
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Error re-opening conversation:', error);
    return false;
  }

  return Boolean(data);
}
