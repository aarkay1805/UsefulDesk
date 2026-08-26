import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260826070646_reconcile_legacy_razorpay_identity_mismatches.sql'
  ),
  'utf8'
);

describe('Razorpay legacy identity-mismatch remediation schema', () => {
  it('keeps the terminal audit immutable and service-only', () => {
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.razorpay_webhook_reconciliations/
    );
    expect(migration).toMatch(
      /ALTER TABLE public\.razorpay_webhook_reconciliations ENABLE ROW LEVEL SECURITY/
    );
    expect(migration).toMatch(
      /REVOKE ALL ON public\.razorpay_webhook_reconciliations[\s\S]*FROM PUBLIC, anon, authenticated, service_role/
    );
    expect(migration).toMatch(
      /GRANT SELECT ON public\.razorpay_webhook_reconciliations TO service_role/
    );
    expect(migration).not.toMatch(
      /GRANT (?:INSERT|UPDATE|DELETE)[^;]*razorpay_webhook_reconciliations/
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.reconcile_razorpay_legacy_identity_mismatch_event[\s\S]*FROM PUBLIC, anon, authenticated/
    );
  });

  it('admits only exact pre-Live Test identity mismatches', () => {
    expect(migration).toContain("p_provider_mode IS DISTINCT FROM 'test'");
    expect(migration).toMatch(
      /processing_status IS DISTINCT FROM 'failed'[\s\S]*provider_mode IS NOT NULL[\s\S]*external_account_id IS NOT NULL[\s\S]*event_identity_source IS NOT NULL[\s\S]*payload_sha256 IS NOT NULL/
    );
    expect(migration).toContain("last_error NOT LIKE 'account mismatch:%'");
    expect(migration).toMatch(
      /payload ->> 'account_id' IS DISTINCT FROM p_external_account_id/
    );
    expect(migration).toMatch(
      /v_payload_account_id IS DISTINCT FROM p_payload_account_id/
    );
    expect(migration).toMatch(
      /activation\.activated_at <= v_event\.created_at/
    );
  });

  it('requires exact provider objects and zero surviving local effects', () => {
    expect(migration).toMatch(
      /v_payload_subscription_id IS DISTINCT FROM p_gateway_subscription_id/
    );
    expect(migration).toMatch(
      /v_payload_payment_id IS DISTINCT FROM p_gateway_payment_id/
    );
    expect(migration).toMatch(
      /v_payload_amount_subunits IS DISTINCT FROM p_amount_subunits/
    );
    expect(migration).toMatch(
      /public\.memberships[\s\S]*public\.contacts[\s\S]*public\.payment_mandates[\s\S]*public\.payments[\s\S]*public\.gateway_charge_exceptions[\s\S]*public\.gateway_payment_exceptions[\s\S]*public\.razorpay_webhook_deliveries/
    );
  });

  it('closes without replaying or rewriting receipt and payload facts', () => {
    const eventUpdate = migration.match(
      /UPDATE public\.webhook_events\s+SET([\s\S]*?)\s+WHERE id = p_event_id/
    );

    expect(eventUpdate).not.toBeNull();
    expect(migration).toMatch(
      /SET provider_mode = p_provider_mode,[\s\S]*external_account_id = p_external_account_id,[\s\S]*processing_status = 'processed'/
    );
    expect(migration).toContain("'local_financial_effect', 'none'");
    expect(migration).not.toMatch(/record_gateway_charge\s*\(/);
    expect(eventUpdate![1]).not.toMatch(/^\s+account_id\s*=/m);
    expect(eventUpdate![1]).not.toMatch(/^\s+payload\s*=/m);
    expect(eventUpdate![1]).not.toMatch(/^\s+event_identity_source\s*=/m);
    expect(eventUpdate![1]).not.toMatch(/^\s+payload_sha256\s*=/m);
  });
});
