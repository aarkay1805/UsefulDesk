import type { SupabaseClient } from '@supabase/supabase-js';

/** Confirm a contact edit before updating any client-side display. */
export async function updateContact(
  client: SupabaseClient,
  contactId: string,
  fields: Record<string, string | null>
): Promise<void> {
  const { data, error } = await client
    .from('contacts')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', contactId)
    .select('id');
  if (error) throw error;
  if (!data?.some((row) => row.id === contactId)) {
    throw new Error('Could not save. Refresh the page and try again.');
  }
}
