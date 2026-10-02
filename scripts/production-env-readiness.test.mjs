import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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

const intakeEnvironment = {
  ...validEnvironment,
  USEFULDESK_SAAS_RAZORPAY_MODE: 'live',
  USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID: 'rzp_live_pilot',
  USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_SECRET: 'private-live-secret',
  USEFULDESK_SAAS_RAZORPAY_LIVE_WEBHOOK_SECRET: 'private-webhook-secret',
  USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID: 'acc_UsefulmadeLive',
  USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID:
    '11111111-1111-4111-8111-111111111111',
  USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED: 'true',
};

const starterFlags = [
  'USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED',
  'USEFULDESK_SAAS_LIVE_QUOTES_ENABLED',
  'USEFULDESK_SAAS_LIVE_ORDERS_ENABLED',
  'USEFULDESK_SAAS_LIVE_REFUNDS_ENABLED',
  'USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED',
  'USEFULDESK_SAAS_LIVE_REFUND_RECONCILIATION_ENABLED',
  'NEXT_PUBLIC_USEFULDESK_LIVE_REVIEW_UI',
  'NEXT_PUBLIC_USEFULDESK_LIVE_CHECKOUT_UI',
];
const recoveryFlags = [
  'USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED',
  'USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED',
  'USEFULDESK_SAAS_LIVE_REFUND_RECONCILIATION_ENABLED',
  'USEFULDESK_SAAS_LIVE_FINANCIAL_RECOVERY_ENABLED',
];
const starterEnvironment = {
  ...intakeEnvironment,
  USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID: 'acc_TCJwBqanN9LTrK',
  USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID:
    '8826d9aa-03f2-4ad7-ae91-0553052131f8',
  ...Object.fromEntries(starterFlags.map((name) => [name, 'true'])),
};
const recoveryEnvironment = {
  ...starterEnvironment,
  ...Object.fromEntries(
    starterFlags.map((name) => [
      name,
      recoveryFlags.includes(name) ? 'true' : 'false',
    ])
  ),
  USEFULDESK_SAAS_LIVE_FINANCIAL_RECOVERY_ENABLED: 'true',
};
const blocker = (check) =>
  expect.objectContaining({ severity: 'blocker', ...(check ? { check } : {}) });

