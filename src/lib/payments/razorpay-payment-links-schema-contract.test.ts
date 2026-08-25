import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

const migration = read(
  'supabase/migrations/20260809140612_razorpay_payment_links.sql'
);
const settlementInvalidationMigration = read(
  'supabase/migrations/20260809150500_payment_link_settlement_invalidation.sql'
);
const processor = read('src/lib/payments/razorpay-webhook-processor.ts');
const orchestration = read('src/lib/payments/razorpay-payment-links.ts');
const actions = read('src/components/finance/payment-link-actions.tsx');
const constants = read('src/lib/payments/payment-link-constants.ts');

describe('Razorpay Payment Link safety contract', () => {
  it('reserves one exact INR full-balance intent for seven days', () => {
    expect(migration).toMatch(
      /currency TEXT NOT NULL CHECK \(currency = 'INR'\)/
    );
    expect(migration).toMatch(
      /idx_razorpay_payment_links_blocking_invoice[\s\S]*status IN \('creating', 'created', 'cancel_requested', 'orphaned'\)/
    );
    expect(migration).toContain("now() + interval '7 days'");
    expect(migration).toContain("expires_at >= now() + interval '24 hours'");
    expect(orchestration).toMatch(
      /accept_partial === false[\s\S]*remote\.expire_by === exactExpiry\(local\)/
    );
    expect(orchestration).toMatch(
      /referenceId: local\.reference_id[\s\S]*notes: notesFor\(local\)/
    );
  });

  it('keeps Payment Links separate from manual and AutoPay provenance', () => {
    expect(migration).toMatch(
      /CHECK \(source IN \('manual', 'auto', 'payment_link'\)\)/
    );
    expect(migration).toContain("ELSIF NEW.source = 'auto' THEN");
    expect(migration).toContain("ELSIF NEW.source = 'manual' THEN");
    expect(migration).toContain(
      'Manual payments cannot carry gateway provenance'
    );
    expect(migration).toMatch(
      /'payment_link', NULL, p_gateway_payment_id[\s\S]*?PERFORM set_config\('app\.payment_purpose', '', TRUE\)/
    );
    expect(migration).toMatch(
      /gateway_payment_id IS NOT NULL OR v_payment\.source IN \('auto', 'payment_link'\)/
    );
  });

  it('settles only verified payment_link events and contains unsafe money', () => {
    expect(processor).toContain("case 'payment_link.paid':");
    expect(processor).toContain("case 'payment_link.partially_paid':");
    expect(processor).not.toMatch(
      /case 'payment\.captured':[\s\S]*settleVerifiedPaymentLink/
    );
    for (const reason of [
      'provider_contract_mismatch',
      'unexpected_partial_payment',
      'payment_not_captured',
      'link_identity_mismatch',
      'amount_currency_mismatch',
      'invoice_balance_changed',
      'ledger_rejected',
    ]) {
      expect(migration).toContain(reason);
    }
    expect(migration).toMatch(/UNIQUE \(account_id, gateway_payment_id\)/);
    expect(migration).toMatch(
      /RETURN jsonb_build_object\('outcome', 'duplicate'/
    );
    expect(settlementInvalidationMigration).toMatch(
      /v_payment_source = 'payment_link'[\s\S]*RETURN NEW/
    );
    expect(settlementInvalidationMigration).toContain(
      "TG_TABLE_NAME = 'payment_allocations'"
    );
  });

  it('keeps provider and financial writes behind service-only RPCs', () => {
    expect(migration).toContain(
      'ALTER TABLE public.razorpay_payment_links ENABLE ROW LEVEL SECURITY'
    );
    expect(migration).toMatch(
      /GRANT SELECT ON public\.razorpay_payment_links TO authenticated/
    );
    expect(migration).toMatch(
      /REVOKE ALL ON public\.razorpay_payment_links FROM PUBLIC, anon, authenticated/
    );
    for (const name of [
      'reserve_invoice_payment_link',
      'finalize_invoice_payment_link',
      'park_invoice_payment_link',
      'request_invoice_link_cancellation',
      'record_gateway_invoice_payment',
      'mark_invoice_payment_link_terminal',
      'claim_razorpay_payment_link_recovery_batch',
      'finish_razorpay_payment_link_verification',
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

  it('disables WhatsApp Send independently from creation and Copy', () => {
    expect(actions).toMatch(
      /const sendReady = providerReady && templateReady && hasPhone/
    );
    expect(actions).toContain('Copy link');
    expect(actions).toMatch(
      /const providerBlocker = providerReady\s+\? null\s+: paymentProviderBlocker\(providerReason\)/
    );
    expect(actions).toMatch(
      /const copyBlocker = !canManage\s+\? PAYMENT_LINK_PERMISSION_BLOCKER\s+: providerBlocker/
    );
    expect(actions).toContain('blocker={copyBlocker}');
    expect(constants).toContain('TEMPLATE_CONTRACTS.payment_link.payload.name');
  });
});
