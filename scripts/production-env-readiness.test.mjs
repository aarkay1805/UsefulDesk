import { describe, expect, it } from 'vitest';

import {
  evaluateProductionEnvironment,
  parseDotenv,
} from './production-env-readiness.mjs';

const validEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  ENCRYPTION_KEY: 'a'.repeat(64),
  META_APP_SECRET: 'meta',
  NEXT_PUBLIC_SITE_URL: 'https://desk.usefulmade.com',
  AUTOMATION_CRON_SECRET: 'cron',
  RAZORPAY_MODE: 'live',
  RAZORPAY_OAUTH_CLIENT_ID: 'client',
  RAZORPAY_OAUTH_CLIENT_SECRET: 'secret',
  RAZORPAY_OAUTH_REDIRECT_URI:
    'https://desk.usefulmade.com/api/payments/razorpay/oauth/callback',
  RAZORPAY_WEBHOOK_SECRET_CURRENT: 'webhook',
  NEXT_PUBLIC_GOOGLE_AUTH_ENABLED: 'true',
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: 'google-client',
};

describe('production environment readiness', () => {
  it.each([
    'USEFULDESK_SUBSCRIPTION_INTENTS_ENABLED',
    'USEFULDESK_SUBSCRIPTION_REFUNDS_ENABLED',
    'NEXT_PUBLIC_USEFULDESK_TEST_BILLING_UI',
  ])('blocks enabled or hidden Test billing flag %s', (name) => {
    for (const value of ['true', '1', '[SENSITIVE]']) {
      expect(
        evaluateProductionEnvironment({ ...validEnvironment, [name]: value })
      ).toContainEqual(
        expect.objectContaining({
          severity: 'blocker',
          check: 'production-safety-flags',
        })
      );
    }
    expect(
      evaluateProductionEnvironment({ ...validEnvironment, [name]: 'false' })
    ).not.toContainEqual(expect.objectContaining({ severity: 'blocker' }));
  });

  it('blocks SaaS Test merchant configuration without printing its values', () => {
    const results = evaluateProductionEnvironment({
      ...validEnvironment,
      USEFULDESK_SAAS_RAZORPAY_MODE: 'test',
      USEFULDESK_SAAS_RAZORPAY_TEST_KEY_SECRET: 'private-test-value',
    });
    expect(results).toContainEqual(
      expect.objectContaining({
        severity: 'blocker',
        check: 'subscription-test-boundary',
      })
    );
    expect(JSON.stringify(results)).not.toContain('private-test-value');
  });

  it('accepts a complete dark Live configuration while rejecting Test credentials and money switches', () => {
    const live = {
      ...validEnvironment,
      USEFULDESK_SAAS_RAZORPAY_MODE: 'live',
      USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID: 'rzp_live_pilot',
      USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_SECRET: 'private-live-secret',
      USEFULDESK_SAAS_RAZORPAY_LIVE_WEBHOOK_SECRET: 'private-webhook-secret',
      USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID: 'acc_UsefulmadeLive',
      USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID:
        '11111111-1111-4111-8111-111111111111',
    };
    const results = evaluateProductionEnvironment(live);
    expect(results).toContainEqual(
      expect.objectContaining({
        severity: 'pass',
        check: 'subscription-live-boundary',
      })
    );
    expect(JSON.stringify(results)).not.toContain('private-live-secret');
    for (const name of [
      'USEFULDESK_SAAS_LIVE_ORDERS_ENABLED',
      'USEFULDESK_SAAS_LIVE_REFUNDS_ENABLED',
      'USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED',
      'USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED',
      'USEFULDESK_SAAS_LIVE_REFUND_RECONCILIATION_ENABLED',
    ]) {
      expect(
        evaluateProductionEnvironment({ ...live, [name]: 'true' })
      ).toContainEqual(
        expect.objectContaining({
          severity: 'blocker',
          check: 'production-safety-flags',
        })
      );
    }
    expect(
      evaluateProductionEnvironment({
        ...live,
        USEFULDESK_SAAS_RAZORPAY_TEST_KEY_ID: 'rzp_test_wrong',
      })
    ).toContainEqual(
      expect.objectContaining({
        severity: 'blocker',
        check: 'subscription-test-boundary',
      })
    );
  });

  it('rejects partial or mismatched Live merchant configuration', () => {
    const base = {
      ...validEnvironment,
      USEFULDESK_SAAS_RAZORPAY_MODE: 'live',
      USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID: 'rzp_test_wrong',
    };
    expect(evaluateProductionEnvironment(base)).toContainEqual(
      expect.objectContaining({
        severity: 'blocker',
        check: 'subscription-live-boundary',
      })
    );
  });

  it('parses quoted provider exports without evaluating their contents', () => {
    expect(
      parseDotenv(
        '# generated\nNEXT_PUBLIC_SITE_URL="https://desk.usefulmade.com"\nTOKEN="$(do-not-run)"\n'
      )
    ).toEqual({
      NEXT_PUBLIC_SITE_URL: 'https://desk.usefulmade.com',
      TOKEN: '$(do-not-run)',
    });
  });

  it('accepts a safe core configuration and keeps optional lead capture visible', () => {
    const results = evaluateProductionEnvironment(validEnvironment);

    expect(results).not.toContainEqual(
      expect.objectContaining({ severity: 'blocker' })
    );
    expect(results).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        check: 'public-lead-capture',
      })
    );
  });

  it('blocks dry-run provider flags and partial Turnstile configuration', () => {
    const results = evaluateProductionEnvironment({
      ...validEnvironment,
      WHATSAPP_TEMPLATES_DRY_RUN: 'true',
      RAZORPAY_LIVE_PILOT_ENROLLMENT_ENABLED: 'true',
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'site',
    });

    expect(results).toContainEqual(
      expect.objectContaining({
        severity: 'blocker',
        check: 'production-safety-flags',
      })
    );
    expect(results).toContainEqual(
      expect.objectContaining({
        severity: 'blocker',
        check: 'public-lead-capture',
      })
    );
  });

  it('does not treat provider-hidden sensitive values as verified', () => {
    const results = evaluateProductionEnvironment({
      ...validEnvironment,
      NEXT_PUBLIC_SITE_URL: '[SENSITIVE]',
      ENCRYPTION_KEY: '[SENSITIVE]',
      RAZORPAY_PROVIDER_ACCEPTANCE_ONLY: '[SENSITIVE]',
    });

    expect(results).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        check: 'canonical-url',
      })
    );
    expect(results).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        check: 'encryption-key',
      })
    );
    expect(results).toContainEqual(
      expect.objectContaining({
        severity: 'blocker',
        check: 'production-safety-flags',
      })
    );
  });
});
