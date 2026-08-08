import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260809000000_razorpay_oauth_connections.sql'
  ),
  'utf8'
);
const indexMigration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260809001000_index_razorpay_oauth_state_foreign_keys.sql'
  ),
  'utf8'
);

describe('Razorpay OAuth schema security contract', () => {
  it('keeps OAuth state and credentials service-only with RLS enabled', () => {
    for (const table of [
      'razorpay_oauth_states',
      'account_payment_credentials',
    ]) {
      expect(migration).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`
      );
      expect(migration).toMatch(
        new RegExp(
          `REVOKE ALL ON TABLE public\\.${table}\\s+FROM PUBLIC, anon, authenticated;`
        )
      );
    }
    expect(migration).not.toMatch(
      /GRANT (?:SELECT|INSERT|UPDATE|DELETE).* TO authenticated/
    );
  });

  it('binds state to tenant, actor, client, mode, redirect, expiry, and PKCE', () => {
    for (const column of [
      'state_hash',
      'account_id',
      'initiated_by',
      'client_id_fingerprint',
      'mode',
      'redirect_uri',
      'pkce_code_verifier',
      'expires_at',
      'consumed_at',
    ]) {
      expect(migration).toContain(column);
    }
    expect(indexMigration).toContain('razorpay_oauth_states_account_id_idx');
    expect(indexMigration).toContain('razorpay_oauth_states_initiated_by_idx');
  });

  it('enforces mode-scoped merchant uniqueness and canonical ingress', () => {
    expect(migration).toMatch(
      /ON public\.account_payment_credentials \(provider_mode, razorpay_account_id\)/
    );
    expect(migration).toContain(
      "canonical_webhook_ingress IN ('legacy_account', 'application')"
    );
  });

  it('makes refresh claim/commit/reconnect RPCs service-role only', () => {
    for (const rpc of [
      'claim_razorpay_oauth_refresh',
      'commit_razorpay_oauth_refresh',
      'mark_razorpay_oauth_reconnect_required',
    ]) {
      expect(migration).toContain(`CREATE OR REPLACE FUNCTION public.${rpc}`);
      expect(migration).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${rpc}\\([\\s\\S]*?FROM PUBLIC, anon, authenticated;`
        )
      );
      expect(migration).toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION public\\.${rpc}\\([\\s\\S]*?TO service_role;`
        )
      );
    }
  });
});
