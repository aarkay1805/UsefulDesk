import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationNames = readdirSync(
  join(process.cwd(), 'supabase/migrations')
).filter((name) => name.endsWith('_gym_name_signup.sql'));

expect(migrationNames).toHaveLength(1);
expect(migrationNames[0]).toMatch(/^\d{14}_gym_name_signup\.sql$/);

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations', migrationNames[0]),
  'utf8'
);

const completionFunction = migration.slice(
  migration.indexOf(
    'CREATE OR REPLACE FUNCTION public.complete_organization_name_setup'
  ),
  migration.indexOf(
    'ALTER FUNCTION public.complete_organization_name_setup(UUID, TEXT)'
  )
);

const provisioningFunction = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION public.handle_new_user()'),
  migration.indexOf('ALTER FUNCTION public.handle_new_user()')
);

describe('gym-name signup database contract', () => {
  it('backfills only when the nullable completion column is first introduced', () => {
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS name_setup_completed_at TIMESTAMPTZ'
    );
    expect(migration).not.toMatch(
      /ADD COLUMN IF NOT EXISTS name_setup_completed_at TIMESTAMPTZ\s+DEFAULT/i
    );
    expect(migration).toMatch(
      /IF NOT v_column_already_exists THEN[\s\S]*?UPDATE public\.organizations[\s\S]*?name_setup_completed_at = \$1[\s\S]*?END IF;/
    );
  });

  it('uses the ECMAScript trim set and Unicode code-point length at both write boundaries', () => {
    expect(migration).toContain(
      "U&'\\0009\\000A\\000B\\000C\\000D\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'"
    );
    expect(provisioningFunction).toContain(
      "pg_catalog.jsonb_typeof(v_meta->'gym_name') IS DISTINCT FROM 'string'"
    );
    expect(provisioningFunction).toContain(
      'pg_catalog.char_length(v_gym_name) > 80'
    );
    expect(completionFunction).toContain(
      'pg_catalog.char_length(v_gym_name) > 80'
    );
  });

  it('keeps personal identity separate while preserving atomic locale provisioning', () => {
    expect(provisioningFunction).toMatch(
      /v_has_gym_name := v_meta \? 'gym_name';[\s\S]*?v_business_name := CASE WHEN v_has_gym_name THEN v_gym_name ELSE v_full_name END/
    );
    expect(provisioningFunction).toContain(
      'INSERT INTO public.organizations (name, name_setup_completed_at)'
    );
    expect(provisioningFunction).toContain(
      'VALUES (NEW.id, v_full_name, COALESCE(NEW.email, \'\'), v_account, \'owner\')'
    );
    for (const localeField of [
      'country_code',
      'locale',
      'default_currency',
      'timezone',
      'date_order',
      'time_format',
      'week_start',
      'phone_country_code',
      'measurement_system',
    ]) {
      expect(provisioningFunction).toContain(localeField);
    }
    expect(provisioningFunction).not.toMatch(/EXCEPTION\s+WHEN\s+OTHERS/);
  });

  it('appends completion state without weakening branch membership filtering', () => {
    expect(migration).toMatch(
      /RETURNS TABLE \([\s\S]*?setup_reviewed_by UUID,[\s\S]*?organization_name_setup_completed_at TIMESTAMPTZ/
    );
    expect(migration).toContain(
      'organization.name_setup_completed_at\n  FROM public.account_memberships membership'
    );
    expect(migration).toContain(
      'WHERE membership.user_id = (SELECT auth.uid())'
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.my_branch_accounts\(\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role;[\s\S]*?GRANT EXECUTE ON FUNCTION public\.my_branch_accounts\(\) TO authenticated;/
    );
  });

  it('authorizes before exposing state and returns the completed no-op before owner checks', () => {
    const memberCheck = completionFunction.indexOf(
      'NOT public.has_account_membership(p_account_id)'
    );
    const completedCheck = completionFunction.indexOf(
      'IF v_organization.name_setup_completed_at IS NOT NULL THEN'
    );
    const ownerCheck = completionFunction.indexOf(
      "v_branch_role <> 'owner'"
    );
    const nameValidation = completionFunction.indexOf(
      'v_gym_name := private.trim_javascript_whitespace(p_gym_name)'
    );

    expect(memberCheck).toBeGreaterThan(-1);
    expect(completedCheck).toBeGreaterThan(memberCheck);
    expect(ownerCheck).toBeGreaterThan(completedCheck);
    expect(nameValidation).toBeGreaterThan(ownerCheck);
    expect(completionFunction).toContain(
      "RETURN pg_catalog.jsonb_build_object('status', 'already_complete')"
    );
  });

  it('serializes structure and ownership before one atomic identity mutation', () => {
    const organizationLock = completionFunction.indexOf(
      'FROM public.organizations organization'
    );
    const legalEntityLock = completionFunction.indexOf(
      'FROM public.legal_entities legal_entity'
    );
    const accountLock = completionFunction.indexOf(
      'INTO v_account\n  FROM public.accounts account'
    );
    expect(organizationLock).toBeGreaterThan(-1);
    expect(legalEntityLock).toBeGreaterThan(organizationLock);
    expect(accountLock).toBeGreaterThan(legalEntityLock);
    expect(completionFunction).toMatch(
      /FROM public\.account_memberships membership[\s\S]*?FOR UPDATE;/
    );
    expect(completionFunction).toMatch(
      /FROM public\.organization_memberships membership[\s\S]*?FOR UPDATE;/
    );
    expect(completionFunction).toContain('IF v_branch_count <> 1 OR v_legal_entity_count <> 1 THEN');
    expect(completionFunction).toContain("USING ERRCODE = '23505'");
    expect(completionFunction).toContain('UPDATE public.organizations');
    expect(completionFunction).toContain('UPDATE public.legal_entities');
    expect(completionFunction).toContain('UPDATE public.accounts');
    expect(completionFunction).toContain(
      "'organization.name_setup_completed'"
    );
    expect(completionFunction).toContain(
      "RETURN pg_catalog.jsonb_build_object('status', 'completed')"
    );
  });

  it('keeps recovery outside product access and grants only authenticated execution', () => {
    expect(completionFunction).not.toContain(
      'private.has_product_account_membership'
    );
    expect(completionFunction).not.toContain(
      'private.is_product_organization_owner'
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.complete_organization_name_setup\(UUID, TEXT\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role;[\s\S]*?GRANT EXECUTE ON FUNCTION public\.complete_organization_name_setup\(UUID, TEXT\)[\s\S]*?TO authenticated;/
    );
  });

  it('ships a rollback-scoped semantic probe', () => {
    const probe = readFileSync(
      join(process.cwd(), 'scripts/verify-gym-name-signup-rollback.sql'),
      'utf8'
    );
    expect(probe.trimStart()).toMatch(/^BEGIN;/);
    expect(probe).toContain('ROLLBACK;');
    expect(probe).toContain('public.complete_organization_name_setup');
    expect(probe).toContain('public.my_branch_accounts()');
  });
});
