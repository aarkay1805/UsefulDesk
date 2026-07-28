import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260728200000_branch_restore_and_erasure.sql'
  ),
  'utf8'
);
const route = readFileSync(
  join(process.cwd(), 'src/app/api/organization/branches/[accountId]/route.ts'),
  'utf8'
);

describe('branch lifecycle contract', () => {
  it('restores only an owned archived branch and closes default grants', () => {
    expect(migration).toMatch(
      /is_organization_owner\(v_target\.organization_id\)[\s\S]*?has_account_membership\(p_account_id, 'owner'\)/
    );
    expect(migration).toContain("IF v_target.branch_status <> 'archived' THEN");
    expect(migration).toMatch(
      /SET branch_status = 'active',[\s\S]*?archived_at = NULL/
    );
    expect(migration).toContain("'branch.restored'");
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.restore_branch(UUID) FROM PUBLIC, anon;'
    );
  });

  it('keeps a surviving active branch and re-homes profiles before deletion', () => {
    expect(migration).toContain(
      'The final branch cannot be deleted. Delete the organization instead.'
    );
    expect(migration).toContain('At least one other active branch must remain');

    const profileRehome = migration.indexOf('WITH replacements AS');
    const membershipDelete = migration.indexOf(
      'DELETE FROM public.account_memberships'
    );
    const accountDelete = migration.indexOf('DELETE FROM public.accounts');
    expect(profileRehome).toBeGreaterThan(-1);
    expect(profileRehome).toBeLessThan(membershipDelete);
    expect(membershipDelete).toBeLessThan(accountDelete);
    expect(migration).toContain('DELETE FROM public.contact_consent_events');
    expect(migration).toContain("'branch.deleted'");
  });

  it('purges branch Storage before the database and cleans up orphan Auth users', () => {
    const storagePurge = route.indexOf(
      'const deletedStorageObjects = await purgeOrganizationStorage('
    );
    const databaseDelete = route.indexOf("'delete_branch',", storagePurge);
    expect(storagePurge).toBeGreaterThan(-1);
    expect(databaseDelete).toBeGreaterThan(storagePurge);
    expect(route).toContain("source: 'branch_erasure'");
    expect(route).toContain('admin.auth.admin.deleteUser(userId)');
    expect(route).toContain('body?.confirm !== target.account_name');
  });
});
