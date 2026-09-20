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
