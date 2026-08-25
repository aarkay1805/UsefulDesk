import type { SupabaseClient } from '@supabase/supabase-js';

import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { SendMessageError } from './send-message';

const OPEN_CONVERSATION_ERROR =
  'Failed to open a conversation for this contact';

async function findOldestConversation(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<{ id: string } | null> {
  const { data, error } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(
      '[resolve-contact-conversation] conversation lookup error:',
      error.message
    );
    throw new SendMessageError('db_error', OPEN_CONVERSATION_ERROR, 500);
  }
  return data;
}

/**
 * Resolve the canonical conversation for one already-known contact.
 *
 * The caller's Supabase client remains in force so contact and conversation
 * access stay subject to the same account RLS as the dashboard send route.
 * New rows retain the authenticated caller in `user_id` for audit. A unique
 * insert race is recovered by resolving the oldest winning row.
 */
export async function resolveContactConversation(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  contactId: string
): Promise<string> {
  const { data: contact, error: contactError } = await db
    .from('contacts')
    .select('id')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();

  // Preserve the generic send endpoint's deliberately indistinguishable
  // missing/cross-account response (including an RLS-hidden row).
  if (contactError || !contact) {
    throw new SendMessageError('not_found', 'Contact not found', 404);
  }

  const existing = await findOldestConversation(db, accountId, contactId);
  if (existing) return existing.id;

  const { data: created, error: createError } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: userId,
      contact_id: contactId,
    })
    .select('id')
    .single();

  if (!createError && created) return created.id;

  if (isUniqueViolation(createError)) {
    const winner = await findOldestConversation(db, accountId, contactId);
    if (winner) return winner.id;
  }

  console.error(
    '[resolve-contact-conversation] conversation create error:',
    createError?.message ?? 'insert returned no row'
  );
  throw new SendMessageError('db_error', OPEN_CONVERSATION_ERROR, 500);
}
