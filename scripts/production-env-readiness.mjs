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

export function evaluateProductionEnvironment(env) {
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

  const unsafeFlags = UNSAFE_PRODUCTION_FLAGS.filter((name) =>
    enabled(env[name])
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
      'Test/dry-run provider flags are false or unset.'
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
  render(evaluateProductionEnvironment(env));
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
