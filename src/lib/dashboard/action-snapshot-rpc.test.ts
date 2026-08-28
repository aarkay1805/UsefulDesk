import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const snapshotMigration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260828200000_avoid_dashboard_timezone_catalog_scans.sql'
  ),
  'utf8'
);

const duesMigration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260829020000_reduce_dashboard_action_snapshot_dues.sql'
  ),
  'utf8'
);

describe('dashboard_action_snapshot SQL contract', () => {
  it('uses the caller RLS context and authenticated-only execution', () => {
    expect(snapshotMigration).toContain('SECURITY INVOKER');
    expect(snapshotMigration).not.toContain('SECURITY DEFINER');
    expect(snapshotMigration).not.toContain('p_account_id');
    expect(snapshotMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.dashboard_action_snapshot\([\s\S]*?FROM PUBLIC, anon, service_role;/
    );
    expect(snapshotMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.dashboard_action_snapshot\([\s\S]*?TO authenticated;/
    );
  });

  it('rejects invalid calendar and preview inputs', () => {
    expect(snapshotMigration).not.toContain('pg_timezone_names');
    expect(snapshotMigration).toContain(
      'PERFORM pg_catalog.timezone(p_time_zone, p_now);'
    );
    expect(snapshotMigration).toContain(
      'EXCEPTION WHEN invalid_parameter_value THEN'
    );
    expect(snapshotMigration).toContain('p_today IS NULL OR p_now IS NULL');
    expect(snapshotMigration).toContain(
      'p_limit IS NULL OR p_limit < 1 OR p_limit > 8'
    );
    expect(snapshotMigration).toContain("USING ERRCODE = '22023'");
  });

  it('keeps every preview bounded and every section independently nullable', () => {
    expect(snapshotMigration.match(/LIMIT p_limit/g)).toHaveLength(3);
    expect(snapshotMigration).toContain('LIMIT p_limit * 2');
    expect(snapshotMigration).toContain('ranked.all_rank <= p_limit');
    expect(snapshotMigration).toContain('ranked.scope_rank <= p_limit');
    expect(snapshotMigration).toContain('pg_catalog.left(');
    expect(snapshotMigration).toContain('160');
    for (const section of [
      'gymMetrics',
      'followUps',
      'expiringMemberships',
      'uncontactedLeads',
      'attention',
    ]) {
      expect(snapshotMigration).toContain(
        `array_append(v_errors, '${section}')`
      );
    }
    expect(snapshotMigration.match(/EXCEPTION WHEN OTHERS THEN/g)).toHaveLength(
      5
    );
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
      expect(snapshotMigration).toContain(`public.${relation}`);
    }
    expect(snapshotMigration).toContain('due.balance >= 0.5');
    expect(snapshotMigration).toContain("plan.plan_type = 'recurring'");
    expect(snapshotMigration).toContain('contact.lead_status IS NULL');
    expect(snapshotMigration).toContain("p_now - INTERVAL '24 hours'");
    expect(snapshotMigration).toContain('AT TIME ZONE p_time_zone');
    expect(snapshotMigration).toContain("payment.status = 'paid'");
  });
});

describe('dashboard dues optimization SQL contract', () => {
  it('materializes the general invoice expansion once without replacing the RPC', () => {
    expect(duesMigration).toContain('WITH current_periods AS MATERIALIZED');
    expect(duesMigration).toContain(
      'FROM public.membership_period_invoices AS period'
    );
    expect(duesMigration).not.toContain('dashboard_action_snapshot');
  });

  it('preserves current-period identity and exact collectible fallbacks', () => {
    expect(duesMigration).toContain(
      'current_period.membership_id = membership.id'
    );
    expect(duesMigration).toContain(
      'current_period.period_end = membership.end_date'
    );
    expect(duesMigration).toContain(
      'current_period.collectible_balance,\n    membership.fee_amount'
    );
    expect(duesMigration).toContain(
      'current_period.accounting_balance,\n    membership.fee_amount'
    );
    expect(duesMigration).toContain("membership.status <> 'cancelled'");
  });

  it('keeps the view invoker-scoped and the selected-account policy row-bound', () => {
    const definerPattern = /SECURITY DEFINER/;
    const writePolicyPattern =
      /CREATE POLICY membership_periods_(?:insert|update|delete)/;

    expect('SECURITY DEFINER').toMatch(definerPattern);
    expect('CREATE POLICY membership_periods_update').toMatch(
      writePolicyPattern
    );
    expect(duesMigration).toContain('WITH (security_invoker = true)');
    expect(duesMigration).not.toMatch(definerPattern);
    expect(duesMigration).toContain(
      'account_id = (SELECT private.authorized_selected_account_id())'
    );
    expect(duesMigration).toContain(
      'GRANT SELECT ON public.membership_dues TO authenticated, service_role;'
    );
    expect(duesMigration).not.toMatch(writePolicyPattern);
  });
});
