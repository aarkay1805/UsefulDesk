import type { SupabaseClient } from '@supabase/supabase-js';
import type { TemplateConsentScope } from '@/lib/whatsapp/template-contracts';

interface RecordTemplateConsentInput {
  accountId: string;
  contactId: string;
  scope: TemplateConsentScope;
  action: 'opt_in' | 'opt_out';
  source: string;
  evidenceNote: string;
}

export async function recordTemplateConsent(
  db: SupabaseClient,
  input: RecordTemplateConsentInput
): Promise<string> {
  const evidenceNote = input.evidenceNote.trim();
  if (!evidenceNote) throw new Error('Consent evidence note is required.');
  const source = input.source.trim();
  if (!source) throw new Error('Consent source is required.');

  const { data, error } = await db.rpc('record_contact_consent', {
    p_account_id: input.accountId,
    p_contact_id: input.contactId,
    p_purpose: input.scope,
    p_action: input.action,
    p_source: source,
    p_evidence: { note: evidenceNote },
  });
  if (error)
    throw new Error(`Could not record WhatsApp consent: ${error.message}`);
  if (typeof data !== 'string' || !data) {
    throw new Error(
      'Could not record WhatsApp consent: no audit event returned.'
    );
  }
  return data;
}
