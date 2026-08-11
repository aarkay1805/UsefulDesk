import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260811172006_reconcile_razorpay_failed_disconnect.sql'
  ),
  'utf8'
);
const recoveryRoute = readFileSync(
  join(process.cwd(), 'src/app/api/payments/razorpay/oauth/recover/route.ts'),
  'utf8'
);
const settingsCard = readFileSync(
  join(process.cwd(), 'src/components/settings/razorpay-settings-card.tsx'),
  'utf8'
);

describe('Razorpay failed-disconnect recovery schema', () => {
  it('allows claims only for the exact blocked OAuth merchant', () => {
    expect(migration).toContain("connection_status = 'disconnecting'");
    expect(migration).toContain('razorpay_account_id = p_external_account_id');
    expect(migration).toContain("authentication_mode = 'oauth'");
    expect(migration).toContain('razorpay_key_secret IS NULL');
  });

  it('commits ready only with fresh provider readiness and rotated tokens', () => {
    expect(migration).toContain("p_connection_status IN ('ready', 'blocked')");
    expect(migration).toContain(
      "p_activation_verified_at >= clock_timestamp() - INTERVAL '5 minutes'"
    );
    expect(migration).toContain('p_refresh_expires_at > p_access_expires_at');
    expect(migration).toContain('refresh_lease_owner = p_lease_owner');
  });

  it('keeps every recovery RPC service-role-only and invoker-scoped', () => {
    expect(migration.match(/SECURITY INVOKER/g)).toHaveLength(3);
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.claim_razorpay_oauth_disconnect_recovery'
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.commit_razorpay_oauth_disconnect_recovery'
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.fail_razorpay_oauth_disconnect_recovery'
    );
    expect(migration.match(/TO service_role;/g)).toHaveLength(3);
  });

  it('exposes recovery only through the existing payment-gateway capability', () => {
    expect(recoveryRoute).toContain('requirePaymentGatewayAccess()');
    expect(recoveryRoute).toContain('requireSameOriginRequest(request)');
    expect(settingsCard).toContain(
      "connection.connectionStatus === 'disconnecting'"
    );
    expect(settingsCard).toContain(
      "fetch('/api/payments/razorpay/oauth/recover'"
    );
    expect(settingsCard).toContain('Recheck connection');
  });
});
