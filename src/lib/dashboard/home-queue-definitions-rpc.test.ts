import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { memberFiltersFromUrl } from '@/lib/memberships/filters';
import { TRIAL_SOON_DAYS } from '@/lib/memberships/trials';

// Text contract for the migration that corrected Home's queue populations.
// No database is reachable from unit tests, so these pin the predicates the
// dashboard benchmark asked for; the migration's own header states them.
const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260927120000_home_queue_definitions.sql'
  ),
  'utf8'
);

function block(from: string, to: string): string {
  const start = migration.indexOf(from);
  const end = migration.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error(`missing block ${from}`);
  return migration.slice(start, end);
}

const expiring = block('-- Expiring memberships:', '-- Not contacted yet:');
const uncontacted = block('-- Not contacted yet:', '-- Needs attention:');
const attention = block('-- Needs attention:', 'RETURN pg_catalog');

describe('home queue definitions SQL contract', () => {
  it('replaces the snapshot in place without destroying anything', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.dashboard_action_snapshot(\n  p_today DATE,\n  p_time_zone TEXT,\n  p_now TIMESTAMPTZ,\n  p_limit INTEGER\n)'
    );
    // Expand step: the unused attention helper stays until the contract step.
    expect(migration).not.toMatch(/\bDROP\b/);
    expect(migration).not.toContain(
      'public.dashboard_action_attention(p_today)'
    );
  });

  it('still returns every field the previous app version parses', () => {
    // The deployed app reads whole waiting days (never below one) and the
    // three old attention counts; either version works against this function.
    expect(uncontacted).toContain("'waitingDays', GREATEST(\n              1,");
    expect(attention).toContain("'churnRisk', may_leave.total");
    expect(attention).toContain("'trialFollowups', trials.total");
    expect(attention).toContain(
      "'failedMandates', COALESCE((SELECT MAX(auto_pay.total) FROM auto_pay), 0)"
    );
  });

  it('counts a fresh enquiry at once and only real contact attempts clear it', () => {
    expect(uncontacted).not.toContain('INTERVAL');
    expect(uncontacted).toContain('contact.lead_status IS NULL');
    // An enquiry has neither a membership nor a service purchase.
    expect(uncontacted).toContain('FROM public.memberships AS membership');
    expect(uncontacted).toContain('FROM public.member_services AS service');
    // Staff WhatsApp that WhatsApp accepted, or a follow-up marked done.
    expect(uncontacted).toContain("message.sender_type = 'agent'");
    expect(uncontacted).toContain(
      "message.status IN ('sent', 'delivered', 'read')"
    );
    expect(uncontacted).toContain("follow_up.status = 'done'");
    // Automated messages never count as someone handling the enquiry.
    expect(uncontacted).not.toContain("'bot'");
    expect(uncontacted).toContain('ORDER BY created_at DESC, id DESC');
    expect(uncontacted).toContain("message.sender_type = 'customer'");
    expect(uncontacted).toContain("'waitingMinutes', GREATEST(");
    expect(uncontacted).toContain('p_now - hydrated.created_at');
  });

  it('keeps renewal eligibility and adds the one open follow-up per row', () => {
    expect(expiring).toContain('membership.end_date <= p_today + 7');
    expect(expiring).toContain("OR plan.plan_type = 'recurring'");
    expect(expiring).toContain("follow_up.status = 'open'");
    expect(expiring).toContain("'followUp', CASE");
    expect(expiring).toContain("'ownerName', hydrated.follow_up_owner_name");
  });

  it('counts trials over the Trials page window and retires a recorded decline', () => {
    expect(TRIAL_SOON_DAYS).toBe(7);
    expect(attention).toContain(
      `membership.end_date <= p_today + ${TRIAL_SOON_DAYS}`
    );
    expect(attention).toContain("follow_up.outcome = 'not_interested'");
    expect(attention).toContain(
      'membership.start_date::TIMESTAMP AT TIME ZONE p_time_zone'
    );
  });

  it('separates AutoPay setup failures from AutoPay stopped by failed charges', () => {
    expect(attention).toContain('DISTINCT ON (mandate.membership_id)');
    expect(attention).toContain("latest.status = 'failed'");
    expect(attention).toContain(
      "WHEN latest.setup_error IS NOT NULL THEN 'setup_failed'"
    );
    expect(attention).toContain("ELSE 'stopped'");
    // A later payment is another arrangement; the problem retires.
    expect(attention).toContain('payment.paid_at > latest.updated_at');
    expect(attention).toContain("'membershipId', auto_pay_preview.id");
  });

  it('counts May leave as exactly the All members filter set it links to', () => {
    expect(attention).toContain('contact.churn_risk = TRUE');
    expect(attention).toContain("membership.status = 'active'");
    expect(attention).toContain('membership.is_trial = FALSE');
    expect(attention).toContain('membership.end_date >= p_today');
    expect(memberFiltersFromUrl('may-leave')).toMatchObject({
      statuses: ['active'],
      churnRisk: ['yes'],
    });
  });
});
