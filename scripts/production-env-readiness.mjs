import { pathToFileURL } from 'node:url';

const OPAQUE_VALUE = '[SENSITIVE]';

const CORE_ENVIRONMENT = Object.freeze([
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ENCRYPTION_KEY',
  'META_APP_SECRET',
  'NEXT_PUBLIC_SITE_URL',
  'AUTOMATION_CRON_SECRET',
]);

const RAZORPAY_ENVIRONMENT = Object.freeze([
  'RAZORPAY_MODE',
  'RAZORPAY_OAUTH_CLIENT_ID',
  'RAZORPAY_OAUTH_CLIENT_SECRET',
  'RAZORPAY_OAUTH_REDIRECT_URI',
  'RAZORPAY_WEBHOOK_SECRET_CURRENT',
]);

const UNSAFE_PRODUCTION_FLAGS = Object.freeze([
  'WHATSAPP_TEMPLATES_DRY_RUN',
  'RAZORPAY_LIVE_PILOT_ENROLLMENT_ENABLED',
  'RAZORPAY_PROVIDER_ACCEPTANCE_ONLY',
  'RAZORPAY_REFUND_WEBHOOK_RETRY_ACCEPTANCE',
  'RAZORPAY_REFUND_AMBIGUOUS_CREATE_ACCEPTANCE',
  'USEFULDESK_SUBSCRIPTION_INTENTS_ENABLED',
  'USEFULDESK_SUBSCRIPTION_REFUNDS_ENABLED',
  'NEXT_PUBLIC_USEFULDESK_TEST_BILLING_UI',
  'NEXT_PUBLIC_USEFULDESK_LIVE_REVIEW_UI',
  'NEXT_PUBLIC_USEFULDESK_LIVE_CHECKOUT_UI',
  'USEFULDESK_SAAS_LIVE_QUOTES_ENABLED',
  'USEFULDESK_SAAS_LIVE_ORDERS_ENABLED',
  'USEFULDESK_SAAS_LIVE_REFUNDS_ENABLED',
  'USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED',
  'USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED',
  'USEFULDESK_SAAS_LIVE_REFUND_RECONCILIATION_ENABLED',
]);

const LIVE_SAAS_ENVIRONMENT = Object.freeze([
  'USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID',
  'USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_SECRET',
  'USEFULDESK_SAAS_RAZORPAY_LIVE_WEBHOOK_SECRET',
  'USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID',
  'USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID',
]);

function normalize(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isOpaque(value) {
  return normalize(value) === OPAQUE_VALUE;
}

function enabled(value) {
  return ['1', 'true'].includes(normalize(value).toLowerCase());
}

export function parseDotenv(source) {
  const parsed = {};
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2];
    try {
      value = JSON.parse(value);
    } catch {
      // Unquoted dotenv values are already usable as-is.
    }
    parsed[match[1]] = String(value);
  }
  return parsed;
}

