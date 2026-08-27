import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const ROUTE = join(ROOT, 'src/app/api/database-cron/route.ts');

function schedulerMigration(): string {
  const migrations = readdirSync(join(ROOT, 'supabase/migrations'))
    .filter(
      (name) =>
        name.endsWith('_database_owned_cron_scheduler.sql') &&
        !name.endsWith('_activate_database_owned_cron_scheduler.sql')
    )
    .sort();
  return migrations.at(-1) ?? '';
}

function schedulerHardeningMigration(): string {
  const migrations = readdirSync(join(ROOT, 'supabase/migrations'))
    .filter((name) => name.endsWith('_harden_database_cron_verifier.sql'))
    .sort();
  return migrations.at(-1) ?? '';
}

function schedulerActivationMigration(): string {
  const migrations = readdirSync(join(ROOT, 'supabase/migrations'))
    .filter((name) =>
      name.endsWith('_activate_database_owned_cron_scheduler.sql')
    )
    .sort();
  return migrations.at(-1) ?? '';
}

describe('database-owned production scheduler contract', () => {
  it('exposes one authenticated aggregator without weakening existing cron routes', () => {
    expect(existsSync(ROUTE)).toBe(true);
    const route = existsSync(ROUTE) ? readFileSync(ROUTE, 'utf8') : '';

    expect(route).toMatch(/\.rpc\(\s*'verify_database_cron_secret'/);
    expect(route).toContain('process.env.AUTOMATION_CRON_SECRET');
    expect(route).toContain("group === 'ops'");
    expect(route).toContain("group === 'renewals'");
    expect(route).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('keeps the generated scheduler secret in Vault and the verifier service-only', () => {
    const migration = schedulerMigration();
    expect(migration).not.toBe('');
    const sql = migration
      ? readFileSync(join(ROOT, 'supabase/migrations', migration), 'utf8')
      : '';

    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS pg_cron');
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS pg_net');
    expect(sql).toContain('vault.create_secret');
    expect(sql).toContain('verify_database_cron_secret');
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.verify_database_cron_secret\(TEXT\)/
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.verify_database_cron_secret\(TEXT\) TO service_role/
    );
    expect(sql).toContain("'usefuldesk-ops-cron'");
    expect(sql).toContain("'usefuldesk-renewals-cron'");
    expect(sql).not.toContain('AUTOMATION_CRON_SECRET');
  });

  it('verifies the random scheduler token with a cheap digest before activation', () => {
    const migration = schedulerHardeningMigration();
    expect(migration).not.toBe('');
    const sql = migration
      ? readFileSync(join(ROOT, 'supabase/migrations', migration), 'utf8')
      : '';

    expect(sql).toContain("extensions.digest(p_secret, 'sha256')");
    expect(sql).not.toContain('extensions.crypt(p_secret');
    expect(sql).not.toMatch(/UPDATE\s+cron\.job/i);
  });

  it('activates both named jobs through the supported cron API', () => {
    const migration = schedulerActivationMigration();
    expect(migration).not.toBe('');
    const sql = migration
      ? readFileSync(join(ROOT, 'supabase/migrations', migration), 'utf8')
      : '';

    expect(sql).toContain("'usefuldesk-ops-cron'");
    expect(sql).toContain("'usefuldesk-renewals-cron'");
    expect(sql.match(/cron\.alter_job/g)).toHaveLength(2);
    expect(sql).toContain('active := TRUE');
    expect(sql).not.toMatch(/UPDATE\s+cron\.job/i);
  });
});
