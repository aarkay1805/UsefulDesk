import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const ROUTE = join(ROOT, 'src/app/api/database-cron/route.ts');

function schedulerMigration(): string {
  const migrations = readdirSync(join(ROOT, 'supabase/migrations'))
    .filter((name) => name.endsWith('_database_owned_cron_scheduler.sql'))
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
});
