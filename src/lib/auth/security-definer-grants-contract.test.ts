import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = (name: string) =>
  readFileSync(resolve(process.cwd(), `supabase/migrations/${name}`), 'utf8');

const hardeningSql = migration(
  '20260725221657_harden_security_definer_execute_grants.sql'
);

function grantedFunctions(role: 'anon' | 'authenticated' | 'service_role') {
  const grants = hardeningSql.matchAll(
    /GRANT EXECUTE ON FUNCTION public\.([a-z0-9_]+)\([\s\S]*?\)\s+TO ([a-z_, ]+);/g
  );

  return Array.from(grants)
    .filter(([, , roles]) =>
      roles
        .split(',')
        .map((value) => value.trim())
        .includes(role)
    )
    .map(([, name]) => name)
    .sort();
}

describe('SECURITY DEFINER execution-grant contract', () => {
  it('closes legacy client-role defaults for future public functions', () => {
    expect(hardeningSql).toMatch(
      /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public[\s\S]*?REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;/
    );
  });

  it('revokes direct client execution from every current definer function', () => {
    expect(hardeningSql).toMatch(/WHERE n\.nspname = 'public'/);
    expect(hardeningSql).toMatch(/AND p\.prosecdef/);
    expect(hardeningSql).toMatch(
      /REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated/
    );
  });

  it('keeps anonymous access limited to verified token lookups', () => {
    expect(grantedFunctions('anon')).toEqual([
      'peek_invitation',
      'peek_lead_capture_form',
    ]);

    const invitationSql = migration('019_invitation_rpcs.sql');
    const leadCaptureSql = migration('064_lead_capture_and_meta_leads.sql');

    expect(invitationSql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.peek_invitation[\s\S]*?WHERE token_hash = p_token_hash/
    );
    expect(leadCaptureSql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.peek_lead_capture_form[\s\S]*?WHERE f\.token = p_token/
    );
  });

  it('does not restore browser execution for privileged internal helpers', () => {
    const dangerous = [
      '_bcast_bump',
      'claim_ai_reply_slot',
      'match_ai_knowledge_fts',
      'match_ai_knowledge_semantic',
      'merge_duplicate_contacts',
      'record_webhook_failure',
    ];

    expect(
      grantedFunctions('anon').filter((name) => dangerous.includes(name))
    ).toEqual([]);
    expect(
      grantedFunctions('authenticated').filter((name) =>
        dangerous.includes(name)
      )
    ).toEqual([]);
  });

  it('preserves required service-role AI and webhook paths', () => {
    expect(grantedFunctions('service_role')).toEqual([
      'claim_ai_reply_slot',
      'match_ai_knowledge_fts',
      'match_ai_knowledge_semantic',
      'record_webhook_failure',
    ]);
  });

  it('preserves audited account-membership RPC execution', () => {
    expect(grantedFunctions('authenticated')).toEqual(
      expect.arrayContaining([
        'is_account_member',
        'redeem_invitation',
        'remove_account_member',
        'set_member_role',
        'transfer_account_ownership',
      ])
    );
  });
});
