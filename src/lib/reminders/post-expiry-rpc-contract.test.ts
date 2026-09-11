import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const migrations = path.resolve(process.cwd(), 'supabase/migrations');

function migration(suffix: string) {
  const file = fs.readdirSync(migrations).find((name) => name.endsWith(suffix));
  expect(file).toBeDefined();
  return fs.readFileSync(path.join(migrations, file!), 'utf8');
}

describe('post-expiry durable queue contract', () => {
  it('keeps settings disabled by default and escalation service-role-only', () => {
    const sql = migration('_post_expiry_reminder_lifecycle.sql');
    expect(sql).toMatch(/membership_post_expiry_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
    expect(sql).toMatch(/service_post_expiry_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
    expect(sql).toMatch(/COALESCE\(auth\.role\(\), ''\) <> 'service_role'/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.escalate_post_expiry_reminder\(UUID\) TO service_role/);
    expect(sql).toMatch(/uniq_follow_ups_open_per_contact|status = 'open'/);
  });

  it('keeps retention behind debt in the atomic daily reservation', () => {
    const sql = migration('_prioritize_debt_over_post_expiry.sql');
    expect(sql).toMatch(/WHEN 'membership_post_expiry' THEN 1/);
    expect(sql).toMatch(/WHEN 'service_post_expiry' THEN 1/);
    expect(sql).toMatch(/WHEN 'invoice_overdue' THEN 3/);
    expect(sql).toMatch(/FOR UPDATE/);
  });

  it('does not let a simultaneous toggle tamper with another activation boundary', () => {
    const sql = migration('_harden_post_expiry_activation_guard.sql');
    expect(sql).toMatch(/NEW\.membership_post_expiry_enabled = OLD\.membership_post_expiry_enabled/);
    expect(sql).toMatch(/Membership post-expiry activation fields are system managed/);
    expect(sql).toMatch(/NEW\.service_post_expiry_enabled = OLD\.service_post_expiry_enabled/);
    expect(sql).toMatch(/Service post-expiry activation fields are system managed/);
  });

  it('revalidates the current cycle and treats an escalation outcome as durable', () => {
    const sql = migration('_revalidate_post_expiry_escalations.sql');
    expect(sql).toMatch(/IF v_job\.escalated_at IS NOT NULL/);
    expect(sql).toMatch(/v_generation IS DISTINCT FROM v_job\.activation_generation/);
    expect(sql).toMatch(/membership\.collection_mode = 'manual'/);
    expect(sql).toMatch(/service\.item_is_active AND service\.option_is_active/);
    expect(sql).toMatch(/message\.created_at >= \(v_job\.effective_due_on::TIMESTAMP AT TIME ZONE/);
    expect(sql).toMatch(/escalation_state = 'stopped'/);
  });

  it('keeps the rollback proof no-send while exercising terminal RPC re-entry', () => {
    const sql = fs.readFileSync(
      path.resolve(process.cwd(), 'supabase/tests/post_expiry_reminder_lifecycle_rollback.sql'),
      'utf8'
    );
    expect(sql).toMatch(/set_config\('request\.jwt\.claims', '\{"role":"service_role"\}'/);
    expect(sql).toMatch(/public\.escalate_post_expiry_reminder\(v_job\)/);
    expect(sql).toMatch(/ROLLBACK/);
  });
});
