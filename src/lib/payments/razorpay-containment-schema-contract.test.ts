import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrations = readdirSync(resolve(process.cwd(), 'supabase/migrations'))
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({
    name,
    sql: readFileSync(
      resolve(process.cwd(), 'supabase/migrations', name),
      'utf8'
    ),
  }));

const containment = migrations.find(({ sql }) =>
  sql.includes('record_razorpay_mandate_provider_status')
);

describe('Razorpay containment schema contract', () => {
  it('separates transient provider status from the local mandate lifecycle', () => {
    expect(containment).toBeDefined();
    expect(containment!.sql).toMatch(
      /ADD COLUMN IF NOT EXISTS provider_subscription_status TEXT/
    );
    expect(containment!.sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.record_razorpay_mandate_provider_status/
    );
    expect(containment!.sql).toMatch(
      /p_provider_status NOT IN \('pending', 'halted', 'authenticated', 'active', 'cancelled', 'completed', 'expired'\)/
    );
  });

  it('keeps terminal mandate lifecycle states monotonic', () => {
    expect(containment).toBeDefined();
    expect(containment!.sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.revoke_mandate/
    );
    expect(containment!.sql).toMatch(
      /v_mandate\.status IN \('revoked', 'expired', 'failed'\)/
    );
  });

  it('atomically refuses disconnect while provider work remains live', () => {
    expect(containment).toBeDefined();
    expect(containment!.sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.begin_razorpay_oauth_disconnect/
    );
    expect(containment!.sql).toMatch(
      /payment_mandates[\s\S]*razorpay_payment_links[\s\S]*payment_refunds/
    );
    expect(containment!.sql).toMatch(/connection_status = 'disconnecting'/);
    expect(containment!.sql).toMatch(
      /gateway_refund_exceptions[\s\S]*resolved_at IS NULL/
    );
  });

  it('invalidates revoked OAuth grants without erasing merchant identity', () => {
    expect(containment).toBeDefined();
    expect(containment!.sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.mark_razorpay_oauth_authorization_revoked/
    );
    expect(containment!.sql).toMatch(
      /connection_status = 'reconnect_required'/
    );
    expect(containment!.sql).toMatch(/oauth_access_token = NULL/);
    expect(containment!.sql).not.toMatch(/razorpay_account_id = NULL/);
  });

  it('includes stale readiness metadata in the leased OAuth scan', () => {
    expect(containment).toBeDefined();
    expect(containment!.sql).toMatch(
      /RETURNS TABLE\([\s\S]*activation_verified_at TIMESTAMPTZ[\s\S]*merchant_status TEXT/
    );
  });
});
