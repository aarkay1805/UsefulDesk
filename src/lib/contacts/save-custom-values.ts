import type { SupabaseClient } from '@supabase/supabase-js';

export async function saveContactCustomValues(
  client: SupabaseClient,
  contactId: string,
  values: Record<string, string>,
  previousValues: Record<string, string>
): Promise<void> {
  const changed = Object.entries(values)
    .map(([fieldId, value]) => [fieldId, value.trim()] as const)
    .filter(
      ([fieldId, value]) => value !== (previousValues[fieldId]?.trim() ?? '')
    );
  const rows = changed
    .filter(([, value]) => value)
    .map(([fieldId, value]) => ({
      contact_id: contactId,
      custom_field_id: fieldId,
      value,
    }));
  const clearedIds = changed
    .filter(([, value]) => !value)
    .map(([fieldId]) => fieldId);
  const failed = () =>
    new Error('Could not save. Refresh the page and try again.');

  // Replace in place: a failed write must not delete the previous values.
  if (rows.length > 0) {
    const { data, error } = await client
      .from('contact_custom_values')
      .upsert(rows, { onConflict: 'contact_id,custom_field_id' })
      .select('id, custom_field_id');
    if (error) throw error;
    if (
      !rows.every((row) =>
        data?.some((saved) => saved.custom_field_id === row.custom_field_id)
      )
    )
      throw failed();
  }
  // Clear only fields the user actually changed, preserving unseen fields.
  if (clearedIds.length > 0) {
    const { data, error } = await client
      .from('contact_custom_values')
      .delete()
      .eq('contact_id', contactId)
      .in('custom_field_id', clearedIds)
      .select('id, custom_field_id');
    if (error) throw error;
    if (
      !clearedIds.every((fieldId) =>
        data?.some((saved) => saved.custom_field_id === fieldId)
      )
    )
      throw failed();
  }
}
