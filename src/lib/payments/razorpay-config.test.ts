import { describe, expect, it } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  assertRazorpayApplicationWebhookConfigured,
  assertRazorpayProviderMode,
  authorizeRazorpayLiveRolloutMerchant,
  claimRazorpayLiveRolloutMerchant,
  getRazorpayOAuthConfig,
  getRazorpayProviderMode,
  isRazorpayOAuthEnabled,
  loadRazorpayLiveRolloutAuthorization,
  type RazorpayLiveRolloutAuthorization,
} from './razorpay-config';

const vbfRollout = {
  accountId: '9c50dcd9-ed4a-427c-a2fc-07d452f0aec7',
  enabled: true,
  firstBindEnabled: true,
  merchantId: null,
  credentialMerchantId: null,
} as RazorpayLiveRolloutAuthorization & { credentialMerchantId: null };

function rolloutAdmin(
  rolloutResult: {
    data: Record<string, unknown> | null;
    error: { message: string } | null;
  },
  credentialResult: {
    data: Record<string, unknown> | null;
    error: { message: string } | null;
  } = { data: null, error: null }
): SupabaseClient {
  return {
    from: (table: string) => {
      const result =
        table === 'razorpay_live_rollout_accounts'
          ? rolloutResult
          : credentialResult;
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => result,
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

describe('Razorpay rollout configuration', () => {
  it('keeps OAuth disabled unless explicitly true', () => {
    expect(isRazorpayOAuthEnabled({})).toBe(false);
    expect(isRazorpayOAuthEnabled({ RAZORPAY_OAUTH_ENABLED: 'false' })).toBe(
      false
    );
    expect(() => getRazorpayOAuthConfig({})).toThrow(/not enabled/);
  });

  it('allows revocation config to load after the OAuth kill-switch closes', () => {
    expect(
      getRazorpayOAuthConfig(
        {
          RAZORPAY_OAUTH_ENABLED: 'false',
          RAZORPAY_MODE: 'test',
          RAZORPAY_OAUTH_CLIENT_ID: 'client',
          RAZORPAY_OAUTH_CLIENT_SECRET: 'secret',
          RAZORPAY_OAUTH_REDIRECT_URI:
            'https://desk.example/api/payments/razorpay/oauth/callback',
        },
        { allowDisabled: true }
      ).mode
    ).toBe('test');
  });

  it('requires one authoritative deployment mode', () => {
    expect(getRazorpayProviderMode({ RAZORPAY_MODE: 'test' })).toBe('test');
    expect(() => getRazorpayProviderMode({})).toThrow(/RAZORPAY_MODE/);
    expect(() => getRazorpayProviderMode({ RAZORPAY_MODE: 'sandbox' })).toThrow(
      /RAZORPAY_MODE/
    );
  });

  it('fails closed when a stored mode differs from the deployment', () => {
    expect(() => assertRazorpayProviderMode('live', 'test')).toThrow(
      /does not match/
    );
    expect(() => assertRazorpayProviderMode(null, 'test')).toThrow(
      /does not match/
    );
  });

  it('accepts HTTPS redirects and localhost HTTP only', () => {
    const base = {
      RAZORPAY_OAUTH_ENABLED: 'true',
      RAZORPAY_MODE: 'test',
      RAZORPAY_OAUTH_CLIENT_ID: 'client',
      RAZORPAY_OAUTH_CLIENT_SECRET: 'secret',
    };
    expect(
      getRazorpayOAuthConfig({
        ...base,
        RAZORPAY_OAUTH_REDIRECT_URI:
          'http://localhost:3000/api/payments/razorpay/oauth/callback',
      }).mode
    ).toBe('test');
    expect(() =>
      getRazorpayOAuthConfig({
        ...base,
        RAZORPAY_OAUTH_REDIRECT_URI: 'http://example.com/callback',
      })
    ).toThrow(/HTTPS/);
  });

  it('requires a current application webhook secret before OAuth binding', () => {
    expect(() => assertRazorpayApplicationWebhookConfigured({})).toThrow(
      /not configured/
    );
    expect(() =>
      assertRazorpayApplicationWebhookConfigured({
        RAZORPAY_WEBHOOK_SECRET_CURRENT: '   ',
      })
    ).toThrow(/not configured/);
    expect(() =>
      assertRazorpayApplicationWebhookConfigured({
        RAZORPAY_WEBHOOK_SECRET_CURRENT: 'configured-secret',
      })
    ).not.toThrow();
  });

  it('allows only an explicit Live first-bind enrollment window', () => {
    const base = { RAZORPAY_MODE: 'live' };
    expect(
      authorizeRazorpayLiveRolloutMerchant('acc_newmerchant', vbfRollout, base)
    ).toBe('enrollment');
    expect(() =>
      authorizeRazorpayLiveRolloutMerchant(
        'acc_newmerchant',
        { ...vbfRollout, firstBindEnabled: false },
        base
      )
    ).toThrow(/not enabled/);
    expect(
      authorizeRazorpayLiveRolloutMerchant(
        'acc_existingacceptance',
        {
          ...vbfRollout,
          firstBindEnabled: false,
          merchantId: 'acc_existingacceptance',
          credentialMerchantId: 'acc_existingacceptance',
        },
        base
      )
    ).toBe('bound');
  });

  it('never lets one rollout account adopt a different bound merchant', () => {
    expect(() =>
      authorizeRazorpayLiveRolloutMerchant(
        'acc_differentmerchant',
        {
          accountId: '50a9e8f9-d7e5-44d2-ba04-c367509b981e',
          enabled: true,
          firstBindEnabled: false,
          merchantId: 'acc_TCJwBqanN9LTrK',
          credentialMerchantId: 'acc_TCJwBqanN9LTrK',
        },
        { RAZORPAY_MODE: 'live' }
      )
    ).toThrow(/not enabled/);
  });

  it('loads only the exact enabled Live rollout account', async () => {
    const accountId = '9c50dcd9-ed4a-427c-a2fc-07d452f0aec7';
    await expect(
      loadRazorpayLiveRolloutAuthorization(
        rolloutAdmin({
          data: {
            account_id: accountId,
            enabled: true,
            first_bind_enabled: true,
            merchant_id: null,
          },
          error: null,
        }),
        accountId,
        { RAZORPAY_MODE: 'live' }
      )
    ).resolves.toEqual({
      accountId,
      enabled: true,
      firstBindEnabled: true,
      merchantId: null,
      credentialMerchantId: null,
    });

    await expect(
      loadRazorpayLiveRolloutAuthorization(
        rolloutAdmin({ data: null, error: null }),
        accountId,
        { RAZORPAY_MODE: 'live' }
      )
    ).rejects.toThrow(/not enabled/);
  });

  it('keeps a claimed merchant in first-bind mode until credentials exist', () => {
    expect(
      authorizeRazorpayLiveRolloutMerchant(
        'acc_vbfmerchant',
        {
          ...vbfRollout,
          firstBindEnabled: false,
          merchantId: 'acc_vbfmerchant',
          credentialMerchantId: null,
        },
        { RAZORPAY_MODE: 'live' }
      )
    ).toBe('enrollment');
  });

  it('atomically closes first-bind enrollment around the returned merchant', async () => {
    const accountId = '9c50dcd9-ed4a-427c-a2fc-07d452f0aec7';
    const admin = {
      rpc: async () => ({ data: true, error: null }),
    } as unknown as SupabaseClient;
    await expect(
      claimRazorpayLiveRolloutMerchant(
        admin,
        {
          accountId,
          enabled: true,
          firstBindEnabled: true,
          merchantId: null,
          credentialMerchantId: null,
        },
        'acc_vbfmerchant',
        { RAZORPAY_MODE: 'live' }
      )
    ).resolves.toBe('enrollment');

    const rejectedAdmin = {
      rpc: async () => ({ data: false, error: null }),
    } as unknown as SupabaseClient;
    await expect(
      claimRazorpayLiveRolloutMerchant(
        rejectedAdmin,
        {
          accountId,
          enabled: true,
          firstBindEnabled: true,
          merchantId: null,
          credentialMerchantId: null,
        },
        'acc_vbfmerchant',
        { RAZORPAY_MODE: 'live' }
      )
    ).rejects.toThrow(/could not be claimed/);
  });
});
