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

function sendContractMigration() {
  return fs.readFileSync(
    path.join(
      migrationsDir,
      '20260926090000_repair_lifecycle_reminder_send_contract.sql'
    ),
    'utf8'
  );
}

function functionBody(sql: string, name: string) {
  const match = sql.match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`
    )
  );
  expect(match).not.toBeNull();
  return match![1];
}

/** Evaluates the priority helper's CASE for one kind/milestone. */
function priority(kind: string, milestone = 'milestone') {
  const body = functionBody(
    sendContractMigration(),
    'lifecycle_reminder_priority'
  );
  for (const [, condition, value] of body.matchAll(
    /WHEN ([\s\S]*?) THEN (\d+)/g
  )) {
    const kinds = Array.from(condition.matchAll(/'([a-z_-]+)'/g), (m) => m[1]);
    const milestoneMatch = condition.match(/p_milestone_key = '([a-z-]+)'/);
    if (!kinds.includes(kind)) continue;
    if (milestoneMatch && milestoneMatch[1] !== milestone) continue;
    return Number(value);
  }
  return Number(body.match(/ELSE (\d+)/)![1]);
}

describe('lifecycle reminder send contract repair', () => {
  it('lets budget-exempt transaction events reach the provider without a daily claim', () => {
    const exempt = functionBody(
      sendContractMigration(),
      'lifecycle_reminder_uses_daily_budget'
    );
    expect(exempt).toContain("p_kind = 'payment_confirmation'");
    expect(exempt).toContain(
      "p_kind = 'autopay_recovery' AND p_milestone_key = 'retry_pending'"
    );
    const mark = functionBody(
      sendContractMigration(),
      'mark_lifecycle_reminder_provider_attempt'
    );
    expect(mark).toMatch(
      /NOT public\.lifecycle_reminder_uses_daily_budget\(job\.kind, job\.milestone_key\)\s+OR EXISTS/
    );
  });

  it('ranks debt collection above retention and retention above attendance', () => {
    const collection = [
      priority('promise_to_pay', 'promise-broken'),
      priority('promise_to_pay'),
      priority('installment_overdue'),
      priority('invoice_overdue'),
      priority('autopay_recovery', 'terminal'),
      priority('invoice_due'),
      priority('payment_link_follow_up'),
    ];
    const retention = [
      'membership_post_expiry',
      'service_post_expiry',
      'session_pack_low',
      'session_pack_exhausted',
      'freeze_return',
      'membership_win_back',
      'service_win_back',
    ].map((kind) => priority(kind));
    expect(Math.min(...collection)).toBeGreaterThan(Math.max(...retention));
    expect(Math.min(...retention)).toBeGreaterThan(
      priority('attendance_streak')
    );
    expect(priority('attendance_streak')).toBeGreaterThan(
      priority('attendance_absence')
    );
    expect(priority('promise_to_pay', 'promise-broken')).toBeGreaterThan(
      priority('promise_to_pay')
    );
    expect(priority('installment_overdue')).toBeGreaterThan(
      priority('invoice_overdue')
    );
    expect(priority('invoice_overdue')).toBeGreaterThan(
      priority('invoice_due')
    );
    expect(priority('a_future_kind')).toBeLessThan(
      priority('attendance_absence')
    );
  });

  it('only lets due, budgeted, higher-priority work defer a reservation', () => {
    const reserve = functionBody(
      sendContractMigration(),
      'reserve_lifecycle_reminder_daily_claim'
    );
    expect(reserve).toContain(
      'public.lifecycle_reminder_uses_daily_budget(other.kind, other.milestone_key)'
    );
    expect(reserve).toMatch(
      /lifecycle_reminder_priority\(other\.kind, other\.milestone_key\)\s+> public\.lifecycle_reminder_priority\(v_job\.kind, v_job\.milestone_key\)/
    );
    expect(reserve).not.toMatch(/ELSE \d+ END/);
  });

  it('counts each pre-provider re-queue and ends the fifth as retries_exhausted', () => {
    const sql = sendContractMigration();
    expect(sql).toContain('CHECK (attempt_count BETWEEN 0 AND 5)');
    const finish = functionBody(sql, 'finish_lifecycle_reminder_job');
    expect(finish).toMatch(
      /p_state = 'queued' AND job\.attempt_count \+ 1 >= 5\s+THEN 'failed'/
    );
    expect(finish).toContain("'code', 'retries_exhausted'");
    expect(finish).toContain('LEAST(job.attempt_count + 1, 5)');
    // Claim handling follows the stored state, so an exhausted job frees its
    // daily claim like any other terminal state.
    expect(finish).toMatch(/IF v_state IN \('accepted', 'ambiguous'\)/);
  });
});

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

describe('lifecycle reminder delivery reconciliation', () => {
  const sql = fs.readFileSync(
    path.join(
      migrationsDir,
      '20260926100000_reconcile_lifecycle_reminder_deliveries.sql'
    ),
    'utf8'
  );
  const body = functionBody(sql, 'reconcile_lifecycle_reminder_deliveries');

  it('joins stored message statuses in one statement, scoped to the job’s own contact', () => {
    expect(body).toContain(
      'JOIN public.messages message ON message.message_id = job.provider_message_id'
    );
    expect(body).toContain('AND conversation.account_id = job.account_id');
    expect(body).toContain('AND conversation.contact_id = job.contact_id');
    expect(body).toContain("message.status IN ('delivered', 'read', 'failed')");
  });

  it('only moves jobs that are still accepted and keeps service-role authority', () => {
    expect(body).toContain(
      "WHERE job.id = outcome.job_id AND job.state = 'accepted'"
    );
    expect(body).toMatch(/auth\.role\(\).*service_role/);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.reconcile_lifecycle_reminder_deliveries\(\)\s+FROM PUBLIC, anon, authenticated;/
    );
    expect(sql).toContain(
      "jsonb_build_object('code', 'provider_delivery_failed')"
    );
  });
});
