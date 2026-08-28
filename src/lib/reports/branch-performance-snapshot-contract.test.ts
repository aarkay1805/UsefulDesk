import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase/migrations');
const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

function latestMigrationContaining(fragment: string) {
  const name = migrations
    .filter((migrationName) =>
      readFileSync(join(migrationsDir, migrationName), 'utf8').includes(
        fragment
      )
    )
    .at(-1);
  if (!name) throw new Error(`No migration contains ${fragment}`);
  return readFileSync(join(migrationsDir, name), 'utf8');
}

const migration = latestMigrationContaining(
  'CREATE OR REPLACE FUNCTION public.selected_branch_performance_snapshot('
);
const reporting = readFileSync(
  join(process.cwd(), 'src/lib/reports/reporting.ts'),
  'utf8'
);

describe('branch performance snapshot SQL contract', () => {
  it('keeps the latest RPC definition idempotent with owner-only branch isolation', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.selected_branch_performance_snapshot('
    );
    expect(migration).toContain('STABLE');
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain(
      "IF NOT public.is_account_member(p_account_id, 'owner') THEN"
    );
    expect(migration).toContain("USING ERRCODE = '42501'");
    expect(migration).toContain('ALTER FUNCTION');
    expect(migration).toContain('OWNER TO postgres');
    expect(migration).toContain('FROM PUBLIC, anon');
    expect(migration).toContain('TO authenticated');
    expect(migration).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(migration).not.toMatch(/TO\s+service_role/i);
  });

  it('shares every overlapping branch input instead of wrapping legacy RPCs', () => {
    for (const cte of [
      'scoped_contacts AS MATERIALIZED',
      'scoped_memberships AS MATERIALIZED',
      'scoped_periods AS MATERIALIZED',
      'scoped_payments AS MATERIALIZED',
      'scoped_attendance AS MATERIALIZED',
      'scoped_dues AS MATERIALIZED',
      'scoped_activity AS MATERIALIZED',
      'scoped_mandates AS MATERIALIZED',
      'scoped_expenses AS MATERIALIZED',
      'member_joined AS MATERIALIZED',
      'first_period AS MATERIALIZED',
      'acquisition_cohort AS MATERIALIZED',
    ]) {
      expect(migration).toContain(cte);
    }
    for (const table of [
      'contacts',
      'memberships',
      'membership_periods',
      'payments',
      'attendance',
      'expenses',
    ]) {
      expect(migration).toContain(`public.${table}`);
    }
    for (const legacy of [
      'public.owner_report(',
      'public.owner_report_source_revenue(',
      'public.owner_report_plan_options(',
      'public.owner_report_average_sale_price(',
      'public.finance_overview_ad_performance(',
    ]) {
      expect(migration).not.toContain(legacy);
    }
  });

  it('returns every existing report slice and preserves staff/month semantics', () => {
    for (const key of [
      "'report'",
      "'period'",
      "'metrics'",
      "'averageSalePrice'",
      "'attention'",
      "'trend'",
      "'plans'",
      "'billingOptions'",
      "'sources'",
      "'collectionMethods'",
      "'collectionSources'",
      "'sourceOptions'",
      "'adPerformance'",
      "'expenseTotals'",
    ]) {
      expect(migration).toContain(key);
    }
    expect(migration).toContain(
      'p_staff_user_id IS NULL\n          OR contact.assigned_to = p_staff_user_id'
    );
    expect(migration).toContain(
      "'adPerformance', CASE WHEN p_staff_user_id IS NULL THEN"
    );
    expect(migration).toContain(
      "'expenseTotals', CASE WHEN p_staff_user_id IS NULL THEN"
    );
    expect(migration).toContain("DATE_TRUNC('month', report_start::TIMESTAMP)");
    expect(migration).toContain(
      "COALESCE(NULLIF(BTRIM(p_time_zone), ''), 'UTC')"
    );
  });

  it('uses one normal-path client RPC and retains only a missing-schema fallback', () => {
    const start = reporting.indexOf(
      'export async function loadBranchPerformanceSnapshot('
    );
    const end = reporting.indexOf(
      '/** Read the live operating snapshot',
      start
    );
    const loader = reporting.slice(start, end);
    const beforeFallback = loader.slice(
      0,
      loader.indexOf(
        "if (!missingRpc(error, 'selected_branch_performance_snapshot'))"
      )
    );

    expect(beforeFallback.match(/\.rpc\(/g)).toHaveLength(1);
    expect(beforeFallback).toContain("'selected_branch_performance_snapshot'");
    expect(loader).toContain(
      "if (!missingRpc(error, 'selected_branch_performance_snapshot')) throw error"
    );
    expect(loader).toContain('loadOwnerReport(');
    expect(loader).toContain('loadFinanceAdPerformance(');
    expect(loader).toContain('loadFinanceExpenseTotals(');
  });
});
