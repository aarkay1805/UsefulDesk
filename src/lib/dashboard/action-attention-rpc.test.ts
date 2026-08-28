import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260828120000_dashboard_action_attention.sql'
  ),
  'utf8'
);

const signature = 'public.dashboard_action_attention(DATE)';

function requireInvokerOnly(sql: string) {
  if (/SECURITY DEFINER/i.test(sql)) {
    throw new Error('dashboard action attention may not bypass RLS');
  }
  if ((sql.match(/^SECURITY INVOKER$/gim) ?? []).length !== 1) {
    throw new Error('dashboard action attention must be invoker-safe');
  }
}

describe('dashboard action attention migration contract', () => {
  it('keeps selected-branch table RLS as the tenant boundary', () => {
    requireInvokerOnly(migration);
    expect(() => requireInvokerOnly(`${migration}\nSECURITY DEFINER`)).toThrow(
      'may not bypass RLS'
    );
    expect(migration).toContain("SET search_path = ''");
    expect(migration).not.toContain('p_account_id');
    expect(migration).toContain('FROM public.memberships AS membership');
    expect(migration).toContain('JOIN public.contacts AS contact');
    expect(migration).toContain('FROM public.payment_mandates AS failed');
  });

  it('grants authenticated viewers the aggregate without public, anon, or service-role execution', () => {
    expect(migration).toContain(
      `REVOKE ALL ON FUNCTION ${signature}\n  FROM PUBLIC, anon, service_role;`
    );
    expect(migration).toContain(
      `GRANT EXECUTE ON FUNCTION ${signature}\n  TO authenticated;`
    );
    expect(migration).not.toMatch(
      /GRANT EXECUTE[\s\S]*TO (?:anon|service_role);/
    );
  });

  it('validates the branch-calendar input and returns only rendered counts', () => {
    expect(migration).toContain('IF p_today IS NULL THEN');
    expect(migration).toContain("USING ERRCODE = '22004'");
    expect(migration).toMatch(
      /RETURNS TABLE \(\s*churn_risk BIGINT,\s*trial_followups BIGINT,\s*failed_mandates BIGINT\s*\)/
    );
    expect(migration).toContain('membership.end_date >= p_today');
    expect(migration).toContain('membership.end_date <= p_today + 3');
    expect(migration).toContain("failed.status = 'failed'");
    expect(migration).toContain("active.status = 'active'");
    expect(migration).not.toContain('generate_series');
    expect(migration).not.toContain('public.payments');
    expect(migration).not.toContain('public.attendance');
  });
});