describe('production environment readiness', () => {
  it('permits delivery evidence only with explicitly reviewed, enabled Live intake', () => {
    const name = 'USEFULDESK_SAAS_LIVE_DELIVERY_EVIDENCE_ENABLED';
    const checks = evaluateProductionEnvironment(
      { ...recoveryEnvironment, [name]: 'true' },
      { allowLiveRecoveryOnly: true }
    );
    expect(checks).not.toContainEqual(blocker());
    expect(checks).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        check: 'subscription-live-delivery-evidence',
      })
    );
    expect(
      evaluateProductionEnvironment({ ...intakeEnvironment, [name]: 'true' })
    ).toContainEqual(blocker('production-safety-flags'));
    expect(
      evaluateProductionEnvironment(
        { ...intakeEnvironment, [name]: 'true' },
        { allowLiveIntakeOnly: true }
      )
    ).not.toContainEqual(blocker());
    expect(
      evaluateProductionEnvironment(
        { ...starterEnvironment, [name]: 'true' },
        { allowLiveStarterPilot: true }
      )
    ).not.toContainEqual(blocker());
    for (const value of ['1', 'TRUE', ' true ', '[SENSITIVE]']) {
      expect(
        evaluateProductionEnvironment(
          { ...recoveryEnvironment, [name]: value },
          { allowLiveRecoveryOnly: true }
        )
      ).toContainEqual(blocker('production-safety-flags'));
    }
    expect(
      evaluateProductionEnvironment(
        {
          ...intakeEnvironment,
          [name]: 'true',
          USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED: 'false',
        },
        { allowLiveIntakeOnly: true }
      )
    ).toContainEqual(blocker('production-safety-flags'));
  });
  it('keeps external monitoring closed unless separately configured', () => {
    expect(evaluateProductionEnvironment(validEnvironment)).toContainEqual(
      expect.objectContaining({
        severity: 'pass',
        check: 'external-monitor-switch',
      })
    );
  });
  it.each(['', 'short', 'cron'])(
    'refuses missing or dispatch-capable monitor tokens %s',
    (token) => {
      expect(
        evaluateProductionEnvironment({
          ...validEnvironment,
          AUTOMATION_CRON_SECRET: token || 'worker',
          USEFULDESK_EXTERNAL_MONITOR_ENABLED: 'true',
          USEFULDESK_EXTERNAL_MONITOR_TOKEN: token,
        })
      ).toContainEqual(blocker('external-monitor-token'));
    }
  );
  it('requires delivery acceptance even with a valid or provider-hidden monitor token', () => {
    for (const token of ['d'.repeat(64), '[SENSITIVE]']) {
      const checks = evaluateProductionEnvironment({
        ...validEnvironment,
        USEFULDESK_EXTERNAL_MONITOR_ENABLED: 'true',
        USEFULDESK_EXTERNAL_MONITOR_TOKEN: token,
      });
      expect(checks).not.toContainEqual(blocker('external-monitor-token'));
      expect(checks).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          check: 'external-monitor-acceptance',
        })
      );
    }
  });
  it('keeps the new native scheduler disabled by default', () => {
    expect(evaluateProductionEnvironment(validEnvironment)).toContainEqual(
      expect.objectContaining({ severity: 'pass', check: 'native-cron-switch' })
    );
  });

  it('requires the reserved secret for enabled native dispatch', () => {
    const results = evaluateProductionEnvironment({
      ...validEnvironment,
      USEFULDESK_VERCEL_CRONS_ENABLED: 'true',
      VERCEL_ENV: 'production',
    });
    expect(results).toContainEqual(blocker('native-cron-secret'));
  });

  it('accepts native configuration without exposing its secret or proving delivery', () => {
    const results = evaluateProductionEnvironment({
      ...validEnvironment,
      USEFULDESK_VERCEL_CRONS_ENABLED: 'true',
      VERCEL_ENV: 'production',
      CRON_SECRET: 'private-native-secret',
    });
    expect(results).not.toContainEqual(blocker());
    expect(results).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        check: 'native-cron-acceptance',
      })
    );
    expect(JSON.stringify(results)).not.toContain('private-native-secret');
  });

  it.each(['preview', 'development', '[SENSITIVE]'])(
    'blocks enabled native dispatch with unproven runtime (%s)',
    (runtime) => {
      expect(
        evaluateProductionEnvironment({
          ...validEnvironment,
          USEFULDESK_VERCEL_CRONS_ENABLED: 'true',
          VERCEL_ENV: runtime,
          CRON_SECRET: 'private-native-secret',
        })
      ).toContainEqual(blocker('native-cron-runtime'));
    }
  );

  it.each(['1', 'TRUE', '[SENSITIVE]', ' false '])(
    'blocks ambiguous native flag configuration (%s)',
    (flag) => {
      expect(
        evaluateProductionEnvironment({
          ...validEnvironment,
          USEFULDESK_VERCEL_CRONS_ENABLED: flag,
        })
      ).toContainEqual(blocker('native-cron-switch'));
    }
  );

  it('retains private-original verification when the native secret is opaque', () => {
    expect(
      evaluateProductionEnvironment({
        ...validEnvironment,
        USEFULDESK_VERCEL_CRONS_ENABLED: 'true',
        CRON_SECRET: '[SENSITIVE]',
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'warning',
          check: 'native-cron-secret',
        }),
        expect.objectContaining({
          severity: 'warning',
          check: 'native-cron-runtime',
        }),
      ])
    );
  });

  it('requires explicit intake-only auditing and reports the enabled boundary', () => {
    expect(evaluateProductionEnvironment(intakeEnvironment)).toContainEqual(
      expect.objectContaining({ severity: 'blocker' })
    );
    const results = evaluateProductionEnvironment(intakeEnvironment, {
      allowLiveIntakeOnly: true,
    });
    expect(results).not.toContainEqual(
      expect.objectContaining({ severity: 'blocker' })
    );
    expect(results).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        check: 'subscription-live-intake-only',
      })
    );
    expect(JSON.stringify(results)).not.toContain('private-live-secret');
    expect(JSON.stringify(results)).not.toContain('private-webhook-secret');
  });

  it.each([
    'USEFULDESK_SUBSCRIPTION_INTENTS_ENABLED',
    'USEFULDESK_SUBSCRIPTION_REFUNDS_ENABLED',
    'USEFULDESK_SAAS_LIVE_QUOTES_ENABLED',
    'USEFULDESK_SAAS_LIVE_ORDERS_ENABLED',
    'USEFULDESK_SAAS_LIVE_REFUNDS_ENABLED',
    'USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED',
    'USEFULDESK_SAAS_LIVE_REFUND_RECONCILIATION_ENABLED',
    'USEFULDESK_SAAS_LIVE_FINANCIAL_RECOVERY_ENABLED',
    'NEXT_PUBLIC_USEFULDESK_TEST_BILLING_UI',
    'NEXT_PUBLIC_USEFULDESK_LIVE_REVIEW_UI',
    'NEXT_PUBLIC_USEFULDESK_LIVE_CHECKOUT_UI',
  ])('still blocks %s during intake-only auditing', (name) => {
    for (const value of ['true', '1', '[SENSITIVE]']) {
      expect(
        evaluateProductionEnvironment(
          { ...intakeEnvironment, [name]: value },
          { allowLiveIntakeOnly: true }
        )
      ).toContainEqual(
        expect.objectContaining({
          severity: 'blocker',
          check: 'production-safety-flags',
        })
      );
    }
  });

  it('refuses hidden/nonliteral intake and incomplete or Test configuration in intake-only auditing', () => {
    const variants = [
      { USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED: '[SENSITIVE]' },
      { USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED: '1' },
      { USEFULDESK_SAAS_RAZORPAY_LIVE_WEBHOOK_SECRET: '' },
      { USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID: 'rzp_test_wrong' },
      { USEFULDESK_SAAS_RAZORPAY_MODE: 'test' },
      { USEFULDESK_SAAS_RAZORPAY_TEST_KEY_SECRET: 'wrong-test-secret' },
    ];
    for (const variant of variants) {
      expect(
        evaluateProductionEnvironment(
          { ...intakeEnvironment, ...variant },
          { allowLiveIntakeOnly: true }
        )
      ).toContainEqual(expect.objectContaining({ severity: 'blocker' }));
    }
  });

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
      'USEFULDESK_SAAS_LIVE_QUOTES_ENABLED',
      'USEFULDESK_SAAS_LIVE_ORDERS_ENABLED',
      'USEFULDESK_SAAS_LIVE_REFUNDS_ENABLED',
      'USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED',
      'USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED',
      'USEFULDESK_SAAS_LIVE_REFUND_RECONCILIATION_ENABLED',
      'NEXT_PUBLIC_USEFULDESK_LIVE_CHECKOUT_UI',
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

  describe.each([
    ['Starter pilot', 'allowLiveStarterPilot', starterEnvironment],
    ['recovery only', 'allowLiveRecoveryOnly', recoveryEnvironment],
  ])('%s explicit audit scope', (_label, option, environment) => {
    const options = { [option]: true };
    it('permits only explicit scope and keeps operational verification separate', () => {
      expect(evaluateProductionEnvironment(environment)).toContainEqual(
        blocker('production-safety-flags')
      );
      expect(
        evaluateProductionEnvironment(environment, {
          allowLiveIntakeOnly: true,
        })
      ).toContainEqual(blocker('production-safety-flags'));
      const results = evaluateProductionEnvironment(environment, options);
      expect(results).not.toContainEqual(blocker());
      expect(results).toContainEqual(
        expect.objectContaining({
          severity: 'pass',
          check: 'subscription-live-boundary',
        })
      );
      for (const check of [
        'subscription-live-database-verification',
        'subscription-live-offer-verification',
        'subscription-live-activation-authority',
        'subscription-live-runtime',
      ]) {
        expect(results).toContainEqual(
          expect.objectContaining({ severity: 'warning', check })
        );
      }
      expect(JSON.stringify(results)).toContain(
        'does not seed an offer or establish tax/receipt clearance'
      );
      const output = JSON.stringify(results);
      for (const name of [
        'USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID',
        'USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_SECRET',
        'USEFULDESK_SAAS_RAZORPAY_LIVE_WEBHOOK_SECRET',
        'USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID',
        'USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID',
      ]) {
        expect(output).not.toContain(environment[name]);
      }
    });

    it.each([
      ['USEFULDESK_SAAS_RAZORPAY_MODE', 'test'],
      ['USEFULDESK_SAAS_RAZORPAY_MODE', ' live '],
      ['USEFULDESK_SAAS_RAZORPAY_MODE', '[SENSITIVE]'],
      ['USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID', 'rzp_test_wrong'],
      ['USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID', '[SENSITIVE]'],
      ['USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID', 'acc_OtherMerchant'],
      ['USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID', '[SENSITIVE]'],
      [
        'USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID',
        '11111111-1111-4111-8111-111111111111',
      ],
      ['USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID', '[SENSITIVE]'],
      ['USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID', 'invalid-pilot'],
      ['NODE_ENV', 'development'],
      ['VERCEL_ENV', 'preview'],
      ['VERCEL_ENV', '[SENSITIVE]'],
    ])('rejects an invalid, unverified or changed %s', (name, value) => {
      expect(
        evaluateProductionEnvironment(
          { ...environment, [name]: value },
          options
        )
      ).toContainEqual(blocker());
    });

    it.each([
      'USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID',
      'USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_SECRET',
      'USEFULDESK_SAAS_RAZORPAY_LIVE_WEBHOOK_SECRET',
      'USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID',
      'USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID',
      'USEFULDESK_SAAS_RAZORPAY_MODE',
    ])('rejects missing required %s', (name) => {
      const incomplete = { ...environment };
      delete incomplete[name];
      expect(evaluateProductionEnvironment(incomplete, options)).toContainEqual(
        blocker('subscription-live-boundary')
      );
    });

    it.each([
      'WHATSAPP_TEMPLATES_DRY_RUN',
      'RAZORPAY_LIVE_PILOT_ENROLLMENT_ENABLED',
      'RAZORPAY_PROVIDER_ACCEPTANCE_ONLY',
      'RAZORPAY_REFUND_WEBHOOK_RETRY_ACCEPTANCE',
      'RAZORPAY_REFUND_AMBIGUOUS_CREATE_ACCEPTANCE',
      'USEFULDESK_SUBSCRIPTION_INTENTS_ENABLED',
      'USEFULDESK_SUBSCRIPTION_REFUNDS_ENABLED',
      'NEXT_PUBLIC_USEFULDESK_TEST_BILLING_UI',
      'USEFULDESK_SAAS_LIVE_RENEWALS_ENABLED',
      'USEFULDESK_SAAS_LIVE_CAPABILITIES_ENABLED',
      'USEFULDESK_SUBSCRIPTION_CAPABILITIES_ENABLED',
      'NEXT_PUBLIC_USEFULDESK_LIVE_FUTURE_UI',
    ])('blocks Test, acceptance and unreviewed switch %s', (name) => {
      for (const value of ['true', '1', 'TRUE', '[SENSITIVE]', 'yes']) {
        expect(
          evaluateProductionEnvironment(
            { ...environment, [name]: value },
            options
          )
        ).toContainEqual(blocker('production-safety-flags'));
      }
    });

    it('rejects Test merchant configuration even with opaque Live secrets', () => {
      const results = evaluateProductionEnvironment(
        {
          ...environment,
          USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_SECRET: '[SENSITIVE]',
          USEFULDESK_SAAS_RAZORPAY_TEST_KEY_ID: 'rzp_test_forbidden',
        },
        options
      );
      expect(results).toContainEqual(blocker('subscription-test-boundary'));
      expect(JSON.stringify(results)).not.toContain('rzp_test_forbidden');
    });

    it('allows redacted secrets only as unverified warnings with valid visible binding', () => {
      const results = evaluateProductionEnvironment(
        {
          ...environment,
          NODE_ENV: 'production',
          VERCEL_ENV: 'production',
          USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_SECRET: '[SENSITIVE]',
          USEFULDESK_SAAS_RAZORPAY_LIVE_WEBHOOK_SECRET: '[SENSITIVE]',
        },
        options
      );
      expect(results).not.toContainEqual(blocker());
      expect(results).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          check: 'subscription-live-boundary',
        })
      );
      expect(results).toContainEqual(
        expect.objectContaining({
          severity: 'pass',
          check: 'subscription-live-runtime',
        })
      );
    });

    it.each(starterFlags)(
      'rejects a partial or nonliteral scope at %s',
      (name) => {
        const required =
          option === 'allowLiveStarterPilot' || recoveryFlags.includes(name);
        const values = required
          ? ['', 'false', '1', 'TRUE', ' true ', '[SENSITIVE]']
          : ['true', '1', 'TRUE', '[SENSITIVE]', 'yes'];
        for (const value of values) {
          expect(
            evaluateProductionEnvironment(
              { ...environment, [name]: value },
              options
            )
          ).toContainEqual(blocker());
        }
      }
    );
  });

  it('allows unset closed recovery flags and refuses recovery as an opening audit', () => {
    const recovery = { ...recoveryEnvironment };
    for (const name of starterFlags.filter(
      (name) => !recoveryFlags.includes(name)
    ))
      delete recovery[name];
    expect(
      evaluateProductionEnvironment(recovery, { allowLiveRecoveryOnly: true })
    ).not.toContainEqual(blocker());
    expect(
      evaluateProductionEnvironment(recovery, { allowLiveStarterPilot: true })
    ).toContainEqual(blocker('subscription-live-starter-pilot'));
    expect(
      evaluateProductionEnvironment(starterEnvironment, {
        allowLiveRecoveryOnly: true,
      })
    ).toContainEqual(blocker('production-safety-flags'));
  });

  it('requires the dedicated worker flag for recovery while preserving the opening-only pilot audit', () => {
    const name = 'USEFULDESK_SAAS_LIVE_FINANCIAL_RECOVERY_ENABLED';
    for (const value of [
      '',
      'false',
      '1',
      'TRUE',
      ' true ',
      '[SENSITIVE]',
      'yes',
    ]) {
      expect(
        evaluateProductionEnvironment(
          { ...recoveryEnvironment, [name]: value },
          { allowLiveRecoveryOnly: true }
        )
      ).toContainEqual(blocker());
    }
    for (const value of ['', 'false', 'true']) {
      expect(
        evaluateProductionEnvironment(
          { ...starterEnvironment, [name]: value },
          { allowLiveStarterPilot: true }
        )
      ).not.toContainEqual(blocker());
    }
    for (const value of ['1', 'TRUE', ' true ', '[SENSITIVE]', 'yes']) {
      expect(
        evaluateProductionEnvironment(
          { ...starterEnvironment, [name]: value },
          { allowLiveStarterPilot: true }
        )
      ).toContainEqual(blocker('production-safety-flags'));
    }
    expect(
      evaluateProductionEnvironment(
        {
          ...starterEnvironment,
          [name]: 'true',
          USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID: 'acc_Foreign',
        },
        { allowLiveStarterPilot: true }
      )
    ).toContainEqual(blocker('subscription-live-boundary'));
  });

  it.each([
    { allowLiveIntakeOnly: true, allowLiveStarterPilot: true },
    { allowLiveIntakeOnly: true, allowLiveRecoveryOnly: true },
    { allowLiveStarterPilot: true, allowLiveRecoveryOnly: true },
    {
      allowLiveIntakeOnly: true,
      allowLiveStarterPilot: true,
      allowLiveRecoveryOnly: true,
    },
  ])('refuses contradictory explicit audit options %j', (options) => {
    expect(
      evaluateProductionEnvironment(starterEnvironment, options)
    ).toContainEqual(blocker('subscription-live-audit-mode'));
  });

  it.each([
    { USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID: 'rzp_test_invalid' },
    { USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID: 'invalid-merchant' },
    { USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID: 'invalid-pilot' },
  ])(
    'never lets opaque secrets mask invalid visible Live identities %j',
    (changed) => {
      const environment = {
        ...intakeEnvironment,
        USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED: 'false',
        USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_SECRET: '[SENSITIVE]',
        ...changed,
      };
      expect(evaluateProductionEnvironment(environment)).toContainEqual(
        blocker('subscription-live-boundary')
      );
    }
  );

  it('rejects intake without its configuration instead of treating Live billing as absent', () => {
    expect(
      evaluateProductionEnvironment(
        {
          ...validEnvironment,
          USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED: 'true',
        },
        { allowLiveIntakeOnly: true }
      )
    ).toContainEqual(blocker('subscription-live-boundary'));
  });

  it.each([
    ['--allow-live-starter-pilot', starterEnvironment],
    ['--allow-live-recovery-only', recoveryEnvironment],
  ])('wires %s through the value-free stdin CLI', (mode, environment) => {
    const input = Object.entries(environment)
      .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
      .join('\n');
    const script = fileURLToPath(
      new URL('./production-env-readiness.mjs', import.meta.url)
    );
    const accepted = spawnSync(
      process.execPath,
      [script, '--dotenv-stdin', mode],
      { input, encoding: 'utf8', env: {} }
    );
    expect(accepted.status).toBe(0);
    expect(accepted.stdout).toContain('Summary: 0 blocker(s)');
    expect(accepted.stdout).toContain(
      'Environment checks do not authorize activation'
    );
    expect(accepted.stdout).not.toContain('private-live-secret');
    expect(accepted.stdout).not.toContain('private-webhook-secret');
    expect(accepted.stdout).not.toContain(
      environment.USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID
    );
    expect(accepted.stdout).not.toContain(
      environment.USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID
    );
    expect(accepted.stdout).not.toContain(
      environment.USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID
    );
    const rejected = spawnSync(
      process.execPath,
      [script, '--dotenv-stdin', mode, '--allow-live-intake-only'],
      { input, encoding: 'utf8', env: {} }
    );
    expect(rejected.status).toBe(1);
    expect(rejected.stdout).toContain('mutually exclusive');
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
