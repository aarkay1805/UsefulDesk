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
  'USEFULDESK_SAAS_LIVE_FINANCIAL_RECOVERY_ENABLED',
]);

// Review boundary only: these modes never write settings or approve an offer.
const STARTER_PILOT_FLAGS = Object.freeze([
  'USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED',
  'USEFULDESK_SAAS_LIVE_QUOTES_ENABLED',
  'USEFULDESK_SAAS_LIVE_ORDERS_ENABLED',
  'USEFULDESK_SAAS_LIVE_REFUNDS_ENABLED',
  'USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED',
  'USEFULDESK_SAAS_LIVE_REFUND_RECONCILIATION_ENABLED',
  'NEXT_PUBLIC_USEFULDESK_LIVE_REVIEW_UI',
  'NEXT_PUBLIC_USEFULDESK_LIVE_CHECKOUT_UI',
]);
const LIVE_RECOVERY_FLAGS = Object.freeze([
  'USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED',
  'USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED',
  'USEFULDESK_SAAS_LIVE_REFUND_RECONCILIATION_ENABLED',
  'USEFULDESK_SAAS_LIVE_FINANCIAL_RECOVERY_ENABLED',
]);
const STARTER_PILOT_MERCHANT = 'acc_TCJwBqanN9LTrK';
const STARTER_PILOT_ORGANIZATION = '8826d9aa-03f2-4ad7-ae91-0553052131f8';

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
  {
    allowLiveIntakeOnly = false,
    allowLiveStarterPilot = false,
    allowLiveRecoveryOnly = false,
  } = {}
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

  const conflictingModes =
    [allowLiveIntakeOnly, allowLiveStarterPilot, allowLiveRecoveryOnly].filter(
      Boolean
    ).length > 1;
  if (conflictingModes) {
    add(
      'blocker',
      'subscription-live-audit-mode',
      'Live intake-only, Starter pilot and recovery-only audit modes are mutually exclusive.'
    );
  }
  const scopedLiveMode =
    !conflictingModes && (allowLiveStarterPilot || allowLiveRecoveryOnly);
  const requiredLiveFlags = conflictingModes
    ? []
    : allowLiveStarterPilot
      ? STARTER_PILOT_FLAGS
      : allowLiveRecoveryOnly
        ? LIVE_RECOVERY_FLAGS
        : [];
  // The existing opening audit remains compatible with a closed worker. A
  // separately reviewed pilot may enable it; recovery-only requires it.
  const permittedLiveFlags = scopedLiveMode
    ? [...requiredLiveFlags, 'USEFULDESK_SAAS_LIVE_FINANCIAL_RECOVERY_ENABLED']
    : requiredLiveFlags;
  const intakeName = 'USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED';
  const reviewedIntake =
    !conflictingModes &&
    allowLiveIntakeOnly &&
    normalize(env[intakeName]) === 'true';
  // Newly introduced SaaS switches cannot silently inherit an audit exception.
  const safetyFlagNames = [
    ...new Set([
      ...UNSAFE_PRODUCTION_FLAGS,
      ...Object.keys(env).filter((name) =>
        /^(?:NEXT_PUBLIC_)?USEFULDESK_(?:SAAS_|LIVE_|SUBSCRIPTION_).*(?:_ENABLED|_UI)$/.test(
          name
        )
      ),
    ]),
  ];
  const unsafeFlags = safetyFlagNames.filter(
    (name) =>
      enabled(env[name]) &&
      !(name === intakeName && reviewedIntake) &&
      !(permittedLiveFlags.includes(name) && env[name] === 'true')
  );
  const opaqueSafetyFlags = safetyFlagNames.filter((name) =>
    isOpaque(env[name])
  );
  const malformedClosedFlags = scopedLiveMode
    ? safetyFlagNames.filter(
        (name) =>
          !requiredLiveFlags.includes(name) &&
          normalize(env[name]) &&
          env[name] !== 'false' &&
          !enabled(env[name]) &&
          !isOpaque(env[name])
      )
    : [];
  if (unsafeFlags.length) {
    add(
      'blocker',
      'production-safety-flags',
      `Unsafe Production flags are enabled: ${unsafeFlags.join(', ')}`
    );
  }
  if (opaqueSafetyFlags.length) {
    add(
      'blocker',
      'production-safety-flags',
      `Provider-hidden safety flags require a dashboard value check: ${opaqueSafetyFlags.join(', ')}`
    );
  }
  if (malformedClosedFlags.length) {
    add(
      'blocker',
      'production-safety-flags',
      `Flags outside the selected Live audit scope must be literal false or unset: ${malformedClosedFlags.join(', ')}`
    );
  }
  if (
    !unsafeFlags.length &&
    !opaqueSafetyFlags.length &&
    !malformedClosedFlags.length
  ) {
    add(
      'pass',
      'production-safety-flags',
      scopedLiveMode
        ? 'Only the selected Live audit scope is permitted; other safety flags are false or unset.'
        : reviewedIntake
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
  if (scopedLiveMode) {
    const scopeCheck = allowLiveStarterPilot
      ? 'subscription-live-starter-pilot'
      : 'subscription-live-recovery-only';
    const incompleteFlags = requiredLiveFlags.filter(
      (name) => env[name] !== 'true'
    );
    add(
      incompleteFlags.length ? 'blocker' : 'pass',
      scopeCheck,
      incompleteFlags.length
        ? `The selected Live audit scope requires literal true for every required flag: ${incompleteFlags.join(', ')}`
        : allowLiveStarterPilot
          ? 'The complete initial Starter pilot flag set is present; renewal and capability activation remain outside this audit scope.'
          : 'The required intake, settlement, refund reconciliation and financial recovery flags are present; quote/order/refund initiation and both Live UI flags must remain closed.'
    );
    const wrongRuntime = ['NODE_ENV', 'VERCEL_ENV'].filter(
      (name) => normalize(env[name]) && env[name] !== 'production'
    );
    const absentRuntime = ['NODE_ENV', 'VERCEL_ENV'].filter(
      (name) => !normalize(env[name])
    );
    if (wrongRuntime.length) {
      add(
        'blocker',
        'subscription-live-runtime',
        `Live runtime must be Production: ${wrongRuntime.join(', ')}`
      );
    } else if (absentRuntime.length) {
      add(
        'warning',
        'subscription-live-runtime',
        `System runtime names absent from the export need separate deployment verification: ${absentRuntime.join(', ')}`
      );
    } else {
      add(
        'pass',
        'subscription-live-runtime',
        'Explicit Live runtime names equal Production.'
      );
    }
    add(
      'warning',
      'subscription-live-database-verification',
      'Verify the reviewed database merchant/pilot binding, scoped opening constraints and matching settings independently; renewals and tier capabilities must remain closed.'
    );
    add(
      'warning',
      'subscription-live-offer-verification',
      'Separately verify the immutable approved Starter offer: INR 79900 paise gross, one branch, 1800-second quote, capture-event calendar month and 7/3/1 reminders after 09:00 local. This audit does not seed an offer or establish tax/receipt clearance.'
    );
    add(
      'warning',
      'subscription-live-activation-authority',
      'Environment checks do not authorize activation or prove owner approval, signed shared-merchant delivery, provider acceptance or release acceptance. Verify dated evidence separately before any operational change or human payment.'
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
    Boolean(normalize(env.USEFULDESK_SAAS_RAZORPAY_MODE)) ||
    scopedLiveMode ||
    reviewedIntake;
  if (livePresent) {
    const missingLive = LIVE_SAAS_ENVIRONMENT.filter(
      (name) => !normalize(env[name])
    );
    const opaqueLive = LIVE_SAAS_ENVIRONMENT.filter((name) =>
      isOpaque(env[name])
    );
    const merchantId = normalize(env.USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID);
    const pilotId = normalize(env.USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID);
    const identityFormats = [
      ['USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID', /^rzp_live_[A-Za-z0-9]+$/],
      ['USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID', /^acc_[A-Za-z0-9]+$/],
      [
        'USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID',
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ],
    ];
    const invalidIdentities = identityFormats
      .filter(
        ([name, format]) =>
          !isOpaque(env[name]) && !format.test(normalize(env[name]))
      )
      .map(([name]) => name);
    const opaqueIdentities = identityFormats
      .filter(([name]) => isOpaque(env[name]))
      .map(([name]) => name);
    if (
      (scopedLiveMode
        ? env.USEFULDESK_SAAS_RAZORPAY_MODE !== 'live'
        : normalize(env.USEFULDESK_SAAS_RAZORPAY_MODE) !== 'live') ||
      missingLive.length
    ) {
      add(
        'blocker',
        'subscription-live-boundary',
        `Live SaaS mode or required names are missing: ${missingLive.join(', ')}`
      );
    } else if (invalidIdentities.length) {
      // Secret redaction must never mask a visible Test key or malformed binding.
      add(
        'blocker',
        'subscription-live-boundary',
        `Live SaaS identity formats are invalid: ${invalidIdentities.join(', ')}`
      );
    } else if (scopedLiveMode && opaqueIdentities.length) {
      add(
        'blocker',
        'subscription-live-boundary',
        `The selected Live audit scope requires visible, verifiable identity values: ${opaqueIdentities.join(', ')}`
      );
    } else if (
      scopedLiveMode &&
      (merchantId !== STARTER_PILOT_MERCHANT ||
        pilotId !== STARTER_PILOT_ORGANIZATION)
    ) {
      add(
        'blocker',
        'subscription-live-boundary',
        'Live SaaS merchant or pilot organization differs from the reviewed Starter pilot binding.'
      );
    } else if (opaqueLive.length) {
      add(
        'warning',
        'subscription-live-boundary',
        `Protected Live SaaS values require a private dashboard check: ${opaqueLive.join(', ')}`
      );
    } else {
      add(
        'pass',
        'subscription-live-boundary',
        scopedLiveMode
          ? 'Live key format and the exact reviewed Starter merchant/pilot binding are verified; secret validity and shared-account webhook routing require private verification.'
          : 'Live SaaS merchant names and formats are present; merchant ownership and shared-account webhook routing still need private verification.'
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

After separately reviewed initial Starter pilot activation:
  cat <dotenv-file> | node scripts/production-env-readiness.mjs --dotenv-stdin --allow-live-starter-pilot

For separately reviewed rollback recovery with initiation and UI closed:
  cat <dotenv-file> | node scripts/production-env-readiness.mjs --dotenv-stdin --allow-live-recovery-only

Starter mode requires all eight Live intake, quote/order/refund, settlement,
refund-reconciliation and review/Checkout UI flags to be literal true together.
The separately reviewed financial recovery worker may be enabled in Starter mode;
its dedicated flag remains optional for an existing opening-only audit.
Recovery mode requires literal true intake, settlement, refund reconciliation and
USEFULDESK_SAAS_LIVE_FINANCIAL_RECOVERY_ENABLED,
with quote/order/refund and both Live UI flags false or unset. Both modes require
the exact reviewed merchant/pilot and a visible Live key ID; Test, acceptance,
capability and renewal switches are not allowed. Audit modes are mutually exclusive.
Database settings/constraints, immutable offer, tax/receipt clearance, approval and
acceptance remain separate checks. This preparation does not seed an offer or
open any gate. A passing audit never authorizes payment or activation.

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
      allowLiveStarterPilot: process.argv.includes(
        '--allow-live-starter-pilot'
      ),
      allowLiveRecoveryOnly: process.argv.includes(
        '--allow-live-recovery-only'
      ),
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
