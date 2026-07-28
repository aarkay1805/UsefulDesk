import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260728162503_organization_account_memberships.sql'
  ),
  'utf8'
);
const archiveLockMigration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260728170116_enforce_archived_branch_read_only.sql'
  ),
  'utf8'
);
const archiveLifecycleMigration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260728170241_require_active_branch_before_archive.sql'
  ),
  'utf8'
);
const consentOrderingMigration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260728170553_consent_event_wall_clock_ordering.sql'
  ),
  'utf8'
);

describe('multi-branch database security contract', () => {
  it('uses many-to-many memberships while binding RLS to the requested branch', () => {
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS public.account_memberships'
    );
    expect(migration).toContain(
      'SELECT target_account_id = private.requested_account_id()'
    );
    expect(migration).toContain('FROM public.account_memberships am');
    expect(migration).not.toContain(
      'target_account_id IN (SELECT am.account_id'
    );
  });

  it('fails closed when an explicit branch is invalid or unauthorized', () => {
    expect(migration).toMatch(
      /IF v_header IS NOT NULL THEN[\s\S]*?IF v_header !~\*[\s\S]*?RETURN NULL;[\s\S]*?RETURN v_header::uuid;/
    );
    expect(migration).toMatch(
      /SELECT EXISTS \(SELECT 1 FROM target\)\r?\n    AND \(/
    );
    expect(consentOrderingMigration).toContain('clock_timestamp()');
  });

  it('keeps selected reporting explicit and consolidated reporting owner-only', () => {
    for (const fn of [
      'selected_branch_owner_report',
      'selected_branch_owner_report_source_revenue',
      'selected_branch_owner_report_plan_options',
      'selected_branch_owner_report_average_sale_price',
    ]) {
      expect(migration).toContain(`CREATE OR REPLACE FUNCTION public.${fn}(`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${fn}`);
    }
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.organization_report_summary('
    );
    expect(migration).toContain(
      'SELECT public.is_organization_owner(p_organization_id) AS ok'
    );
    expect(migration).toContain("'currencyTotals'");
  });

  it('archives branches and never clones operational credentials', () => {
    expect(migration).toMatch(
      /SET branch_status = 'archived',\s+readiness_state = 'attention',\s+archived_at = now\(\)/
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.create_organization_branch('
    );
    expect(migration).not.toMatch(
      /INSERT INTO public\.accounts[\s\S]{0,1500}(whatsapp_access_token|razorpay_key_secret|api_key)/
    );
    expect(archiveLockMigration).toContain("AND a.branch_status <> 'archived'");
    expect(archiveLockMigration).toContain("AND a.branch_status = 'active'");
    expect(archiveLifecycleMigration).toContain(
      'Create or retain another active branch before archiving this one'
    );
  });

  it('makes invitation redemption additive instead of moving a profile', () => {
    expect(migration).toMatch(
      /INSERT INTO public\.account_memberships \(\s*account_id, user_id, role/
    );
    const redemption = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.redeem_invitation'),
      migration.indexOf(
        'ALTER FUNCTION public.redeem_invitation',
        migration.indexOf('CREATE OR REPLACE FUNCTION public.redeem_invitation')
      )
    );
    expect(redemption).not.toContain('DELETE FROM public.accounts');
    expect(redemption).not.toContain('UPDATE public.profiles');
  });
});
