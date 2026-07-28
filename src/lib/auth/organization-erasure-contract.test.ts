import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260728175827_organization_erasure.sql'
  ),
  'utf8'
);
const route = readFileSync(
  join(process.cwd(), 'src/app/api/organization/route.ts'),
  'utf8'
);

describe('organization erasure contract', () => {
  it('re-checks organization ownership and closes default function grants', () => {
    expect(migration).toMatch(
      /auth\.uid\(\) IS NULL[\s\S]*?public\.is_organization_owner\(p_organization_id\)/
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.delete_organization(UUID)'
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.delete_organization\(UUID\)[\s\S]*?TO authenticated;/
    );
  });

  it('re-homes surviving profiles before deleting all organization parents', () => {
    const rehome = migration.indexOf('WITH replacements AS');
    const deleteAccounts = migration.indexOf('DELETE FROM public.accounts');
    expect(rehome).toBeGreaterThan(-1);
    expect(rehome).toBeLessThan(deleteAccounts);
    expect(migration).toContain(
      'survivor.organization_id <> p_organization_id'
    );
    for (const table of [
      'contact_consent_events',
      'account_memberships',
      'accounts',
      'organization_memberships',
      'legal_entities',
      'organizations',
    ]) {
      expect(migration).toContain(`DELETE FROM public.${table}`);
    }
  });

  it('purges Storage before the transactional database erasure', () => {
    const storagePurge = route.indexOf(
      'const deletedStorageObjects = await purgeOrganizationStorage('
    );
    const databaseDelete = route.indexOf(
      "'delete_organization',",
      storagePurge
    );
    expect(storagePurge).toBeGreaterThan(-1);
    expect(databaseDelete).toBeGreaterThan(storagePurge);
    expect(route).toContain("source: 'organization_erasure'");
    expect(route).toContain('admin.auth.admin.deleteUser(userId)');
  });
});
