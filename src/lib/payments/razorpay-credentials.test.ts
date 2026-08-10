import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { encryptPaymentSecret } from './payment-secrets';
import {
  assertRazorpayOAuthStorageReady,
  getRazorpayConnection,
  getRazorpayDiagnosticScope,
} from './credentials';

function credentialDb(row: Record<string, unknown>): SupabaseClient {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return { from: () => query } as unknown as SupabaseClient;
}

function mutableCredentialDb(initial: Record<string, unknown>) {
  let row = { ...initial };
  const client = {
    from() {
      let patch: Record<string, unknown> | null = null;
      let expectedVersion: number | null = null;
      const query = {
        select() {
          if (!patch) return query;
          if (
            expectedVersion !== null &&
            row.secret_storage_version !== expectedVersion
          ) {
            return { data: [], error: null };
          }
          row = { ...row, ...patch };
          return { data: [{ account_id: row.account_id }], error: null };
        },
        update(next: Record<string, unknown>) {
          patch = next;
          return query;
        },
        eq(column: string, value: unknown) {
          if (column === 'secret_storage_version') {
            expectedVersion = Number(value);
          }
          return query;
        },
        async maybeSingle() {
          return { data: row, error: null };
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, read: () => row };
}

function baseRow(patch: Record<string, unknown> = {}) {
  return {
    account_id: 'account',
    gateway: 'razorpay',
    authentication_mode: 'manual',
    razorpay_account_id: null,
    provider_mode: 'test',
    secret_storage_version: 1,
    razorpay_key_id: 'rzp_test_key',
    razorpay_key_secret: encryptPaymentSecret('manual-secret'),
    razorpay_webhook_secret: encryptPaymentSecret('webhook-secret'),
    oauth_access_token: null,
    oauth_refresh_token: null,
    oauth_access_expires_at: null,
    oauth_refresh_expires_at: null,
    oauth_scope: null,
    connection_status: 'ready',
    merchant_status: 'unknown',
    canonical_webhook_ingress: 'legacy_account',
    connected_at: null,
    disconnected_at: null,
    activation_verified_at: null,
    last_verified_at: null,
    last_error: null,
    ...patch,
  };
}

afterEach(() => vi.unstubAllEnvs());

describe('Razorpay credential resolver', () => {
  it('blocks OAuth before an unresolved version-0 manual row can be relabelled', async () => {
    await expect(
      assertRazorpayOAuthStorageReady(
        credentialDb(
          baseRow({
            provider_mode: null,
            secret_storage_version: 0,
            razorpay_key_secret: 'legacy-api-secret',
            razorpay_webhook_secret: 'legacy-webhook-secret',
          })
        ),
        'account'
      )
    ).rejects.toThrow(/operator review/);
  });

  it('allows OAuth when a version-0 placeholder contains no manual material', async () => {
    await expect(
      assertRazorpayOAuthStorageReady(
        credentialDb(
          baseRow({
            provider_mode: null,
            secret_storage_version: 0,
            razorpay_key_id: null,
            razorpay_key_secret: null,
            razorpay_webhook_secret: null,
          })
        ),
        'account'
      )
    ).resolves.toBeUndefined();
  });

  it('preserves encrypted manual credentials only behind the rollback flag', async () => {
    vi.stubEnv('RAZORPAY_MODE', 'test');
    vi.stubEnv('RAZORPAY_MANUAL_ROLLBACK_ENABLED', 'true');
    const connection = await getRazorpayConnection(
      credentialDb(baseRow()),
      'account'
    );
    expect(connection?.authentication).toEqual({
      mode: 'api_key',
      keyId: 'rzp_test_key',
      keySecret: 'manual-secret',
    });

    vi.stubEnv('RAZORPAY_MANUAL_ROLLBACK_ENABLED', 'false');
    await expect(
      getRazorpayConnection(credentialDb(baseRow()), 'account')
    ).resolves.toBeNull();
  });

  it('reads and conditionally upgrades legacy manual rollback secrets', async () => {
    vi.stubEnv('RAZORPAY_MODE', 'test');
    vi.stubEnv('RAZORPAY_MANUAL_ROLLBACK_ENABLED', 'true');
    const database = mutableCredentialDb(
      baseRow({
        secret_storage_version: 0,
        razorpay_key_secret: 'legacy-api-secret',
        razorpay_webhook_secret: 'legacy-webhook-secret',
      })
    );

    const connection = await getRazorpayConnection(database.client, 'account');

    expect(connection?.authentication).toMatchObject({
      mode: 'api_key',
      keySecret: 'legacy-api-secret',
    });
    expect(database.read().secret_storage_version).toBe(1);
    expect(database.read().razorpay_key_secret).not.toBe('legacy-api-secret');
    expect(database.read().razorpay_webhook_secret).not.toBe(
      'legacy-webhook-secret'
    );
  });

  it('fails closed on stored/deployment mode mismatch', async () => {
    vi.stubEnv('RAZORPAY_MODE', 'live');
    vi.stubEnv('RAZORPAY_MANUAL_ROLLBACK_ENABLED', 'true');
    await expect(
      getRazorpayConnection(credentialDb(baseRow()), 'account')
    ).rejects.toThrow(/does not match/);
  });

  it('returns an exact mode-and-merchant diagnostic scope', async () => {
    vi.stubEnv('RAZORPAY_MODE', 'live');
    await expect(
      getRazorpayDiagnosticScope(
        credentialDb(
          baseRow({
            provider_mode: 'live',
            razorpay_account_id: 'acc_live_pilot',
          })
        ),
        'account'
      )
    ).resolves.toEqual({
      providerMode: 'live',
      externalAccountId: 'acc_live_pilot',
    });
  });

  it('fails diagnostic access closed across provider modes', async () => {
    vi.stubEnv('RAZORPAY_MODE', 'live');
    await expect(
      getRazorpayDiagnosticScope(
        credentialDb(
          baseRow({
            provider_mode: 'test',
            razorpay_account_id: 'acc_test_isolated',
          })
        ),
        'account'
      )
    ).rejects.toThrow(/does not match/);
  });

  it('never falls back to manual secrets from blocked OAuth', async () => {
    vi.stubEnv('RAZORPAY_MODE', 'test');
    vi.stubEnv('RAZORPAY_OAUTH_ENABLED', 'true');
    vi.stubEnv('RAZORPAY_MANUAL_ROLLBACK_ENABLED', 'true');
    await expect(
      getRazorpayConnection(
        credentialDb(
          baseRow({
            authentication_mode: 'oauth',
            razorpay_account_id: 'acc_123',
            connection_status: 'reconnect_required',
            oauth_access_token: encryptPaymentSecret('access'),
            oauth_refresh_token: encryptPaymentSecret('refresh'),
            oauth_access_expires_at: new Date(
              Date.now() + 86_400_000
            ).toISOString(),
            oauth_refresh_expires_at: new Date(
              Date.now() + 30 * 86_400_000
            ).toISOString(),
          })
        ),
        'account'
      )
    ).rejects.toThrow(/blocked or needs reconnecting/);
  });

  it('rejects a ready OAuth row without its bound read_write scope', async () => {
    vi.stubEnv('RAZORPAY_MODE', 'test');
    vi.stubEnv('RAZORPAY_OAUTH_ENABLED', 'true');
    await expect(
      getRazorpayConnection(
        credentialDb(
          baseRow({
            authentication_mode: 'oauth',
            razorpay_account_id: 'acc_123',
            oauth_access_token: encryptPaymentSecret('access'),
            oauth_refresh_token: encryptPaymentSecret('refresh'),
            oauth_access_expires_at: new Date(
              Date.now() + 30 * 86_400_000
            ).toISOString(),
            oauth_refresh_expires_at: new Date(
              Date.now() + 180 * 86_400_000
            ).toISOString(),
            oauth_scope: null,
            activation_verified_at: new Date().toISOString(),
          })
        ),
        'account'
      )
    ).rejects.toThrow(/incomplete/);
  });
});
