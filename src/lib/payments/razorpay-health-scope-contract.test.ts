import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.join(
    process.cwd(),
    'supabase/migrations/20260810162750_scope_razorpay_health_to_provider_identity.sql'
  ),
  'utf8'
);
const connectionRoute = fs.readFileSync(
  path.join(process.cwd(), 'src/app/api/payments/razorpay/connection/route.ts'),
  'utf8'
);

describe('Razorpay provider-scoped health diagnostics', () => {
  it('keeps the missing-ledger view read-only and exposes provider identity', () => {
    expect(migration).toContain('WITH (security_invoker = true)');
    expect(migration).toMatch(/we\.provider_mode,\s+we\.external_account_id/);
    expect(migration).toMatch(
      /REVOKE ALL ON public\.razorpay_missing_payment_ledger\s+FROM PUBLIC, anon, authenticated/
    );
    expect(migration).toContain(
      'GRANT SELECT ON public.razorpay_missing_payment_ledger TO service_role'
    );
  });

  it('filters failed and missing-ledger events by mode and merchant', () => {
    const failedEvents = connectionRoute.slice(
      connectionRoute.indexOf(".from('webhook_events')"),
      connectionRoute.indexOf(".from('razorpay_missing_payment_ledger')")
    );
    const missingLedger = connectionRoute.slice(
      connectionRoute.indexOf(".from('razorpay_missing_payment_ledger')"),
      connectionRoute.indexOf(".from('gateway_charge_exceptions')")
    );

    for (const query of [failedEvents, missingLedger]) {
      expect(query).toContain(".eq('provider_mode', diagnosticMode)");
      expect(query).toContain(".eq('external_account_id', diagnosticMerchant)");
    }
  });
});
