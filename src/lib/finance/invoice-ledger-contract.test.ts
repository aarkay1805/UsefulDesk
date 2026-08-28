import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase/migrations');
const migrationName = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .findLast((name) =>
    readFileSync(join(migrationsDir, name), 'utf8').includes(
      'CREATE OR REPLACE FUNCTION public.finance_invoice_ledger_page('
    )
  );

if (!migrationName) throw new Error('Finance invoice ledger migration missing');

const migration = readFileSync(join(migrationsDir, migrationName), 'utf8');
const loader = readFileSync(
  join(process.cwd(), 'src/lib/finance/invoices.ts'),
  'utf8'
);
const component = readFileSync(
  join(process.cwd(), 'src/components/finance/finance-invoices.tsx'),
  'utf8'
);

describe('finance invoice ledger SQL contract', () => {
  it('is a selected-branch SECURITY INVOKER function with authenticated-only ACL', () => {
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain('private.authorized_selected_account_id(');
    expect(migration).toContain("WHEN v_mode = 'export' THEN 'admin'");
    expect(migration).toContain("ELSE 'viewer'");
    expect(migration).toContain("USING ERRCODE = '42501'");
    expect(migration).toContain('OWNER TO postgres');
    expect(migration).toContain('FROM PUBLIC, anon, service_role');
    expect(migration).toContain('TO authenticated');
    expect(migration).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(migration).not.toMatch(/p_account_id\s+UUID/i);
  });

  it('allowlists filters and sorts, clamps pages, and caps bounded reads', () => {
    for (const queue of ['all', 'attention', 'paid', 'upcoming', 'void']) {
      expect(migration).toContain(`'${queue}'`);
    }
    for (const sort of [
      'reference',
      'name',
      'member_id',
      'plan',
      'period',
      'issued_on',
      'total',
      'paid',
      'balance',
    ]) {
      expect(migration).toContain(`'${sort}'`);
    }
    expect(migration).toContain("v_sort_direction NOT IN ('asc', 'desc')");
    expect(migration).toContain('p_page_size > 500');
    expect(migration).toContain('LEAST(');
    expect(migration).toContain('GREATEST(');
    expect(migration).not.toContain('pg_catalog.least(');
    expect(migration).not.toContain('pg_catalog.greatest(');
    expect(migration).toContain('page_context AS MATERIALIZED');
    expect(migration).toContain('page_rows AS MATERIALIZED');
  });

  it('evaluates one month cohort with explicit listing columns and page-only export detail', () => {
    expect(migration.match(/month_rows AS MATERIALIZED/g)).toHaveLength(1);
    expect(migration).toContain('FROM public.invoice_balances AS invoice');
    expect(migration).not.toMatch(/select\s+\*/i);
    expect(migration).not.toContain('memberships.*');
    expect(migration).not.toContain('contacts.*');
    expect(migration).not.toContain('plan_pricing_options');
    expect(migration).toContain("WHERE v_mode = 'export'");
    expect(migration).toContain('pg_catalog.min(source.id::TEXT)');
    expect(migration).toContain(
      'source.invoice_id IN (SELECT row.id FROM page_rows AS row)'
    );
    expect(migration).toContain("'queueCounts'");
    expect(migration).toContain("'planOptions'");
    expect(migration).toContain("'summary'");
    expect(migration).toContain("'snapshotToken'");
  });

  it('keeps the browser listing on one RPC and export on bounded RPC pages', () => {
    const loadBlock = loader.slice(
      loader.indexOf('export async function loadFinanceInvoices('),
      loader.indexOf('export async function loadFinanceInvoiceExportRows(')
    );
    expect(loadBlock.match(/\.rpc\(/g)).toHaveLength(1);
    expect(loadBlock).not.toContain(".from('");
    expect(component).toContain('loadFinanceInvoices(');
    expect(component).toContain('loadFinanceInvoiceExportRows(');
    expect(component).not.toContain('filterFinanceInvoices(');
    expect(component).not.toContain('financeInvoiceSummary(');
  });
});
