const RAZORPAY_API_BASE = 'https://api.razorpay.com';
const REQUEST_TIMEOUT_MS = 30_000;

const capabilityChecks = [
  { name: 'customers', path: '/v1/customers?count=1' },
  { name: 'plans', path: '/v1/plans?count=1' },
  { name: 'subscriptions', path: '/v1/subscriptions?count=1' },
  {
    name: 'payment_links',
    path: '/v1/payment_links?count=1',
    collectionKey: 'payment_links',
  },
  { name: 'payments', path: '/v1/payments?count=1' },
];

if (process.argv.includes('--help')) {
  console.log(`Usage:
  RAZORPAY_MODE=test \\
  RAZORPAY_ACCEPTANCE_ACCESS_TOKEN=<development OAuth access token> \\
  RAZORPAY_ACCEPTANCE_ACCOUNT_ID=<authorized test merchant account id> \\
  npm run accept:razorpay

The command makes read-only list requests for Customers, Plans, Subscriptions,
Payment Links, and Payments. It never prints tokens, merchant data, or provider
response bodies. The optional account readiness probe is reported separately
because imported OAuth accounts may not expose the Accounts API.`);
  process.exit(0);
}

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const mode = requireEnvironment('RAZORPAY_MODE');
if (mode !== 'test') {
  throw new Error(
    'Provider acceptance is test-only. RAZORPAY_MODE must equal test.'
  );
}

const accessToken = requireEnvironment('RAZORPAY_ACCEPTANCE_ACCESS_TOKEN');
const accountId = requireEnvironment('RAZORPAY_ACCEPTANCE_ACCOUNT_ID');
if (!/^acc_[A-Za-z0-9]+$/.test(accountId)) {
  throw new Error(
    'RAZORPAY_ACCEPTANCE_ACCOUNT_ID is not a Razorpay account id'
  );
}

function browserSafeError(status, value) {
  const description =
    value && typeof value === 'object' && 'error' in value
      ? value.error?.description
      : undefined;
  const message =
    typeof description === 'string'
      ? description
      : `Razorpay request failed (${status})`;
  return message.slice(0, 500);
}

async function request(path) {
  const startedAt = performance.now();
  const response = await fetch(`${RAZORPAY_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`Razorpay returned invalid JSON (${response.status})`);
    }
  }
  if (!response.ok) {
    throw new Error(browserSafeError(response.status, body));
  }
  return {
    body,
    elapsedMs: Math.round(performance.now() - startedAt),
    status: response.status,
  };
}

const results = [];
for (const check of capabilityChecks) {
  try {
    const { body, elapsedMs, status } = await request(check.path);
    const collection = check.collectionKey
      ? body?.[check.collectionKey]
      : body?.items;
    if (!Array.isArray(collection)) {
      throw new Error('unexpected collection response shape');
    }
    results.push({
      capability: check.name,
      ok: true,
      status,
      elapsed_ms: elapsedMs,
      returned_count: collection.length,
    });
  } catch (error) {
    results.push({
      capability: check.name,
      ok: false,
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }
}

let accountProbe;
try {
  const { body, elapsedMs, status } = await request(
    `/v2/accounts/${encodeURIComponent(accountId)}`
  );
  accountProbe = {
    ok: body?.id === accountId,
    status,
    elapsed_ms: elapsedMs,
    merchant_status:
      typeof body?.status === 'string' ? body.status : 'not_returned',
    live_payments: typeof body?.live === 'boolean' ? body.live : 'not_returned',
  };
} catch (error) {
  accountProbe = {
    ok: false,
    optional: true,
    error: error instanceof Error ? error.message : 'unknown error',
  };
}

const report = {
  checked_at: new Date().toISOString(),
  provider_mode: mode,
  merchant_account_suffix: accountId.slice(-6),
  mutations_performed: false,
  capabilities: results,
  optional_account_readiness_probe: accountProbe,
};

console.log(JSON.stringify(report, null, 2));

if (results.some((result) => !result.ok)) {
  process.exitCode = 1;
}
