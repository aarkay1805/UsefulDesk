import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260828200000_avoid_dashboard_timezone_catalog_scans.sql'
  ),
  'utf8'
);

describe('dashboard_action_snapshot SQL contract', () => {
  it('uses the caller RLS context and authenticated-only execution', () => {
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).not.toContain('SECURITY DEFINER');
    expect(migration).not.toContain('p_account_id');
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.dashboard_action_snapshot\([\s\S]*?FROM PUBLIC, anon, service_role;/
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.dashboard_action_snapshot\([\s\S]*?TO authenticated;/
    );
  });

  it('rejects invalid calendar and preview inputs', () => {
    expect(migration).not.toContain('pg_timezone_names');
    expect(migration).toContain(
      'PERFORM pg_catalog.timezone(p_time_zone, p_now);'
    );
    expect(migration).toContain('EXCEPTION WHEN invalid_parameter_value THEN');
    expect(migration).toContain('p_today IS NULL OR p_now IS NULL');
    expect(migration).toContain(
      'p_limit IS NULL OR p_limit < 1 OR p_limit > 8'
    );
    expect(migration).toContain("USING ERRCODE = '22023'");
  });

  it('keeps every preview bounded and every section independently nullable', () => {
    expect(migration.match(/LIMIT p_limit/g)).toHaveLength(3);
    expect(migration).toContain('LIMIT p_limit * 2');
    expect(migration).toContain('ranked.all_rank <= p_limit');
    expect(migration).toContain('ranked.scope_rank <= p_limit');
    expect(migration).toContain('pg_catalog.left(');
    expect(migration).toContain('160');
    for (const section of [
      'gymMetrics',
      'followUps',
      'expiringMemberships',
      'uncontactedLeads',
      'attention',
    ]) {
      expect(migration).toContain(`array_append(v_errors, '${section}')`);
    }
    expect(migration.match(/EXCEPTION WHEN OTHERS THEN/g)).toHaveLength(5);
  });

  it('preserves domain predicates and selected-branch timezone math', () => {
    for (const relation of [
      'member_activity',
      'membership_dues',
      'payments',
      'memberships',
      'follow_ups',
      'profiles',
      'contacts',
      'conversations',
      'dashboard_action_attention',
    ]) {
      expect(migration).toContain(`public.${relation}`);
    }
    expect(migration).toContain('due.balance >= 0.5');
    expect(migration).toContain("plan.plan_type = 'recurring'");
    expect(migration).toContain('contact.lead_status IS NULL');
    expect(migration).toContain("p_now - INTERVAL '24 hours'");
    expect(migration).toContain('AT TIME ZONE p_time_zone');
    expect(migration).toContain("payment.status = 'paid'");
  });
});
