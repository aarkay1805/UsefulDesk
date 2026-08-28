import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260827181937_dashboard_insight_aggregates.sql'
  ),
  'utf8'
);

const signatures = [
  'public.dashboard_conversation_series(INTEGER, TEXT, DATE)',
  'public.dashboard_lead_rating_inputs(INTEGER, TEXT, DATE)',
];

function requireInvokerOnly(sql: string) {
  if (/SECURITY DEFINER/i.test(sql)) {
    throw new Error('dashboard insight aggregates may not bypass RLS');
  }
  const invokers = sql.match(/^SECURITY INVOKER$/gim) ?? [];
  if (invokers.length !== 2) {
    throw new Error('both dashboard insight aggregates must be invoker-safe');
  }
}

describe('dashboard insight aggregate migration contract', () => {
  it('keeps both callable functions under selected-branch table RLS', () => {
    requireInvokerOnly(migration);
    expect(() => requireInvokerOnly(`${migration}\nSECURITY DEFINER`)).toThrow(
      'may not bypass RLS'
    );
    expect(migration.match(/SET search_path = ''/g)).toHaveLength(2);
    expect(migration).not.toContain('p_account_id');
    expect(migration).toContain('FROM public.messages AS message');
    expect(migration).toContain('FROM public.contacts AS contact');
    expect(migration).toContain('JOIN public.conversations AS conversation');
    expect(migration).toContain('FROM public.memberships AS membership');
    expect(migration).toContain('FROM public.follow_ups AS follow_up');
  });

  it('revokes default access and grants only authenticated execution', () => {
    for (const signature of signatures) {
      expect(migration).toContain(
        `REVOKE ALL ON FUNCTION ${signature}\n  FROM PUBLIC, anon;`
      );
      expect(migration).toContain(
        `GRANT EXECUTE ON FUNCTION ${signature}\n  TO authenticated;`
      );
    }
    expect(migration).not.toMatch(/TO (?:anon|service_role);/);
  });

  it('validates range and timezone inputs before either aggregate runs', () => {
    expect(migration.match(/p_range_days NOT IN \(7, 30, 90\)/g)).toHaveLength(
      2
    );
    expect(migration.match(/pg_catalog\.pg_timezone_names/g)).toHaveLength(2);
    expect(migration.match(/USING ERRCODE = '22023'/g)).toHaveLength(4);
  });

  it('returns one local-calendar row per requested conversation day', () => {
    expect(migration).toContain(
      'pg_catalog.generate_series(0, p_range_days - 1)'
    );
    expect(migration).toContain(
      '(message.created_at AT TIME ZONE p_time_zone)::DATE'
    );
    expect(migration).toContain("message.sender_type = 'customer'");
    expect(migration).toContain("message.sender_type <> 'customer'");
    expect(migration).toContain('LEFT JOIN counts USING (local_day)');
    expect(migration).toContain('ORDER BY days.local_day');
  });

  it('preserves the lead-rating cohort and metric input rules', () => {
    expect(migration).toContain(
      "COALESCE(NULLIF(TRIM(contact.source), ''), 'unknown')"
    );
    expect(migration).toContain('contact.created_at >= bounds.start_at');
    expect(migration).toContain('contact.created_at < bounds.end_at');
    expect(migration).toContain('conversation.created_at >= bounds.start_at');
    expect(migration).toContain('message.created_at >= cohort.created_at');
    expect(migration).toContain("message.sender_type = 'agent'");
    expect(migration).toContain("INTERVAL '24 hours'");
    expect(migration).toContain('follow_up.due_date <= p_today');
    expect(migration).toContain(
      '(follow_up.due_date + 1)::TIMESTAMP AT TIME ZONE p_time_zone'
    );
    expect(migration).toContain(
      "'renewed', 'paid', 'promised', 'contacted', 'trial_booked'"
    );
    expect(migration).toContain('GROUP BY contact.source');
  });

  it('adds the time-first message index used by the chart boundary', () => {
    expect(migration).toContain(
      'CREATE INDEX IF NOT EXISTS idx_messages_created_at_conversation'
    );
    expect(migration).toContain(
      'ON public.messages(created_at, conversation_id)'
    );
  });
});
