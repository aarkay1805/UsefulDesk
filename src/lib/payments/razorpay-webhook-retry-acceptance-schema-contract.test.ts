import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.join(
    process.cwd(),
    'supabase/migrations/20260809130000_razorpay_provider_retry_acceptance.sql'
  ),
  'utf8'
);

describe('Razorpay provider retry acceptance schema contract', () => {
  it('is structurally Test-only, service-only, one-shot, and time-bounded', () => {
    expect(migration).toContain("CHECK (provider_mode = 'test')");
    expect(migration).toContain(
      "CHECK (expected_event_type = 'subscription.cancelled')"
    );
    expect(migration).toContain("INTERVAL '15 minutes'");
    expect(migration).toContain(
      'ALTER TABLE public.razorpay_webhook_retry_acceptances ENABLE ROW LEVEL SECURITY'
    );
    expect(migration).toMatch(
      /REVOKE ALL ON public\.razorpay_webhook_retry_acceptances\s+FROM PUBLIC, anon, authenticated/
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX[^;]+one_open_idx[\s\S]+WHERE status IN/
    );
  });

  it('fails the first exact delivery before canonical state and accepts only an identical retry', () => {
    expect(migration).toContain('first_response_status = 503');
    expect(migration).toContain("'action', 'retry'");
    expect(migration).toContain(
      'v_acceptance.provider_event_id IS DISTINCT FROM p_provider_event_id'
    );
    expect(migration).toContain(
      'v_acceptance.first_payload_sha256 IS DISTINCT FROM p_payload_sha256'
    );
    expect(migration).toContain("'action', 'redelivery'");
    expect(migration).toContain('retry_response_status = 200');
  });

  it('records canonical completion from either request processing or recovery', () => {
    expect(migration).toContain(
      'CREATE TRIGGER complete_razorpay_retry_acceptance'
    );
    expect(migration).toContain('canonical_attempt_count = NEW.attempt_count');
    expect(migration).toContain('canonical_processed_at = NEW.processed_at');
  });

  it('keeps every operator and ingress RPC service-role-only', () => {
    for (const name of [
      'arm_razorpay_webhook_retry_acceptance',
      'consume_razorpay_webhook_retry_acceptance',
      'acknowledge_razorpay_webhook_retry_acceptance',
      'cancel_razorpay_webhook_retry_acceptance',
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${name}\\([\\s\\S]+FROM PUBLIC, anon, authenticated`
        )
      );
      expect(migration).toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION public\\.${name}\\([\\s\\S]+TO service_role`
        )
      );
    }
  });
});
