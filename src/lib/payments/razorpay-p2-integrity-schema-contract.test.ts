import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

const migration = read(
  'supabase/migrations/20260826210000_resolve_razorpay_p2_integrity_gaps.sql'
);
const branchAuthorizationFix = read(
  'supabase/migrations/20260826220000_fix_razorpay_mandate_cancellation_branch_authorization.sql'
);
const webhook = read('src/lib/payments/razorpay-webhook-processor.ts');
const links = read('src/lib/payments/razorpay-payment-links.ts');
const cancellation = read('src/lib/payments/razorpay-mandates.ts');
const member = read('src/components/members/member-detail-view.tsx');

describe('Razorpay P2 integrity migration', () => {
  it('binds an unprocessed null-account event only through exact merchant and mode recovery', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.claim_razorpay_webhook_recovery_batch/
    );
    expect(migration).toMatch(
      /event\.account_id IS NULL[\s\S]*credentials\.authentication_mode = 'oauth'[\s\S]*credentials\.provider_mode = event\.provider_mode[\s\S]*credentials\.razorpay_account_id = event\.external_account_id/
    );
    expect(webhook).toMatch(/if \(!accountId\) \{[\s\S]*throw new Error/);
  });

  it('stamps recurring ledger or exception time under exact provider identity', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.stamp_razorpay_gateway_charge_provider_time/
    );
    expect(migration).toMatch(
      /\(p_payment_id IS NULL\) = \(p_exception_id IS NULL\)/
    );
    expect(migration).toMatch(
      /source = 'auto'[\s\S]*gateway_payment_id = p_gateway_payment_id/
    );
    expect(migration).toMatch(
      /gateway_charge_exceptions[\s\S]*gateway_paid_at = p_provider_created_at/
    );
    expect(webhook.indexOf("'record_gateway_charge'")).toBeLessThan(
      webhook.indexOf("'stamp_razorpay_gateway_charge_provider_time'")
    );
  });

  it('stamps Payment Link ledger, exception, and link time from fetched provider facts', () => {
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS provider_created_at TIMESTAMPTZ'
    );
    expect(migration).toMatch(
      /source = 'payment_link'[\s\S]*gateway_metadata->>'payment_link_id' = link.gateway_link_id/
    );
    expect(migration).toMatch(
      /razorpay_payment_links[\s\S]*paid_at = p_provider_created_at/
    );
    expect(links).toMatch(
      /providerPaymentTime\(payment\)[\s\S]*record_gateway_invoice_payment[\s\S]*stamp_razorpay_payment_link_provider_time/
    );
  });

  it('keeps every new financial and lifecycle RPC service-only', () => {
    for (const name of [
      'stamp_razorpay_gateway_charge_provider_time',
      'stamp_razorpay_payment_link_provider_time',
      'finalize_razorpay_mandate_cancellation',
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${name}\\([\\s\\S]*?FROM PUBLIC, anon, authenticated;`
        )
      );
      expect(migration).toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION public\\.${name}\\([\\s\\S]*?TO service_role;`
        )
      );
    }
  });

  it('audits an admin cancellation only after exact provider terminal confirmation', () => {
    for (const source of [migration, branchAuthorizationFix]) {
      expect(source).toMatch(
        /public\.account_memberships AS membership[\s\S]*membership\.user_id = p_actor[\s\S]*membership\.account_id = p_account_id[\s\S]*membership\.role IN \('owner', 'admin'\)/
      );
      expect(source).not.toMatch(/public\.profiles AS profile/);
    }
    expect(migration).toMatch(
      /account_id = p_account_id[\s\S]*gateway_subscription_id = p_gateway_subscription_id[\s\S]*FOR UPDATE/
    );
    expect(migration).toMatch(
      /cancelled_by = COALESCE\(cancelled_by, p_actor\)[\s\S]*cancellation_reason = COALESCE/
    );
    expect(migration).toMatch(
      /memberships AS membership[\s\S]*collection_mode = 'manual'/
    );
    expect(cancellation).toMatch(
      /cancelSubscription\([\s\S]*fetchRemote\(\)[\s\S]*terminalStatus\(remote\)/
    );
    expect(member).toContain('Cancel auto-pay');
  });
});
