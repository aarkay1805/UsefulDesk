import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations');

function repairMigration() {
  const file = fs
    .readdirSync(migrationsDir)
    .find((name) => name.endsWith('_repair_lifecycle_reminder_contract.sql'));
  expect(file).toBeDefined();
  return fs.readFileSync(path.join(migrationsDir, file!), 'utf8');
}

describe('lifecycle reminder RPC contract', () => {
  it('authorizes service-role JWT callers rather than the definer owner', () => {
    expect(repairMigration()).toMatch(/auth\.role\(\).*service_role/);
    expect(repairMigration()).not.toMatch(/current_user\s*<>\s*'service_role'/);
  });

  it('keeps a daily per-contact reservation and separate provider attempts', () => {
    const sql = repairMigration();
    expect(sql).toContain('lifecycle_reminder_daily_claims');
    expect(sql).toContain('provider_attempt_count');
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(sql).toMatch(/lease_expires_at >= NOW\(\)/);
  });

  it('makes expired leases visibly ambiguous instead of silently reclaiming them', () => {
    expect(repairMigration()).toMatch(/state = 'ambiguous'/);
  });
});
