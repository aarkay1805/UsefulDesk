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
  'CREATE OR REPLACE FUNCTION public.finance_overview_snapshot('
);
const orderingMigration = latestMigrationContaining(
  "(row.value ->> ''occurredAt'') COLLATE \"C\" DESC"
);
const allocationPublicationMigration = latestMigrationContaining(
  "tablename = 'payment_refund_allocations'"
);
const overview = readFileSync(
  join(process.cwd(), 'src/lib/finance/overview.ts'),
  'utf8'
);

describe('Finance Overview snapshot SQL contract', () => {
  it('keeps the latest RPC definition idempotent with exact selected-branch access', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.finance_overview_snapshot('
    );
    expect(migration).toContain('STABLE');
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain(
      'p_account_id IS DISTINCT FROM private.authorized_selected_account_id()'
    );
    expect(migration).toContain("USING ERRCODE = '42501'");
    expect(migration).toContain('ALTER FUNCTION');
    expect(migration).toContain('OWNER TO postgres');
    expect(migration).toContain('FROM PUBLIC, anon, service_role');
    expect(migration).toContain('TO authenticated');
    expect(migration).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(migration).not.toMatch(/GRANT[\s\S]*TO\s+service_role/i);
  });

  it('aggregates every existing overview dependency and display section', () => {
    for (const cte of [
      'scoped_payments AS MATERIALIZED',
      'scoped_refunds AS MATERIALIZED',
      'scoped_invoices AS MATERIALIZED',
      'scoped_expenses AS MATERIALIZED',
      'revenue_sections AS',
      'flow_sections AS',
      'invoice_health AS',
      'projection AS',
      'collection_methods AS',
      'recent_transactions AS',
    ]) {
      expect(migration).toContain(cte);
    }
    for (const table of [
      'payments',
      'payment_refunds',
      'invoice_balances',
      'expenses',
      'contacts',
      'memberships',
      'membership_plans',
      'plan_pricing_options',
    ]) {
      expect(migration).toContain(`public.${table}`);
    }
    for (const key of [
      "'period'",
      "'revenue'",
      "'expenses'",
      "'profit'",
      "'projection'",
      "'revenueBreakdown'",
      "'revenueStreams'",
      "'trend'",
      "'previousTrend'",
      "'comparisonThroughDay'",
      "'invoiceHealth'",
      "'collectionMethods'",
      "'recentTransactions'",
    ]) {
      expect(migration).toContain(key);
    }
  });

  it('preserves purpose order, row limits, refunds, and display-precision rules', () => {
    expect(migration).toContain("('joining'::TEXT, 1)");
    expect(migration).toContain("('renewal'::TEXT, 2)");
    expect(migration).toContain("('sale'::TEXT, 3)");
    expect(migration).toContain("('due'::TEXT, 4)");
    expect(migration).toContain("('other'::TEXT, 5)");
    expect(migration).toContain('LIMIT 5');
    expect(migration).toContain('LIMIT 4');
    expect(migration).toContain('invoice.balance >= 0.5');
    expect(migration).toContain('option.price >= 0.5');
    expect(migration).toContain(
      'COALESCE(payment.amount, 0) - COALESCE(refund.amount, 0)'
    );
    expect(migration).toContain(
      "plan.id IS NULL OR plan.plan_type = 'recurring'"
    );
    expect(orderingMigration).toContain(
      "(row.value ->> ''occurredAt'') COLLATE \"C\" DESC"
    );
    expect(orderingMigration).toContain(
      "(transaction.value ->> ''occurredAt'') COLLATE \"C\" DESC"
    );
    expect(orderingMigration).toContain('pg_get_functiondef(');
    expect(orderingMigration).not.toMatch(/SECURITY\s+DEFINER/i);
  });

  it('uses one normal-path RPC and no longer fetches overview datasets', () => {
    const start = overview.indexOf(
      'export async function loadFinanceOverview('
    );
    const end = overview.indexOf('function csvCell(', start);
    const loader = overview.slice(start, end);

    expect(loader.match(/\.rpc\(/g)).toHaveLength(1);
    expect(loader).toContain("'finance_overview_snapshot'");
    expect(loader).toContain('p_account_id: accountId');
    expect(loader).not.toContain('.from(');
    expect(overview).not.toContain('async function fetchAll');
  });

  it('publishes allocation-only invoice balance changes idempotently', () => {
    expect(allocationPublicationMigration).toContain(
      "tablename = 'payment_allocations'"
    );
    expect(allocationPublicationMigration).toContain(
      "tablename = 'payment_refund_allocations'"
    );
    expect(allocationPublicationMigration).toContain(
      'ADD TABLE public.payment_allocations'
    );
    expect(allocationPublicationMigration).toContain(
      'ADD TABLE public.payment_refund_allocations'
    );
  });
});
