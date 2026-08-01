import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

const migration = read(
  'supabase/migrations/20260731120000_finance_revenue_attribution.sql'
);
const paymentFilterMigration = read(
  'supabase/migrations/20260801090000_finance_payment_purpose_filter.sql'
);
const productCheckoutMigration = read(
  'supabase/migrations/20260801160957_products_services_checkout_rpcs.sql'
);

describe('Finance revenue-attribution database contract', () => {
  it('stores an immutable, database-derived payment purpose', () => {
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS payment_purpose TEXT'
    );
    expect(migration).toContain(
      "CHECK (payment_purpose IN ('joining', 'renewal', 'due', 'other'))"
    );
    expect(migration).toContain('trg_protect_membership_payment_purpose');
    expect(migration).toContain(
      "RAISE EXCEPTION 'Payment purpose is immutable'"
    );
    expect(migration).toContain(
      "PERFORM set_config('app.payment_purpose', 'due', TRUE)"
    );
    expect(migration).toContain(
      "PERFORM set_config('app.payment_purpose', 'joining', TRUE)"
    );
  });

  it('classifies exact operation, installment, renewal, and balance paths', () => {
    expect(migration).toMatch(/WHEN 'convert' THEN 'joining'/);
    expect(migration).toMatch(/WHEN 'renew' THEN 'renewal'/);
    expect(migration).toContain("v_operation = 'plan_change'");
    expect(migration).toContain('installment.first_payment_id = payment.id');
    expect(migration).toContain('public.record_joining_payment(');
    expect(migration).toContain("COALESCE(NEW.source, 'manual') = 'auto'");
    expect(migration).toContain("ELSE 'due'");
  });

  it('extends immutable purpose with standalone product and service sales', () => {
    expect(productCheckoutMigration).toContain(
      "CHECK (payment_purpose IN ('joining', 'renewal', 'sale', 'due', 'other'))"
    );
    expect(productCheckoutMigration).toContain(
      "PERFORM set_config('app.payment_purpose', v_purpose, TRUE)"
    );
    expect(productCheckoutMigration).toContain("WHEN 'sale' THEN 'sale'");
  });

  it('keeps joining and later collection browser flows separate', () => {
    const memberForm = read('src/components/members/member-form.tsx');
    const importer = read(
      'src/components/members/import-members-csv-dialog.tsx'
    );
    const recordPayment = read(
      'src/components/members/record-payment-dialog.tsx'
    );
    const bulkPayment = read(
      'src/components/members/bulk-record-payment-dialog.tsx'
    );

    expect(memberForm).toContain("functionName: 'record_joining_payment'");
    expect(importer).toContain("'record_joining_payment'");
    expect(recordPayment).toContain('rpc("record_membership_payment"');
    expect(bulkPayment).toContain('rpc("record_membership_payment"');
  });

  it('implements a branch-scoped acquisition cohort with to-date outcomes', () => {
    expect(migration).toContain('finance_overview_ad_performance');
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toContain('public.is_account_member(contact.account_id)');
    expect(migration).toContain("IN ('instagram', 'facebook')");
    expect(migration).toContain("contact.received_via = 'meta'");
    expect(migration).toContain('membership.is_trial = FALSE');
    expect(migration).toContain("payment.status = 'paid'");
    expect(migration).toContain("payment.payment_purpose = 'joining'");
    expect(migration).toContain("expense.status = 'posted'");
    expect(migration).toContain("LOWER(BTRIM(category.name)) = 'marketing'");
    expect(migration).toContain('WHEN stats.leads = 0 THEN NULL');
    expect(migration).toContain('WHEN spend.ad_spend = 0 THEN NULL');
  });

  it('limits callable read and write APIs to authenticated users', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.record_joining_payment[\s\S]*FROM PUBLIC, anon;/
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.record_joining_payment[\s\S]*TO authenticated;/
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.finance_overview_ad_performance[\s\S]*FROM PUBLIC, anon;/
    );
  });

  it('filters the analytical payment ledger by immutable revenue purpose', () => {
    expect(paymentFilterMigration).toContain('p_purposes TEXT[] DEFAULT NULL');
    expect(paymentFilterMigration).toContain(
      'payment.payment_purpose = ANY(p_purposes)'
    );
    expect(paymentFilterMigration).toContain('SECURITY INVOKER');
    expect(paymentFilterMigration).toContain(
      'public.is_account_member(payment.account_id)'
    );
    expect(paymentFilterMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.finance_payment_ledger[\s\S]*FROM PUBLIC, anon;/
    );
    expect(paymentFilterMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.finance_payment_ledger[\s\S]*TO authenticated;/
    );
  });
});
