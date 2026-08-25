import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260824235500_immutable_invoice_identity.sql'
);

describe('immutable invoice identity migration contract', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  it('owns account-scoped profile and counter writes in the database', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.invoice_profiles');
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS public.account_invoice_number_counters'
    );
    expect(sql).toContain('save_invoice_profile');
    expect(sql).toContain("is_account_member(account_id, 'admin')");
    expect(sql).toMatch(
      /REVOKE ALL ON public\.invoice_profiles FROM PUBLIC, anon, authenticated/i
    );
    expect(sql).toMatch(
      /REVOKE ALL ON public\.account_invoice_number_counters FROM PUBLIC, anon, authenticated/i
    );
  });

  it('allocates deterministic immutable invoice identities', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS invoice_sequence BIGINT/i);
    expect(sql).toMatch(/UNIQUE \(account_id, invoice_sequence\)/i);
    expect(sql).toMatch(/UNIQUE \(account_id, invoice_number\)/i);
    expect(sql).toContain("'INV-' || LPAD");
    expect(sql).toContain('IF NEW.invoice_sequence >= 1000000 THEN');
    expect(sql).toContain('ORDER BY issued_at, created_at, id');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('prevent_invoice_identity_mutation');
    expect(sql).toContain("ERRCODE = '22000'");
  });

  it('builds trusted versioned party snapshots', () => {
    expect(sql).toContain('build_invoice_seller_snapshot');
    expect(sql).toContain('build_invoice_customer_snapshot');
    expect(sql).toContain('seller_snapshot IS NULL');
    expect(sql).toContain('identity_snapshot_version');
  });

  it('rejects null identity forgery and gates seller finalization to the profile RPC', () => {
    const mutationGuard = sql.match(
      /CREATE OR REPLACE FUNCTION public\.prevent_invoice_identity_mutation\(\)[\s\S]*?\n\$\$;/i
    )?.[0];
    const profileSave = sql.match(
      /CREATE OR REPLACE FUNCTION public\.save_invoice_profile\([\s\S]*?\n\$\$;/i
    )?.[0];

    expect(mutationGuard).toBeDefined();
    for (const field of [
      'invoice_sequence',
      'invoice_number',
      'customer_snapshot',
      'identity_snapshot_version',
    ]) {
      expect(mutationGuard).toMatch(
        new RegExp(
          `IF NEW\\.${field} IS DISTINCT FROM OLD\\.${field} THEN`,
          'i'
        )
      );
      expect(mutationGuard).not.toMatch(
        new RegExp(
          `OLD\\.${field} IS NOT NULL\\s+AND NEW\\.${field} IS DISTINCT`,
          'i'
        )
      );
    }

    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS private.invoice_profile_save_guards'
    );
    expect(sql).toMatch(
      /REVOKE ALL ON private\.invoice_profile_save_guards\s+FROM PUBLIC, anon, authenticated, service_role/i
    );
    expect(mutationGuard).toContain(
      'FROM private.invoice_profile_save_guards guard'
    );
    expect(mutationGuard).toContain('SECURITY DEFINER');
    expect(mutationGuard).toContain(
      'guard.transaction_id = pg_catalog.txid_current()'
    );
    expect(mutationGuard).toContain(
      'guard.seller_snapshot = NEW.seller_snapshot'
    );
    expect(mutationGuard).toContain(
      'build_invoice_seller_snapshot(NEW.account_id)'
    );
    expect(profileSave).toContain(
      'INSERT INTO private.invoice_profile_save_guards'
    );
    expect(profileSave).toContain(
      'DELETE FROM private.invoice_profile_save_guards'
    );
    expect(sql).not.toContain('app.invoice_profile_save');
  });

  it('preserves the complete refund-aware invoice balance view', () => {
    const view = sql.match(
      /CREATE OR REPLACE VIEW public\.invoice_balances[\s\S]*?FROM public\.invoices i[\s\S]*?GROUP BY i\.id[^;]*;/i
    )?.[0];

    expect(view).toBeDefined();
    for (const column of [
      'invoice_sequence',
      'invoice_number',
      'seller_snapshot',
      'customer_snapshot',
      'identity_snapshot_version',
      'total',
      'amount_paid',
      'credit_applied',
      'balance',
      'gross_total',
      'gross_amount_paid',
      'processed_refund_amount',
      'net_amount_paid',
      'invoice_adjustment_amount',
      'net_total',
      'accounting_balance',
      'requires_refund_review',
      'collectible_balance',
    ]) {
      expect(view).toContain(column);
    }
  });
});
