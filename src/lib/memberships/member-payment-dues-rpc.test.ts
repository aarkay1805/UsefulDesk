import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260829040000_consolidate_member_payment_dues.sql'
  ),
  'utf8'
);
const repairMigration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260829041000_repair_member_payment_dues_extrema.sql'
  ),
  'utf8'
);
const table = readFileSync(
  resolve(process.cwd(), 'src/components/members/payments-table.tsx'),
  'utf8'
);
const page = readFileSync(
  resolve(process.cwd(), 'src/app/(dashboard)/members/page.tsx'),
  'utf8'
);

describe('member_payment_dues_page SQL contract', () => {
  it('runs on caller privileges with an empty path and authenticated-only execution', () => {
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toContain("SET search_path = ''");
    expect(migration).not.toContain('SECURITY DEFINER');
    expect(migration).not.toContain('p_account_id');
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.member_payment_dues_page\([\s\S]*?FROM PUBLIC, anon, service_role;/
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.member_payment_dues_page\([\s\S]*?TO authenticated;/
    );
  });

  it('materializes one RLS-visible dues scope and returns the complete bounded contract', () => {
    expect(migration.match(/due_scope AS MATERIALIZED/g)).toHaveLength(1);
    expect(migration.match(/payment_totals AS/g)).toHaveLength(1);
    for (const field of [
      "'rows'",
      "'page'",
      "'totalCount'",
      "'outstandingCount'",
      "'bucketCounts'",
      "'planOptions'",
      "'summary'",
      "'today'",
      "'week'",
      "'month'",
      "'outstanding'",
    ]) {
      expect(migration).toContain(field);
    }
    expect(migration).toContain('LIMIT p_page_size');
    expect(migration).toContain('OFFSET (SELECT page * p_page_size');
  });

  it('preserves member search, plan/status facets, every sort, and account-timezone totals', () => {
    expect(migration).toContain("due.row_json->>'member_number'");
    expect(migration).toContain('due.contact_phone');
    expect(migration).toContain('due.plan_id = ANY(v_plan_ids)');
    expect(migration).toContain('due.due_bucket = ANY(v_buckets)');
    for (const sort of ['name', 'plan', 'due_date', 'status', 'balance']) {
      expect(migration).toContain(`v_sort_key = '${sort}'`);
    }
    expect(migration).toContain(
      '(payment.paid_at AT TIME ZONE account.timezone)::DATE'
    );
    expect(migration).toContain("payment.status = 'paid'");
    expect(migration).toContain('public.membership_dues');
  });

  it('rejects unsafe inputs and keeps all list work behind the single client loader', () => {
    expect(migration).toContain("USING ERRCODE = '22004'");
    expect(migration.match(/USING ERRCODE = '22023'/g)?.length).toBeGreaterThan(
      6
    );
    expect(migration).toContain('p_page_size > 100');
    expect(table).toContain('loadMemberPaymentDues');
    expect(table).not.toContain("from('memberships')");
    expect(table).not.toContain("from('payments')");
    expect(table).not.toContain("from('membership_dues')");
    expect(page).not.toContain('PaymentSummaryTiles');
  });

  it('repairs unqualified SQL extrema forward without editing applied history', () => {
    expect(repairMigration).toContain('pg_catalog.pg_get_functiondef');
    expect(repairMigration).toContain("'pg_catalog.least'");
    expect(repairMigration).toContain("'pg_catalog.greatest'");
    expect(repairMigration).toContain("'least'");
    expect(repairMigration).toContain("'greatest'");
    expect(repairMigration).toContain('REVOKE ALL ON FUNCTION');
    expect(repairMigration).toContain('TO authenticated;');
  });
});
