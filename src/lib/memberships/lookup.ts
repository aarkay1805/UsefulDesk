import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolve a contact to their membership id, if they have one.
 *
 * `UNIQUE(account_id, contact_id)` on memberships (migration 031)
 * guarantees at most one row, so `maybeSingle` is exact; RLS scopes the
 * read to the caller's account. Returns null for a contact who exists
 * but isn't a member yet.
 */
export async function membershipIdForContact(
  supabase: SupabaseClient,
  contactId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("memberships")
    .select("id")
    .eq("contact_id", contactId)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}
