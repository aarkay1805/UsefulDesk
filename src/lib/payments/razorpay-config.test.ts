import { describe, expect, it } from 'vitest';

import {
  assertRazorpayProviderMode,
  getRazorpayOAuthConfig,
  getRazorpayProviderMode,
  isRazorpayManualRollbackEnabled,
  isRazorpayOAuthEnabled,
} from './razorpay-config';

describe('Razorpay rollout configuration', () => {
  it('keeps both rollout paths disabled unless explicitly true', () => {
    expect(isRazorpayOAuthEnabled({})).toBe(false);
    expect(isRazorpayManualRollbackEnabled({})).toBe(false);
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
});
