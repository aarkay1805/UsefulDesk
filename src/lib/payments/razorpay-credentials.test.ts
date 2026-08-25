import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { encryptPaymentSecret } from './payment-secrets';
import {
  beginRazorpayOAuthConnection,
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

function baseRow(patch: Record<string, unknown> = {}) {
  return {
    account_id: 'account',
    gateway: 'razorpay',
    authentication_mode: 'oauth',
    razorpay_account_id: 'acc_test',
    provider_mode: 'test',
    secret_storage_version: 1,
    oauth_access_token: encryptPaymentSecret('access'),
    oauth_refresh_token: encryptPaymentSecret('refresh'),
    oauth_access_expires_at: new Date(
      Date.now() + 30 * 86_400_000
    ).toISOString(),
    oauth_refresh_expires_at: new Date(
      Date.now() + 180 * 86_400_000
    ).toISOString(),
    oauth_scope: 'read_write',
    connection_status: 'ready',
    merchant_status: 'unknown',
    canonical_webhook_ingress: 'application',
    connected_at: new Date().toISOString(),
    disconnected_at: null,
    activation_verified_at: new Date().toISOString(),
    last_verified_at: new Date().toISOString(),
    last_error: null,
    ...patch,
  };
}

afterEach(() => vi.unstubAllEnvs());

describe('Razorpay OAuth credential resolver', () => {
  it('does not let co-branded enrollment replace a bound merchant', async () => {
    vi.stubEnv('RAZORPAY_MODE', 'live');
    await expect(
      beginRazorpayOAuthConnection(
        credentialDb(
          baseRow({
            provider_mode: 'live',
            razorpay_account_id: 'acc_already_bound',
          })
        ),
        'account',
        {
          accessToken: 'access',
          refreshToken: 'refresh',
          accessExpiresAt: new Date(Date.now() + 86_400_000),
          refreshExpiresAt: new Date(Date.now() + 30 * 86_400_000),
          accountId: 'acc_new',
          scope: 'read_write',
          mode: 'live',
        },
        { requireUnboundMerchant: true }
      )
    ).rejects.toThrow(/only before the first merchant binding/);
  });

  it('returns OAuth Bearer authentication for a ready application connection', async () => {
    vi.stubEnv('RAZORPAY_MODE', 'test');
    vi.stubEnv('RAZORPAY_OAUTH_ENABLED', 'true');

    await expect(
      getRazorpayConnection(credentialDb(baseRow()), 'account')
    ).resolves.toMatchObject({
      accountId: 'account',
      authenticationMode: 'oauth',
      authentication: { mode: 'oauth', accessToken: 'access' },
    });
  });

  it('fails closed on stored/deployment mode mismatch', async () => {
    vi.stubEnv('RAZORPAY_MODE', 'live');
    vi.stubEnv('RAZORPAY_OAUTH_ENABLED', 'true');
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

  it('rejects a blocked OAuth connection without another auth path', async () => {
    vi.stubEnv('RAZORPAY_MODE', 'test');
    vi.stubEnv('RAZORPAY_OAUTH_ENABLED', 'true');
    await expect(
      getRazorpayConnection(
        credentialDb(baseRow({ connection_status: 'reconnect_required' })),
        'account'
      )
    ).rejects.toThrow(/blocked or needs reconnecting/);
  });

  it('exposes a blocked OAuth grant only to the explicit readiness recovery path', async () => {
    vi.stubEnv('RAZORPAY_MODE', 'test');
    vi.stubEnv('RAZORPAY_OAUTH_ENABLED', 'true');
    const blocked = credentialDb(
      baseRow({
        connection_status: 'blocked',
        activation_verified_at: null,
        last_error: 'Razorpay merchant activation is not yet verified',
      })
    );

    await expect(getRazorpayConnection(blocked, 'account')).rejects.toThrow(
      /blocked or needs reconnecting/
    );
    await expect(
      getRazorpayConnection(blocked, 'account', {
        allowStaleReadinessForRecovery: true,
      })
    ).resolves.toMatchObject({
      accountId: 'account',
      authenticationMode: 'oauth',
      authentication: { mode: 'oauth', accessToken: 'access' },
    });
  });

  it('keeps stale readiness blocked outside the explicit recovery path', async () => {
    vi.stubEnv('RAZORPAY_MODE', 'test');
    vi.stubEnv('RAZORPAY_OAUTH_ENABLED', 'true');
    const stale = credentialDb(
      baseRow({
        activation_verified_at: new Date(
          Date.now() - 2 * 86_400_000
        ).toISOString(),
      })
    );

    await expect(getRazorpayConnection(stale, 'account')).rejects.toThrow(
      /blocked or needs reconnecting/
    );
    await expect(
      getRazorpayConnection(stale, 'account', {
        allowStaleReadinessForRecovery: true,
      })
    ).resolves.toMatchObject({
      accountId: 'account',
      authenticationMode: 'oauth',
      authentication: { mode: 'oauth', accessToken: 'access' },
    });
  });

  it('rejects a ready OAuth row without its bound read_write scope', async () => {
    vi.stubEnv('RAZORPAY_MODE', 'test');
    vi.stubEnv('RAZORPAY_OAUTH_ENABLED', 'true');
    await expect(
      getRazorpayConnection(
        credentialDb(baseRow({ oauth_scope: null })),
        'account'
      )
    ).rejects.toThrow(/incomplete/);
  });
});
