import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

const checkout = read(
  'supabase/migrations/20260816122505_service_aware_resumable_member_import.sql'
);
const authorityFix = read(
  'supabase/migrations/20260829082000_authorize_contact_checkout_writes.sql'
);

describe('contact checkout database authority', () => {
  it('keeps browser financial tables read-only and authorizes the transaction at the RPC boundary', () => {
    expect(checkout).toMatch(
      /perform_contact_checkout\(p_payload JSONB\)[\s\S]*public\.is_account_member\(v_account_id, 'agent'\)/
    );
    expect(checkout).toMatch(
      /WHERE contact\.id = v_contact_id[\s\S]*contact\.account_id = v_account_id/
    );
    expect(authorityFix).toContain(
      'ALTER FUNCTION public.perform_contact_checkout(JSONB) SECURITY DEFINER'
    );
    expect(authorityFix).toContain(
      "ALTER FUNCTION public.perform_contact_checkout(JSONB) SET search_path = ''"
    );
    expect(authorityFix).toMatch(
      /REVOKE ALL ON FUNCTION public\.perform_contact_checkout\(JSONB\)[\s\S]*FROM PUBLIC, anon;/
    );
    expect(authorityFix).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.perform_contact_checkout\(JSONB\)[\s\S]*TO authenticated;/
    );
  });
});
