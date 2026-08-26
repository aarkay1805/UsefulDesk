import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

const migration = read(
  'supabase/migrations/20260804233201_harden_razorpay_recurring_charges.sql'
);
const recoveryMigration = read(
  'supabase/migrations/20260826033801_razorpay_recurring_charge_recovery.sql'
);
const sourceReconciliationMigration = read(
  'supabase/migrations/20260826034807_razorpay_subscription_source_reconciliation.sql'
);
const effectiveAllocatorMigration = readdirSync(
  resolve(process.cwd(), 'supabase/migrations')
)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({
    name,
    sql: read(`supabase/migrations/${name}`),
  }))
  .filter(({ sql }) =>
    sql.includes('CREATE OR REPLACE FUNCTION public.allocate_invoice_payment()')
  )
  .at(-1);
const mandateRoute = read('src/app/api/payments/razorpay/mandate/route.ts');
const webhookProcessor = read('src/lib/payments/razorpay-webhook-processor.ts');
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
    expect(webhookProcessor).toMatch(
      /p_provider_paid_count: sub\.paid_count \?\? null/
    );
    expect(webhookProcessor).toMatch(
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
    expect(webhookProcessor).toMatch(
      /result\?\.outcome === 'exception'[\s\S]*console\.warn/
    );
    expect(connectionRoute).toMatch(
      /from\('gateway_charge_exceptions'\)[\s\S]*unappliedChargeCount/
    );
  });

  it('replays only the next recoverable recurring charge and resolves it atomically', () => {
    expect(recoveryMigration).toMatch(
      /ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ/
    );
    expect(recoveryMigration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.claim_gateway_charge_exception_recovery_batch/
    );
    expect(recoveryMigration).toMatch(
      /reason_code = 'charge_sequence_mismatch'[\s\S]*provider_paid_count = mandate\.last_applied_paid_count \+ 1/
    );
    expect(recoveryMigration).toMatch(
      /ORDER BY exception\.account_id, exception\.mandate_id,[\s\S]*exception\.provider_paid_count[\s\S]*FOR UPDATE OF exception SKIP LOCKED/
    );
    expect(recoveryMigration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.recover_gateway_charge_exception[\s\S]*FOR UPDATE[\s\S]*public\.record_gateway_charge/
    );
    expect(recoveryMigration).toMatch(
      /IF v_outcome = 'applied' THEN[\s\S]*status = 'resolved'[\s\S]*resolved_at = now\(\)/
    );
    expect(recoveryMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.recover_gateway_charge_exception[\s\S]*FROM PUBLIC, anon, authenticated[\s\S]*GRANT EXECUTE[\s\S]*TO service_role/
    );
  });

  it('polls bounded provider sources and preserves missed-webhook charges for review', () => {
    expect(sourceReconciliationMigration).toMatch(
      /ADD COLUMN IF NOT EXISTS provider_reconcile_at TIMESTAMPTZ/
    );
    expect(sourceReconciliationMigration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.claim_razorpay_subscription_reconciliation_batch/
    );
    expect(sourceReconciliationMigration).toMatch(
      /mandate\.status IN \('pending', 'active'\)[\s\S]*credential\.provider_mode = p_provider_mode[\s\S]*FOR UPDATE OF mandate SKIP LOCKED/
    );
    expect(sourceReconciliationMigration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.preserve_razorpay_provider_charge_observation[\s\S]*gateway_subscription_id IS DISTINCT FROM p_gateway_subscription_id[\s\S]*provider_charge_missing_webhook/
    );
    expect(sourceReconciliationMigration).toMatch(
      /status = 'open'[\s\S]*next_retry_at = NULL/
    );
    expect(sourceReconciliationMigration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.finish_razorpay_subscription_reconciliation[\s\S]*interval '24 hours'[\s\S]*provider_recovery_owner = p_recovery_owner/
    );
    expect(sourceReconciliationMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.preserve_razorpay_provider_charge_observation[\s\S]*FROM PUBLIC, anon, authenticated[\s\S]*GRANT EXECUTE[\s\S]*TO service_role/
    );
  });

  it('keeps manual allocation proportional while restricting auto-pay', () => {
    expect(effectiveAllocatorMigration).toBeDefined();
    expect(effectiveAllocatorMigration!.sql).toMatch(
      /IF NEW\.source = 'auto' THEN[\s\S]*period\.period_end = NEW\.period_end/
    );
    expect(
      effectiveAllocatorMigration!.sql.match(
        /NEW\.source <> 'auto' OR line\.id = v_auto_line_id/g
      )
    ).toHaveLength(2);
    expect(effectiveAllocatorMigration!.sql).toMatch(
      /v_payment_cents \* balance_cents \/ v_invoice_cents/
    );
  });

  it('keeps the effective allocator refund-aware for its eligible lines', () => {
    expect(effectiveAllocatorMigration).toBeDefined();
    expect(effectiveAllocatorMigration!.sql).toMatch(
      /FROM public\.invoice_line_balances[\s\S]*collectible_balance > 0/
    );
    expect(effectiveAllocatorMigration!.sql).toMatch(
      /SELECT SUM\(balance_cents\)\s+INTO v_invoice_cents\s+FROM line_balance/
    );
  });
});
