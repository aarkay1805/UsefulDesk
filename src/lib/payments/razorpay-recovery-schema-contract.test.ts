import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260809110000_razorpay_webhook_recovery_and_token_scan.sql'
  ),
  'utf8'
);
const indexMigration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260809111000_index_webhook_events_account_id.sql'
  ),
  'utf8'
);

describe('Razorpay recovery schema contract', () => {
  it('keeps the first canonical payload immutable while leasing retries', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.claim_razorpay_canonical_webhook_event'
    );
    expect(migration).toMatch(
      /ON CONFLICT \(id\) DO UPDATE[\s\S]*public\.webhook_events\.payload IS NOT DISTINCT FROM p_payload/
    );
    expect(migration).not.toMatch(
      /SET[\s\S]{0,120}payload = EXCLUDED\.payload/
    );
    expect(migration).toContain('processing_owner = p_processing_owner');
  });

  it('claims at most 100 recovery rows with skip-locked leases and fixed backoff', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.claim_razorpay_webhook_recovery_batch'
    );
    expect(migration).toContain('LIMIT LEAST(GREATEST(p_limit, 1), 100)');
    expect(migration).toContain('FOR UPDATE OF event SKIP LOCKED');
    expect(migration).toContain('event.provider_mode = p_provider_mode');
    expect(migration).toContain(
      'credentials.razorpay_account_id = event.external_account_id'
    );
    expect(migration).not.toContain(
      'COALESCE(event.provider_mode, credentials.provider_mode) = p_provider_mode'
    );
    expect(migration).not.toContain(
      'SET provider_mode = COALESCE(event.provider_mode, p_provider_mode)'
    );
    for (const delay of [
      "INTERVAL '1 minute'",
      "INTERVAL '5 minutes'",
      "INTERVAL '15 minutes'",
      "INTERVAL '1 hour'",
      "INTERVAL '6 hours'",
    ]) {
      expect(migration).toContain(delay);
    }
  });

  it('retains covering index support for the webhook account foreign key', () => {
    expect(indexMigration).toContain(
      'CREATE INDEX IF NOT EXISTS webhook_events_account_id_idx'
    );
    expect(indexMigration).toContain('ON public.webhook_events (account_id)');
  });

  it('leases each OAuth connection for a daily token-due scan', () => {
    expect(migration).toContain('oauth_refresh_scan_due_at');
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.claim_razorpay_oauth_refresh_scan_batch'
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.finish_razorpay_oauth_refresh_scan'
    );
    expect(migration).toContain("INTERVAL '1 day'");
  });

  it('exposes every recovery RPC only to the service role', () => {
    for (const name of [
      'claim_razorpay_canonical_webhook_event',
      'complete_razorpay_canonical_webhook_event',
      'fail_razorpay_canonical_webhook_event',
      'claim_razorpay_webhook_recovery_batch',
      'claim_razorpay_oauth_refresh_scan_batch',
      'finish_razorpay_oauth_refresh_scan',
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
});
