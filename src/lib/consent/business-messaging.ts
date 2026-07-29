import type { SupabaseClient } from '@supabase/supabase-js';

export type BusinessMessagePurpose =
  | 'broadcast'
  | 'renewal'
  | 'payment'
  | 'follow_up'
  | 'automation'
  | 'template'
  | 'api';

export class MessageSuppressedError extends Error {
  readonly code = 'message_suppressed';
  constructor() {
    super('This contact has opted out of proactive WhatsApp messages.');
    this.name = 'MessageSuppressedError';
  }
}

/**
 * Fail-closed organization suppression check. The database permits a later
 * opt-in only for the exact branch + purpose scope recorded by consent audit.
 */
export async function assertBusinessMessageAllowed(
  db: SupabaseClient,
  accountId: string,
  phone: string,
  purpose: BusinessMessagePurpose
): Promise<void> {
  const { data, error } = await db.rpc('business_message_allowed', {
    p_account_id: accountId,
    p_phone: phone,
    p_purpose: purpose,
  });
  if (error) {
    throw new Error(`Could not verify WhatsApp consent: ${error.message}`);
  }
  if (data !== true) throw new MessageSuppressedError();
}