export function evaluateProductionEnvironment(
  env,
  { allowLiveIntakeOnly = false } = {}
) {
  const results = [];
  const add = (severity, check, message) =>
    results.push({ severity, check, message });

  const missingCore = CORE_ENVIRONMENT.filter((name) => !normalize(env[name]));
  if (missingCore.length) {
    add(
      'blocker',
      'core-environment',
      `Missing required names: ${missingCore.join(', ')}`
    );
  } else {
    add(
      'pass',
      'core-environment',
      `All ${CORE_ENVIRONMENT.length} required names are present.`
    );
  }

  const siteUrl = normalize(env.NEXT_PUBLIC_SITE_URL);
  if (!siteUrl) {
    add('blocker', 'canonical-url', 'NEXT_PUBLIC_SITE_URL is missing.');
  } else if (isOpaque(siteUrl)) {
    add(
      'warning',
      'canonical-url',
      'The provider hides NEXT_PUBLIC_SITE_URL; verify it equals the canonical HTTPS origin.'
    );
  } else if (siteUrl !== 'https://desk.usefulmade.com') {
    add(
      'blocker',
      'canonical-url',
      'NEXT_PUBLIC_SITE_URL does not equal the canonical Production origin.'
    );
  } else {
    add('pass', 'canonical-url', 'Canonical Production origin is configured.');
  }

  const encryptionKey = normalize(env.ENCRYPTION_KEY);
  if (isOpaque(encryptionKey)) {
    add(
      'warning',
      'encryption-key',
      'The provider hides ENCRYPTION_KEY; its 64-hex format cannot be verified through this export.'
    );
  } else if (encryptionKey && !/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
    add(
      'blocker',
      'encryption-key',
      'ENCRYPTION_KEY is present but is not 64 hexadecimal characters.'
    );
  } else if (encryptionKey) {
    add('pass', 'encryption-key', 'ENCRYPTION_KEY has the required format.');
  }

  const intakeName = 'USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED';
  const reviewedIntake =
    allowLiveIntakeOnly && normalize(env[intakeName]) === 'true';
  const unsafeFlags = UNSAFE_PRODUCTION_FLAGS.filter(
    (name) => enabled(env[name]) && !(name === intakeName && reviewedIntake)
  );
  const opaqueSafetyFlags = UNSAFE_PRODUCTION_FLAGS.filter((name) =>
    isOpaque(env[name])
  );
  if (unsafeFlags.length) {
    add(
      'blocker',
      'production-safety-flags',
      `Unsafe Production flags are enabled: ${unsafeFlags.join(', ')}`
    );
  } else if (opaqueSafetyFlags.length) {
    add(
      'blocker',
      'production-safety-flags',
      `Provider-hidden safety flags require a dashboard value check: ${opaqueSafetyFlags.join(', ')}`
    );
  } else {
    add(
      'pass',
      'production-safety-flags',
      reviewedIntake
        ? 'Only Live webhook intake is permitted by this explicit audit mode; all other safety flags are false or unset.'
        : 'Test/dry-run provider flags are false or unset.'
    );
  }
  if (reviewedIntake) {
    add(
      'warning',
      'subscription-live-intake-only',
      'Live webhook intake is enabled. This audit mode does not authorize activation; verify the reviewed database binding and held-only receiver separately.'
    );
  }

  const testSubscriptionConfiguration = Object.keys(env).filter(
    (name) =>
      (name === 'USEFULDESK_SAAS_RAZORPAY_MODE' &&
        normalize(env[name]) === 'test') ||
      (name.startsWith('USEFULDESK_SAAS_RAZORPAY_TEST_') &&
        normalize(env[name]))
  );
  add(
    testSubscriptionConfiguration.length ? 'blocker' : 'pass',
    'subscription-test-boundary',
    testSubscriptionConfiguration.length
      ? `Test SaaS merchant configuration must be absent from Production: ${testSubscriptionConfiguration.join(', ')}`
      : 'Test SaaS merchant configuration is absent.'
  );

  const livePresent =
    LIVE_SAAS_ENVIRONMENT.some((name) => normalize(env[name])) ||
    normalize(env.USEFULDESK_SAAS_RAZORPAY_MODE) === 'live';
  if (livePresent) {
    const missingLive = LIVE_SAAS_ENVIRONMENT.filter(
      (name) => !normalize(env[name])
    );
    const opaqueLive = LIVE_SAAS_ENVIRONMENT.filter((name) =>
      isOpaque(env[name])
    );
    const keyId = normalize(env.USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID);
    const merchantId = normalize(env.USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID);
    const pilotId = normalize(env.USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID);
    if (
      normalize(env.USEFULDESK_SAAS_RAZORPAY_MODE) !== 'live' ||
      missingLive.length
    ) {
      add(
        'blocker',
        'subscription-live-boundary',
        `Live SaaS mode or required names are missing: ${missingLive.join(', ')}`
      );
    } else if (opaqueLive.length) {
      add(
        'warning',
        'subscription-live-boundary',
        `Protected Live SaaS values require a private dashboard check: ${opaqueLive.join(', ')}`
      );
    } else if (
      !/^rzp_live_[A-Za-z0-9]+$/.test(keyId) ||
      !/^acc_[A-Za-z0-9]+$/.test(merchantId) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        pilotId
      )
    ) {
      add(
        'blocker',
        'subscription-live-boundary',
        'Live SaaS key ID, merchant ID or pilot organization has an invalid format.'
      );
    } else {
      add(
        'pass',
        'subscription-live-boundary',
        'Live SaaS merchant names and formats are present; merchant ownership and shared-account webhook routing still need private verification.'
      );
    }
  } else {
    add(
      'pass',
      'subscription-live-boundary',
      'Live SaaS merchant configuration is absent; Live billing remains unavailable.'
    );
  }

  const razorpayConfigured = RAZORPAY_ENVIRONMENT.some((name) =>
    normalize(env[name])
  );
  if (razorpayConfigured) {
    const missingRazorpay = RAZORPAY_ENVIRONMENT.filter(
      (name) => !normalize(env[name])
    );
    if (missingRazorpay.length) {
      add(
        'blocker',
        'razorpay-live-boundary',
        `Partial Razorpay configuration is missing: ${missingRazorpay.join(', ')}`
      );
    } else if (normalize(env.RAZORPAY_MODE) !== 'live') {
      add(
        'blocker',
        'razorpay-live-boundary',
        'Production RAZORPAY_MODE must equal live.'
      );
    } else {
      add(
        'pass',
        'razorpay-live-boundary',
        'Razorpay uses the live boundary and all required names are present.'
      );
    }
  } else {
    add(
      'warning',
      'razorpay-live-boundary',
      'Razorpay is not configured; payment-provider features must remain unavailable.'
    );
  }

  const turnstileSite = Boolean(normalize(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY));
  const turnstileSecret = Boolean(normalize(env.TURNSTILE_SECRET_KEY));
  if (turnstileSite && turnstileSecret) {
    add('pass', 'public-lead-capture', 'Turnstile key names are present.');
  } else if (turnstileSite || turnstileSecret) {
    add(
      'blocker',
      'public-lead-capture',
      'Turnstile is only partially configured; public lead capture is not deployable.'
    );
  } else {
    add(
      'warning',
      'public-lead-capture',
      'Turnstile is absent, so Production public lead-form submissions intentionally fail closed.'
    );
  }

  if (enabled(env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED)) {
    if (normalize(env.NEXT_PUBLIC_GOOGLE_CLIENT_ID)) {
      add('pass', 'google-auth', 'Google sign-in has its public client ID.');
    } else {
      add(
        'blocker',
        'google-auth',
        'Google sign-in is enabled without NEXT_PUBLIC_GOOGLE_CLIENT_ID.'
      );
    }
  } else {
    add('pass', 'google-auth', 'Google sign-in is disabled or not advertised.');
  }

  return results;
}

