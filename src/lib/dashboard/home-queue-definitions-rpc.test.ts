import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { memberFiltersFromUrl } from '@/lib/memberships/filters';
import { TRIAL_SOON_DAYS } from '@/lib/memberships/trials';

// Text contract for the migrations that corrected Home's queue populations.
// No database is reachable from unit tests, so these pin the predicates the
// dashboard benchmark asked for; the migrations' own headers state them.
function migrationFile(name: string): string {
  return readFileSync(join(process.cwd(), 'supabase/migrations', name), 'utf8');
}

// The latest snapshot definition, and the expand step it contracted.
const migration = migrationFile(
  '20260927140000_home_queue_definitions_contract.sql'
);
const expand = migrationFile('20260927120000_home_queue_definitions.sql');

function block(from: string, to: string, source = migration): string {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error(`missing block ${from}`);
  return source.slice(start, end);
}

const expiring = block('-- Expiring memberships:', '-- Not contacted yet:');
const uncontacted = block('-- Not contacted yet:', '-- Needs attention:');
const attention = block('-- Needs attention:', 'RETURN pg_catalog');

// The snapshot's definition, owner, and grants.
function snapshot(source: string): string {
  return block(
    'CREATE OR REPLACE FUNCTION public.dashboard_action_snapshot(',
    ') TO authenticated;',
    source
  );
}

// What the expand step returned only for the app before Home simplification.
const retiredWaitingDays = [
  ',',
  '            -- Compatibility for the previous app version, which reads whole',
  '            -- days and never expected less than one.',
  "            'waitingDays', GREATEST(",
  '              1,',
  '              pg_catalog.floor(',
  '                EXTRACT(EPOCH FROM (p_now - hydrated.created_at)) / 86400',
  '              )::BIGINT',
  '            )',
].join('\n');
const retiredCounts = [
  "      -- Compatibility for the previous app version's three counts.",
  "      'churnRisk', may_leave.total,",
  "      'trialFollowups', trials.total,",
  "      'failedMandates', COALESCE((SELECT MAX(auto_pay.total) FROM auto_pay), 0),",
  '',
].join('\n');

const retiredReads = [
  'dashboard_action_attention',
  'dashboard_conversation_series',
  'dashboard_lead_rating_inputs',
  'lead_source_conversion',
];

// Read once while the file loads, like the other source scans, so a busy
// parallel run cannot time the scan out.
const SRC = join(process.cwd(), 'src');
const retiredReadCallers = readdirSync(SRC, {
  recursive: true,
  encoding: 'utf8',
})
  .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
  .filter((path) => {
    const source = readFileSync(join(SRC, path), 'utf8');
    return retiredReads.some((name) => source.includes(name));
  });

describe('home queue definitions SQL contract', () => {
  it('replaces the snapshot in place and drops only the retired reads', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.dashboard_action_snapshot(\n  p_today DATE,\n  p_time_zone TEXT,\n  p_now TIMESTAMPTZ,\n  p_limit INTEGER\n)'
    );
    // Exactly these, without CASCADE: anything still depending on a retired
    // read stops the migration.
    expect(migration.match(/^DROP\b.*$/gm)).toEqual([
      'DROP FUNCTION IF EXISTS public.dashboard_action_attention(DATE);',
      'DROP FUNCTION IF EXISTS public.dashboard_conversation_series(INTEGER, TEXT, DATE);',
      'DROP FUNCTION IF EXISTS public.dashboard_lead_rating_inputs(INTEGER, TEXT, DATE);',
      'DROP FUNCTION IF EXISTS public.lead_source_conversion();',
    ]);
    expect(migration).not.toContain(
      'public.dashboard_action_attention(p_today)'
    );
  });

  it('removes only the fields the previous app version parsed', () => {
    // The expand step returned them so either app version worked.
    const expanded = snapshot(expand);
    expect(expanded).toContain(retiredWaitingDays);
    expect(expanded).toContain(retiredCounts);
    // Same signature, populations, error contract, owner, and grants.
    expect(snapshot(migration)).toBe(
      expanded.replace(retiredWaitingDays, '').replace(retiredCounts, '')
    );
    for (const field of [
      'waitingDays',
      'churnRisk',
      'trialFollowups',
      'failedMandates',
    ]) {
      expect(migration).not.toContain(`'${field}'`);
    }
    expect(uncontacted).toContain("'waitingMinutes', GREATEST(");
    expect(attention).toContain("'mayLeave', may_leave.total");
    expect(attention).toContain("'trials', trials.total");
  });

  it('leaves no app code calling a dropped read', () => {
    expect(retiredReadCallers).toEqual([]);
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
