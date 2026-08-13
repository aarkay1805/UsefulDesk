import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260813205947_whatsapp_status_callback_integrity.sql'
  ),
  'utf8'
);

describe('WhatsApp status callback database contract', () => {
  it('derives the tenant from the signed phone-number metadata for both mirrors', () => {
    expect(migration).toContain('p_phone_number_id TEXT');
    expect(migration).toMatch(
      /FROM public\.whatsapp_config AS config[\s\S]*config\.phone_number_id = p_phone_number_id/
    );
    expect(migration).toMatch(
      /UPDATE public\.messages[\s\S]*conversation\.account_id = target_account\.account_id/
    );
    expect(migration).toMatch(
      /UPDATE public\.broadcast_recipients[\s\S]*broadcast\.account_id = target_account\.account_id/
    );
  });

  it('guards forward and failed transitions inside each atomic update', () => {
    expect(migration).toMatch(
      /UPDATE public\.messages[\s\S]*WHEN 'delivered' THEN message\.status IN \('sending', 'sent'\)[\s\S]*WHEN 'read' THEN message\.status IN \('sending', 'sent', 'delivered'\)[\s\S]*WHEN 'failed' THEN message\.status IN \('sending', 'sent'\)/
    );
    expect(migration).toMatch(
      /UPDATE public\.broadcast_recipients[\s\S]*WHEN 'delivered' THEN recipient\.status IN \('pending', 'sent'\)[\s\S]*WHEN 'read' THEN recipient\.status IN \('pending', 'sent', 'delivered'\)[\s\S]*WHEN 'failed' THEN recipient\.status IN \('pending', 'sent'\)/
    );
  });

  it('exposes the invoker RPC only to the server service role', () => {
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.apply_whatsapp_status_callback[\s\S]*FROM PUBLIC, anon, authenticated/
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.apply_whatsapp_status_callback[\s\S]*TO service_role/
    );
  });
});
