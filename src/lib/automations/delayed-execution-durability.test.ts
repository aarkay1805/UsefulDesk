import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migrationsDir = join(root, 'supabase/migrations');
const migrationName = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .findLast((name) =>
    readFileSync(join(migrationsDir, name), 'utf8').includes(
      'claim_due_automation_executions'
    )
  );
const migration = migrationName
  ? readFileSync(join(migrationsDir, migrationName), 'utf8')
  : '';
const cronRoute = readFileSync(
  join(root, 'src/app/api/automations/cron/route.ts'),
  'utf8'
);
const engine = readFileSync(
  join(root, 'src/lib/automations/engine.ts'),
  'utf8'
);

describe('delayed automation durability contract', () => {
  it('atomically claims due or expired executions with owner leases', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.claim_due_automation_executions[\s\S]*SECURITY INVOKER[\s\S]*SET search_path = ''[\s\S]*FOR UPDATE OF pending SKIP LOCKED/
    );
    expect(migration).toContain("pending.status = 'pending'");
    expect(migration).toMatch(
      /pending\.status = 'running'[\s\S]*pending\.lease_until <= clock_timestamp\(\)/
    );
    expect(migration).toContain('lease_owner = p_lease_owner');
    expect(migration).toContain('lease_until = clock_timestamp()');
  });

  it('finishes only the execution owned by the current worker', () => {
    expect(migration).toMatch(
      /finish_automation_execution[\s\S]*pending\.lease_owner = p_lease_owner/
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.claim_due_automation_executions[\s\S]*FROM PUBLIC, anon, authenticated;/
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.finish_automation_execution[\s\S]*FROM PUBLIC, anon, authenticated;/
    );
  });

  it('uses the leased database claim and passes its owner through completion', () => {
    expect(cronRoute).toContain('randomUUID()');
    expect(cronRoute).toMatch(/\.rpc\(\s*'claim_due_automation_executions'/);
    expect(cronRoute).toContain('p_limit: 1');
    expect(cronRoute).toContain('resumePendingExecution(pending, leaseOwner)');
    expect(cronRoute).not.toContain(".eq('status', 'pending')");
    expect(engine).toContain('finish_automation_execution');
    expect(engine).toContain('p_lease_owner: leaseOwner');
  });
});
