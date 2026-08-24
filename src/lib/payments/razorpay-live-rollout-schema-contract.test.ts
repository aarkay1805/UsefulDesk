import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260824154126_razorpay_live_rollout_accounts.sql',
  'utf8'
);

describe('Razorpay Live rollout schema contract', () => {
  it('keeps rollout authority off every browser role', () => {
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS public.razorpay_live_rollout_accounts'
    );
    expect(migration).toContain(
      'ALTER TABLE public.razorpay_live_rollout_accounts ENABLE ROW LEVEL SECURITY'
    );
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\.razorpay_live_rollout_accounts\s+FROM PUBLIC, anon, authenticated;/
    );
    expect(migration).toContain(
      'GRANT SELECT, UPDATE ON TABLE public.razorpay_live_rollout_accounts TO service_role;'
    );
  });

  it('seeds Rajat as bound and VBF as the sole first-bind account', () => {
    expect(migration).toContain(
      "'50a9e8f9-d7e5-44d2-ba04-c367509b981e'::UUID, TRUE, FALSE, 'acc_TCJwBqanN9LTrK'"
    );
    expect(migration).toContain(
      "'9c50dcd9-ed4a-427c-a2fc-07d452f0aec7'::UUID, TRUE, TRUE, NULL"
    );
    expect(migration).toContain('merchant_id TEXT UNIQUE');
  });

  it('claims the first provider merchant once and only through service role', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.claim_razorpay_live_rollout_merchant('
    );
    expect(migration).toMatch(
      /merchant_id IS NULL[\s\S]*first_bind_enabled = TRUE[\s\S]*enabled = TRUE/
    );
    expect(migration).toContain('first_bind_enabled = FALSE');
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.claim_razorpay_live_rollout_merchant\(UUID, TEXT\)\s+FROM PUBLIC, anon, authenticated;/
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.claim_razorpay_live_rollout_merchant(UUID, TEXT) TO service_role;'
    );
    expect(migration).toMatch(
      /NOT EXISTS \([\s\S]*public\.account_payment_credentials[\s\S]*provider_mode = 'live'[\s\S]*razorpay_account_id = p_merchant_id[\s\S]*account_id <> p_account_id[\s\S]*\)/
    );
  });
});
