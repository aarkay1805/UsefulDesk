import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  MessageConsentRequiredError,
  assertTemplateConsentAllowed,
  recordTemplateConsent,
} from './template-consent';

function dbWithRpc(result: {
  data: unknown;
  error: { message: string } | null;
}) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}

describe('assertTemplateConsentAllowed', () => {
  it('checks the exact account-update purpose through the database boundary', async () => {
    const { db, rpc } = dbWithRpc({ data: true, error: null });
    await expect(
      assertTemplateConsentAllowed(
        db,
        'account-1',
        '+91 99999 99999',
        'whatsapp_account_updates'
      )
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('business_message_allowed', {
      p_account_id: 'account-1',
      p_phone: '+91 99999 99999',
      p_purpose: 'whatsapp_account_updates',
    });
  });

  it('fails closed with an actionable code when positive consent is absent', async () => {
    const { db } = dbWithRpc({ data: false, error: null });
    await expect(
      assertTemplateConsentAllowed(
        db,
        'account-1',
        '+919999999999',
        'whatsapp_marketing'
      )
    ).rejects.toBeInstanceOf(MessageConsentRequiredError);
    await expect(
      assertTemplateConsentAllowed(
        db,
        'account-1',
        '+919999999999',
        'whatsapp_marketing'
      )
    ).rejects.toMatchObject({ code: 'message_consent_required' });
  });

  it('does not turn a database verification failure into permission', async () => {
    const { db } = dbWithRpc({
      data: null,
      error: { message: 'database unavailable' },
    });
    await expect(
      assertTemplateConsentAllowed(
        db,
        'account-1',
        '+919999999999',
        'whatsapp_marketing'
      )
    ).rejects.toThrow(
      'Could not verify WhatsApp consent: database unavailable'
    );
  });
});

describe('recordTemplateConsent', () => {
  it('records staff evidence through the audited consent RPC', async () => {
    const { db, rpc } = dbWithRpc({ data: 'event-1', error: null });
    await expect(
      recordTemplateConsent(db, {
        accountId: 'account-1',
        contactId: 'contact-1',
        scope: 'whatsapp_marketing',
        action: 'opt_in',
        source: 'staff_recorded',
        evidenceNote: 'Member signed the front-desk WhatsApp consent form.',
      })
    ).resolves.toBe('event-1');
    expect(rpc).toHaveBeenCalledWith('record_contact_consent', {
      p_account_id: 'account-1',
      p_contact_id: 'contact-1',
      p_purpose: 'whatsapp_marketing',
      p_action: 'opt_in',
      p_source: 'staff_recorded',
      p_evidence: {
        note: 'Member signed the front-desk WhatsApp consent form.',
      },
    });
  });

  it('requires a source evidence note before recording consent', async () => {
    const { db, rpc } = dbWithRpc({ data: 'event-1', error: null });
    await expect(
      recordTemplateConsent(db, {
        accountId: 'account-1',
        contactId: 'contact-1',
        scope: 'whatsapp_account_updates',
        action: 'opt_in',
        source: 'staff_recorded',
        evidenceNote: '   ',
      })
    ).rejects.toThrow('Consent evidence note is required.');
    expect(rpc).not.toHaveBeenCalled();
  });
});
