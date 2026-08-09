import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.join(
    process.cwd(),
    'supabase/migrations/20260809100000_razorpay_webhook_delivery_observations.sql'
  ),
  'utf8'
);

describe('Razorpay webhook delivery schema contract', () => {
  it('keeps the observation ledger service-only', () => {
    expect(migration).toContain(
      'ALTER TABLE public.razorpay_webhook_deliveries ENABLE ROW LEVEL SECURITY'
    );
    expect(migration).toMatch(
      /REVOKE ALL ON public\.razorpay_webhook_deliveries\s+FROM PUBLIC, anon, authenticated/
    );
    expect(migration).toContain(
      'GRANT SELECT, INSERT ON public.razorpay_webhook_deliveries TO service_role'
    );
    expect(migration).not.toMatch(
      /CREATE POLICY[^;]+razorpay_webhook_deliveries/i
    );
  });

  it('deduplicates each provider event independently by ingress', () => {
    expect(migration).toMatch(
      /UNIQUE \(provider_mode, provider_event_id, ingress\)/
    );
    expect(migration).toContain(
      "CHECK (ingress IN ('legacy_account', 'application'))"
    );
  });

  it('makes a shadow canonical-mutation marker structurally impossible', () => {
    expect(migration).toContain(
      'CHECK (NOT shadow_only OR NOT canonical_mutation_attempted)'
    );
  });
});
