import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

const migration = read(
  'supabase/migrations/20260804233201_harden_razorpay_recurring_charges.sql'
);
const mandateRoute = read('src/app/api/payments/razorpay/mandate/route.ts');
const webhookRoute = read(
  'src/app/api/payments/razorpay/webhook/[accountId]/route.ts'
);
const connectionRoute = read(
  'src/app/api/payments/razorpay/connection/route.ts'
);

describe('Razorpay recurring payment hardening contract', () => {
  it('reserves one blocking local setup before creating remote resources', () => {
    const reservation = mandateRoute.indexOf("status: 'creating'");
    const plan = mandateRoute.indexOf('createPlan(authentication');
    const subscription = mandateRoute.indexOf(
      'createSubscription(authentication'
    );

    expect(reservation).toBeGreaterThan(0);
    expect(plan).toBeGreaterThan(reservation);
    expect(subscription).toBeGreaterThan(plan);
    expect(mandateRoute).toMatch(/notes:\s*\{[\s\S]*mandate_id: mandateId/);
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uniq_payment_mandate_blocking[\s\S]*status IN \('creating', 'pending', 'active', 'paused', 'orphaned'\)/
    );
    expect(migration).toMatch(
      /REVOKE INSERT, UPDATE, DELETE ON public\.payment_mandates FROM authenticated/
    );
  });

  it('compensates a remote subscription when local persistence fails', () => {
    expect(mandateRoute).toMatch(
      /persistError[\s\S]*runRazorpayOperation\([\s\S]*cancelSubscription\(authentication[\s\S]*status: cancelled \? 'failed' : 'orphaned'/
    );
    expect(mandateRoute).toMatch(
      /transport failure or 5xx[\s\S]*status: knownRejection \? 'failed' : 'orphaned'/
    );
    expect(mandateRoute).toMatch(
      /existing\.status === 'pending'[\s\S]*gateway_short_url[\s\S]*deduped: true/
    );
  });

  it('addresses charges by provider sequence and a frozen membership period', () => {
    expect(webhookRoute).toMatch(
      /p_provider_paid_count: sub\.paid_count \?\? null/
    );
    expect(webhookRoute).toMatch(
      /p_gateway_subscription_id: sub\.id[\s\S]*p_gateway_invoice_id:/
    );
    expect(migration).toMatch(
      /v_expected_count := v_mandate\.last_applied_paid_count \+ 1/
    );
    expect(migration).toMatch(
      /IF p_provider_paid_count = 1 THEN[\s\S]*v_target_end := v_mandate\.initial_period_end/
    );
    expect(migration).toMatch(
      /The explicit period has balance[\s\S]*the charge was not moved to another cycle/
    );
    expect(migration).toMatch(
      /legacy_payload_missing_charge_identity[\s\S]*was not applied automatically/
    );
    expect(migration).not.toMatch(
      /current cycle is settled[\s\S]*open the next one/
    );
  });

  it('preserves confirmed-but-unapplied charges and completes their webhook', () => {
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.gateway_charge_exceptions/
    );
    expect(migration).toMatch(/UNIQUE \(account_id, gateway_payment_id\)/);
    expect(migration).toMatch(
      /'target_balance_mismatch'[\s\S]*RETURN QUERY SELECT 'exception'/
    );
    expect(webhookRoute).toMatch(
      /result\?\.outcome === 'exception'[\s\S]*console\.warn/
    );
    expect(connectionRoute).toMatch(
      /from\('gateway_charge_exceptions'\)[\s\S]*unappliedChargeCount/
    );
  });

  it('keeps manual allocation proportional while restricting auto-pay', () => {
    expect(migration).toMatch(
      /IF NEW\.source = 'auto' THEN[\s\S]*period\.period_end = NEW\.period_end/
    );
    expect(migration).toMatch(
      /NEW\.source <> 'auto' OR line\.id = v_auto_line_id/
    );
    expect(migration).toMatch(
      /v_payment_cents \* balance_cents \/ v_invoice_cents/
    );
  });
});
