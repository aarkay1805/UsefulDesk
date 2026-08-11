import { describe, expect, it } from 'vitest';

import {
  authorizeRazorpayLivePilotMerchant,
  assertRazorpayApplicationWebhookConfigured,
  assertRazorpayLivePilotAccount,
  assertRazorpayLivePilotMerchant,
  assertRazorpayPinnedLivePilotMerchant,
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

  it('requires and enforces the single Live pilot account', () => {
    const pilot = '50a9e8f9-d7e5-44d2-ba04-c367509b981e';
    expect(() =>
      assertRazorpayLivePilotAccount(pilot, { RAZORPAY_MODE: 'live' })
    ).toThrow(/must be configured/);
    expect(() =>
      assertRazorpayLivePilotAccount('11111111-1111-4111-8111-111111111111', {
        RAZORPAY_MODE: 'live',
        RAZORPAY_LIVE_PILOT_ACCOUNT_ID: pilot,
      })
    ).toThrow(/not enabled/);
    expect(() =>
      assertRazorpayLivePilotAccount(pilot, {
        RAZORPAY_MODE: 'live',
        RAZORPAY_LIVE_PILOT_ACCOUNT_ID: pilot,
      })
    ).not.toThrow();
    expect(() =>
      assertRazorpayLivePilotAccount('any-test-account', {
        RAZORPAY_MODE: 'test',
      })
    ).not.toThrow();
  });

  it('requires a current application webhook secret before selector activation', () => {
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

  it('requires and enforces the single Live pilot merchant', () => {
    expect(() =>
      assertRazorpayLivePilotMerchant('acc_expected', {
        RAZORPAY_MODE: 'live',
      })
    ).toThrow(/must be configured/);
    expect(() =>
      assertRazorpayLivePilotMerchant('acc_other', {
        RAZORPAY_MODE: 'live',
        RAZORPAY_LIVE_PILOT_MERCHANT_ID: 'acc_expected',
      })
    ).toThrow(/not enabled/);
    expect(() =>
      assertRazorpayLivePilotMerchant('acc_expected', {
        RAZORPAY_MODE: 'live',
        RAZORPAY_LIVE_PILOT_MERCHANT_ID: 'acc_expected',
      })
    ).not.toThrow();
    expect(() =>
      assertRazorpayLivePilotMerchant('any-test-merchant', {
        RAZORPAY_MODE: 'test',
      })
    ).toThrow(/identity is invalid/);
    expect(() =>
      assertRazorpayLivePilotMerchant('acc_anytestmerchant', {
        RAZORPAY_MODE: 'test',
      })
    ).not.toThrow();
  });

  it('allows only an explicit Live first-bind enrollment window', () => {
    const base = {
      RAZORPAY_MODE: 'live',
      RAZORPAY_LIVE_PILOT_MERCHANT_ID: 'acc_existingacceptance',
    };
    expect(
      authorizeRazorpayLivePilotMerchant('acc_newmerchant', {
        ...base,
        RAZORPAY_LIVE_PILOT_ENROLLMENT_ENABLED: 'true',
      })
    ).toBe('enrollment');
    expect(() =>
      authorizeRazorpayLivePilotMerchant('acc_newmerchant', {
        ...base,
        RAZORPAY_LIVE_PILOT_ENROLLMENT_ENABLED: 'false',
      })
    ).toThrow(/not enabled/);
    expect(
      authorizeRazorpayLivePilotMerchant('acc_existingacceptance', {
        ...base,
        RAZORPAY_LIVE_PILOT_ENROLLMENT_ENABLED: 'true',
      })
    ).toBe('pinned');
  });

  it('never admits first-bind enrollment at the pinned recovery boundary', () => {
    const env = {
      RAZORPAY_MODE: 'live',
      RAZORPAY_LIVE_PILOT_MERCHANT_ID: 'acc_existingacceptance',
      RAZORPAY_LIVE_PILOT_ENROLLMENT_ENABLED: 'true',
    };
    expect(() =>
      assertRazorpayPinnedLivePilotMerchant('acc_existingacceptance', env)
    ).not.toThrow();
    expect(() =>
      assertRazorpayPinnedLivePilotMerchant('acc_newmerchant', env)
    ).toThrow(/pinned pilot/);
  });
});