function render(results) {
  for (const result of results) {
    console.log(
      `${result.severity.toUpperCase()} ${result.check}: ${result.message}`
    );
  }
  const blockers = results.filter((result) => result.severity === 'blocker');
  const warnings = results.filter((result) => result.severity === 'warning');
  console.log(
    `Summary: ${blockers.length} blocker(s), ${warnings.length} warning(s). Secret values were not printed.`
  );
  if (blockers.length) process.exitCode = 1;
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log(`Usage:
  node scripts/production-env-readiness.mjs
  vercel env pull <temporary-file> --environment production --yes
  node --env-file=<temporary-file> scripts/production-env-readiness.mjs
  cat <dotenv-file> | node scripts/production-env-readiness.mjs --dotenv-stdin

After separate release-specific approval of held-only webhook intake:
  cat <dotenv-file> | node scripts/production-env-readiness.mjs --dotenv-stdin --allow-live-intake-only

The explicit intake-only audit mode permits only the literal true webhook-intake
flag. It still blocks Test billing, money initiation, settlement, reconciliation,
review and Checkout UI flags. It does not authorize a provider or database change.

The audit prints only variable names and status messages, never values. Vercel
marks sensitive exports as [SENSITIVE], so format/value checks for those entries
remain explicit warnings or blockers instead of being guessed.`);
    return;
  }

  let env = process.env;
  if (process.argv.includes('--dotenv-stdin')) {
    let source = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) source += chunk;
    env = parseDotenv(source);
  }
  render(
    evaluateProductionEnvironment(env, {
      allowLiveIntakeOnly: process.argv.includes('--allow-live-intake-only'),
    })
  );
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(`Production environment audit failed: ${error.message}`);
    process.exitCode = 1;
  });
}
