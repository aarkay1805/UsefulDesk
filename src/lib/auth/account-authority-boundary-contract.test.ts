import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const hardeningMigration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260814015059_protect_account_authority_columns.sql'
  ),
  'utf8'
);

const organizationMigration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260728162503_organization_account_memberships.sql'
  ),
  'utf8'
);

const authorityColumns = [
  'owner_user_id',
  'organization_id',
  'legal_entity_id',
] as const;

describe('account authority-column boundary', () => {
  it('denies browser roles table-wide and authority-column update privileges', () => {
    expect(hardeningMigration).toContain(
      'REVOKE UPDATE ON TABLE public.accounts FROM PUBLIC, anon, authenticated;'
    );
    expect(hardeningMigration).toMatch(
      /REVOKE UPDATE \(\s*owner_user_id,\s*organization_id,\s*legal_entity_id\s*\) ON TABLE public\.accounts\s+FROM PUBLIC, anon, authenticated;/
    );

    const authenticatedGrant = hardeningMigration.match(
      /GRANT UPDATE \(([\s\S]*?)\) ON TABLE public\.accounts TO authenticated;/
    )?.[1];

    expect(authenticatedGrant).toBeDefined();
    for (const column of authorityColumns) {
      expect(authenticatedGrant).not.toContain(column);
    }
    expect(authenticatedGrant).toContain('name');
    expect(authenticatedGrant).toContain('onboarding_dismissed_at');
  });

  it('rejects changed authority values from direct Data API roles', () => {
    expect(hardeningMigration).toContain(
      'CREATE OR REPLACE FUNCTION private.protect_account_authority_columns()'
    );
    expect(hardeningMigration).toContain('SECURITY INVOKER');
    expect(hardeningMigration).toContain(
      "current_user IN ('anon', 'authenticated')"
    );
    for (const column of authorityColumns) {
      expect(hardeningMigration).toContain(
        `NEW.${column} IS DISTINCT FROM OLD.${column}`
      );
    }
    expect(hardeningMigration).toContain("USING ERRCODE = '42501'");
    expect(hardeningMigration).toContain(
      'CREATE TRIGGER trg_accounts_protect_authority_columns'
    );
  });

  it('preserves the audited owner-only ownership transfer path', () => {
    const transfer = organizationMigration.slice(
      organizationMigration.indexOf(
        'CREATE OR REPLACE FUNCTION public.transfer_account_ownership'
      ),
      organizationMigration.indexOf(
        'ALTER FUNCTION public.transfer_account_ownership(UUID) OWNER TO postgres'
      )
    );

    expect(transfer).toContain(
      "NOT public.is_account_member(v_account, 'owner')"
    );
    expect(transfer).toContain('SET owner_user_id = p_new_owner_user_id');
    expect(transfer).toContain("'branch.ownership_transferred'");
  });
});
