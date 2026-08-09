import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.join(
    process.cwd(),
    'supabase/migrations/20260809120000_razorpay_application_webhook_cutover.sql'
  ),
  'utf8'
);

describe('Razorpay application webhook cutover schema contract', () => {
  it('keeps the cutover audit and RPC service-only', () => {
    expect(migration).toContain(
      'ALTER TABLE public.razorpay_webhook_cutovers ENABLE ROW LEVEL SECURITY'
    );
    expect(migration).toMatch(
      /REVOKE ALL ON public\.razorpay_webhook_cutovers\s+FROM PUBLIC, anon, authenticated/
    );
    expect(migration).toContain(
      'GRANT SELECT, INSERT ON public.razorpay_webhook_cutovers TO service_role'
    );
    expect(migration).toMatch(
      /cutover_razorpay_application_webhook[\s\S]+SECURITY INVOKER/
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.cutover_razorpay_application_webhook\([\s\S]+FROM PUBLIC, anon, authenticated/
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.cutover_razorpay_application_webhook\([\s\S]+TO service_role/
    );
  });

  it('requires recent exact dual-ingress parity and complete financial evidence', () => {
    expect(migration).toContain("p_provider_mode IS DISTINCT FROM 'test'");
    expect(migration).toContain('cardinality(p_parity_event_ids) <> 3');
    expect(migration).toContain('legacy_count = 1');
    expect(migration).toContain('application_count = 1');
    expect(migration).toContain('payload_count = 1');
    expect(migration).toContain('skew_seconds <= 5');
    expect(migration).toContain("INTERVAL '48 hours'");
    expect(migration).toContain("'subscription.authenticated'");
    expect(migration).toContain("'subscription.activated'");
    expect(migration).toContain("'subscription.charged'");
    expect(migration).toContain('v_processed_events <> 3');
    expect(migration).toContain('v_charged_ledger_events <> 1');
    expect(migration).toContain('v_unresolved_events <> 0');
  });

  it('locks eligibility and updates the selector before writing one audit row', () => {
    expect(migration).toMatch(
      /FROM public\.account_payment_credentials[\s\S]+FOR UPDATE/
    );
    expect(migration).toContain(
      "v_credentials.canonical_webhook_ingress <> 'legacy_account'"
    );
    expect(migration).toMatch(
      /UPDATE public\.account_payment_credentials[\s\S]+SET canonical_webhook_ingress = 'application'[\s\S]+INSERT INTO public\.razorpay_webhook_cutovers/
    );
  });
});
