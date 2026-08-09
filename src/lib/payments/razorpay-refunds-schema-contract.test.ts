import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

const migration = read(
  'supabase/migrations/20260809165718_razorpay_full_refunds.sql'
);
const recoveryMigration = read(
  'supabase/migrations/20260809171510_complete_razorpay_refund_recovery_contract.sql'
);
const orchestration = read('src/lib/payments/razorpay-refunds.ts');
const processor = read('src/lib/payments/razorpay-webhook-processor.ts');

describe('Razorpay full-refund safety contract', () => {
  it('keeps provider refund state separate from immutable accounting disposition', () => {
    expect(migration).toContain(
      "status TEXT NOT NULL CHECK (status IN ('creating', 'pending', 'processed', 'failed', 'orphaned'))"
    );
    expect(migration).toContain(
      "disposition TEXT CHECK (disposition IN ('reopen_balance', 'reduce_charge'))"
    );
    expect(migration).toMatch(
      /OLD\.disposition IS NOT NULL AND NEW\.disposition IS DISTINCT FROM OLD\.disposition/
    );
    expect(migration).toContain('Invalid refund state transition');
    expect(migration).toContain(
      'source_refund_id UUID NOT NULL UNIQUE REFERENCES public.payment_refunds'
    );
  });

  it('copies supported full refunds and contains partial external refunds without allocations', () => {
    expect(migration).toMatch(
      /INSERT INTO public\.payment_refund_allocations[\s\S]*FROM public\.payment_allocations original/
    );
    expect(migration).toContain('partial_refund_line_target_required');
    expect(migration).toMatch(
      /v_unallocated:=public\.has_unallocated_processed_refund[\s\S]*p_amount<>v_remaining/
    );
    expect(migration).toContain('Refund line targeting is incomplete');
    expect(migration).toContain('Adjustment allocation must exactly copy');
  });

  it('makes review-held invoices non-collectible across established views', () => {
    expect(migration).toContain('requires_refund_review');
    expect(migration).toContain('collectible_balance');
    expect(migration).toMatch(
      /requires_refund_review,FALSE\) THEN 0 ELSE[\s\S]*collectible_balance/
    );
    expect(migration).toMatch(
      /IF v_review THEN RAISE EXCEPTION 'Invoice is under refund review'/
    );
    expect(migration).toMatch(
      /v_review OR v_balance<0\.5 THEN 'paid' ELSE 'due'/
    );
  });

  it('uses stable canonical bytes, provider idempotency, and durable recovery cursors', () => {
    expect(migration).toMatch(
      /VALUES\(v_refund_id[\s\S]*p_idempotency_key,v_refund_id::TEXT/
    );
    expect(orchestration).toContain("createHash('sha256').update(body)");
    expect(orchestration).toContain(
      'canonicalBody: stored.canonical_request_body!'
    );
    expect(orchestration).toContain('idempotencyKey: stored.id');
    expect(recoveryMigration).toContain(
      "status IN ('creating','pending','orphaned')"
    );
    expect(migration).toContain('refund_window_from');
    expect(migration).toContain('refund_completed_through');
    expect(migration).toContain("MIN(paid_at)-interval '48 hours'");
  });

  it('keeps all mutation RPCs service-only and routes signed events through verification', () => {
    for (const rpc of [
      'reserve_gateway_refund',
      'store_gateway_refund_request',
      'finalize_gateway_refund',
      'import_gateway_refund',
      'classify_gateway_refund',
      'claim_gateway_refund_recovery_batch',
      'claim_razorpay_refund_reconciliation',
      'advance_razorpay_refund_reconciliation',
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION[\\s\\S]*public\\.${rpc}\\([\\s\\S]*?FROM PUBLIC,anon,authenticated;`
        )
      );
    }
    expect(processor).toContain("case 'refund.processed':");
    expect(processor).toContain("case 'refund.failed':");
    expect(processor).toContain('finalizeOrImportVerifiedRefund');
  });
});
