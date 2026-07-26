import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

const migration = read(
  'supabase/migrations/20260726090000_razorpay_payment_safety.sql'
);
const credentials = read('src/lib/payments/credentials.ts');
const razorpay = read('src/lib/payments/razorpay.ts');
const settings = read('src/components/settings/deals-settings.tsx');
const onboarding = read('src/hooks/use-onboarding-status.tsx');

describe('Razorpay payment-safety contract', () => {
  it('keeps stored credentials behind a server-only account boundary', () => {
    expect(credentials).toMatch(/^import ['"]server-only['"];/m);
    expect(razorpay).toMatch(/^import ['"]server-only['"];/m);
    expect(credentials).toMatch(
      /accountId,\s*gateway: ['"]razorpay['"],\s*authentication:/
    );
    expect(razorpay).toMatch(
      /type RazorpayAuthentication =[\s\S]*RazorpayApiKeyAuthentication[\s\S]*RazorpayOAuthAuthentication/
    );
    expect(migration).toMatch(
      /REVOKE ALL ON public\.account_payment_credentials FROM anon, authenticated;/
    );
    expect(settings).not.toMatch(/account_payment_credentials/);
    expect(onboarding).not.toMatch(/account_payment_credentials/);
    expect(settings).not.toMatch(/razorpay_key_secret|razorpay_webhook_secret/);
    expect(onboarding).not.toMatch(
      /razorpay_key_secret|razorpay_webhook_secret/
    );
  });

  it('allows only failed, pending, or stale Razorpay attempts to re-claim', () => {
    expect(migration).toMatch(
      /processed_at IS NULL[\s\S]*processing_status IN \('pending', 'failed'\)[\s\S]*processing_started_at/
    );
    expect(migration).toMatch(
      /attempt_count = public\.webhook_events\.attempt_count \+ 1/
    );
    expect(migration).toMatch(
      /complete_razorpay_webhook_event[\s\S]*processing_status = 'processed'[\s\S]*processed_at = clock_timestamp\(\)/
    );
    expect(migration).toMatch(
      /fail_razorpay_webhook_event[\s\S]*processing_status = 'failed'[\s\S]*last_error = LEFT\(p_error, 4000\)/
    );
  });

  it('detects charged events whose gateway payment is absent from the ledger', () => {
    expect(migration).toMatch(
      /VIEW public\.razorpay_missing_payment_ledger[\s\S]*LEFT JOIN public\.payments p[\s\S]*p\.gateway_payment_id =[\s\S]*payload #>> '\{payload,payment,entity,id\}'/
    );
    expect(migration).toMatch(
      /we\.type = 'subscription\.charged'[\s\S]*p\.id IS NULL/
    );
    expect(migration).toMatch(
      /REVOKE ALL ON public\.razorpay_missing_payment_ledger FROM PUBLIC, anon, authenticated/
    );
  });
});
