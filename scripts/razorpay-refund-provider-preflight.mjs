import { createHash } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import { decrypt } from '../src/lib/whatsapp/encryption.ts';

const TEST_PROJECT_REF = 'hkuqzmgnhhgecqcbwupb';
const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1';
const REQUEST_TIMEOUT_MS = 30_000;
const WEBHOOK_WAIT_MS = 45_000;

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requireArgument(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix));
  if (!value) throw new Error(`${prefix}<value> is required`);
  return value.slice(prefix.length);
}

if (process.argv.includes('--help')) {
  console.log(`Usage:
  npm run accept:razorpay-refunds -- \\
    --account-id=<UsefulDesk account UUID> \\
    --payment-id=<captured Razorpay Test payment id> \\
    --idempotency-key=<stable 10+ character key> \\
    --confirm=isolated-test-full-refund

Requires the isolated Vercel Test environment in the current shell. The probe
fetches and lists the existing payment, creates one idempotent full Test refund,
fetches and lists that refund, then waits for a genuine signed application
webhook observation. It prints no token, credential, member data, or payload.`);
  process.exit(0);
}

const accountId = requireArgument('account-id');
const paymentId = requireArgument('payment-id');
const idempotencyKey = requireArgument('idempotency-key');
const confirmation = requireArgument('confirm');

if (confirmation !== 'isolated-test-full-refund') {
  throw new Error(
    'Explicit isolated Test full-refund confirmation is required'
  );
}
if (!/^[0-9a-f-]{36}$/.test(accountId)) {
  throw new Error('account-id must be a UUID');
}
if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) {
  throw new Error('payment-id must be a Razorpay payment id');
}
if (!/^[A-Za-z0-9_-]{10,}$/.test(idempotencyKey)) {
  throw new Error('idempotency-key violates Razorpay format requirements');
}

const providerMode = requireEnvironment('RAZORPAY_MODE');
const acceptanceOnly = requireEnvironment('RAZORPAY_PROVIDER_ACCEPTANCE_ONLY');
const supabaseUrl = requireEnvironment('NEXT_PUBLIC_SUPABASE_URL');
const serviceRoleKey = requireEnvironment('SUPABASE_SERVICE_ROLE_KEY');
requireEnvironment('ENCRYPTION_KEY');

const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
if (
  providerMode !== 'test' ||
  acceptanceOnly !== 'true' ||
  projectRef !== TEST_PROJECT_REF
) {
  throw new Error('Refund preflight is restricted to UsefulDesk Razorpay Test');
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: connection, error: connectionError } = await admin
  .from('account_payment_credentials')
  .select(
    'account_id, authentication_mode, provider_mode, connection_status, oauth_access_token, secret_storage_version, razorpay_account_id'
  )
  .eq('account_id', accountId)
  .eq('gateway', 'razorpay')
  .single();

if (connectionError || !connection) {
  throw new Error('The isolated OAuth connection could not be loaded');
}
if (
  connection.authentication_mode !== 'oauth' ||
  connection.provider_mode !== 'test' ||
  connection.connection_status !== 'ready' ||
  connection.secret_storage_version !== 1 ||
  !connection.oauth_access_token ||
  !connection.razorpay_account_id
) {
  throw new Error('The isolated OAuth connection is not refund-ready');
}

const accessToken = decrypt(connection.oauth_access_token);

function providerError(status, body) {
  const description = body?.error?.description;
  return typeof description === 'string'
    ? description.slice(0, 300)
    : `Razorpay request failed (${status})`;
}

async function razorpayRequest(path, init = {}) {
  const response = await fetch(`${RAZORPAY_API_BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(init.bodyText ? { 'Content-Type': 'application/json' } : {}),
      ...(init.idempotencyKey
        ? { 'X-Refund-Idempotency': init.idempotencyKey }
        : {}),
    },
    body: init.bodyText,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Razorpay returned invalid JSON (${response.status})`);
  }
  if (!response.ok) throw new Error(providerError(response.status, body));
  return { body, status: response.status };
}

const fetchedPayment = await razorpayRequest(
  `/payments/${encodeURIComponent(paymentId)}`
);
const payment = fetchedPayment.body;
if (
  payment?.id !== paymentId ||
  payment?.entity !== 'payment' ||
  payment?.status !== 'captured' ||
  payment?.captured !== true ||
  payment?.currency !== 'INR' ||
  !Number.isInteger(payment?.amount) ||
  payment.amount <= 0
) {
  throw new Error(
    'The selected provider payment is not a captured INR payment'
  );
}

const paymentWindowFrom = Math.max(0, Number(payment.created_at ?? 0) - 3600);
const listedPayments = await razorpayRequest(
  `/payments?from=${paymentWindowFrom}&count=100&skip=0`
);
if (
  !Array.isArray(listedPayments.body?.items) ||
  !listedPayments.body.items.some((item) => item?.id === paymentId)
) {
  throw new Error(
    'The selected provider payment was not present in list results'
  );
}

const refundBodyText = JSON.stringify({
  amount: payment.amount,
  receipt: idempotencyKey,
  notes: {
    usefuldesk_stage: 'stage4_provider_preflight',
    usefuldesk_payment_id: paymentId,
  },
});
const refundBodySha256 = createHash('sha256')
  .update(refundBodyText)
  .digest('hex');

const createdRefund = await razorpayRequest(
  `/payments/${encodeURIComponent(paymentId)}/refund`,
  {
    method: 'POST',
    bodyText: refundBodyText,
    idempotencyKey,
  }
);
const refund = createdRefund.body;
if (
  !/^rfnd_[A-Za-z0-9]+$/.test(refund?.id ?? '') ||
  refund?.payment_id !== paymentId ||
  refund?.amount !== payment.amount ||
  refund?.receipt !== idempotencyKey ||
  !['pending', 'processed'].includes(refund?.status)
) {
  throw new Error('Razorpay returned a refund that does not match the request');
}

const fetchedRefund = await razorpayRequest(
  `/refunds/${encodeURIComponent(refund.id)}`
);
if (
  fetchedRefund.body?.id !== refund.id ||
  fetchedRefund.body?.payment_id !== paymentId
) {
  throw new Error('Fetched refund identity does not match the created refund');
}

const refundWindowFrom = Math.max(0, Number(refund.created_at ?? 0) - 3600);
const listedRefunds = await razorpayRequest(
  `/refunds?from=${refundWindowFrom}&count=100&skip=0`
);
if (
  !Array.isArray(listedRefunds.body?.items) ||
  !listedRefunds.body.items.some((item) => item?.id === refund.id)
) {
  throw new Error('Created refund was not present in provider list results');
}

let signedEvent = null;
const waitUntil = Date.now() + WEBHOOK_WAIT_MS;
while (Date.now() < waitUntil) {
  const { data: events, error: eventsError } = await admin
    .from('webhook_events')
    .select(
      'id, type, payload_sha256, processing_status, processed_at, payload'
    )
    .eq('account_id', accountId)
    .eq('gateway', 'razorpay')
    .in('type', ['refund.processed', 'refund.failed'])
    .order('created_at', { ascending: false })
    .limit(10);
  if (eventsError) throw new Error('Could not inspect signed refund events');
  signedEvent = events?.find(
    (event) => event.payload?.payload?.refund?.entity?.id === refund.id
  );
  if (signedEvent) break;
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

if (!signedEvent) {
  throw new Error('No genuine signed application refund event arrived in time');
}

const { data: observations, error: observationsError } = await admin
  .from('razorpay_webhook_deliveries')
  .select(
    'ingress, event_type, payload_sha256, signature_secret_generation, shadow_only, canonical_mutation_attempted, received_at'
  )
  .eq('provider_mode', 'test')
  .eq('provider_event_id', signedEvent.id)
  .order('received_at');

if (observationsError || !observations?.length) {
  throw new Error('Signed refund delivery observation is missing');
}
if (
  !observations.some(
    (observation) =>
      observation.ingress === 'application' &&
      observation.event_type === signedEvent.type &&
      observation.payload_sha256 === signedEvent.payload_sha256 &&
      observation.signature_secret_generation === 'current' &&
      observation.canonical_mutation_attempted === false
  )
) {
  throw new Error(
    'Application refund observation did not match canonical identity'
  );
}

console.log(
  JSON.stringify(
    {
      checked_at: new Date().toISOString(),
      provider_mode: 'test',
      project_ref: projectRef,
      merchant_suffix: connection.razorpay_account_id.slice(-6),
      payment: {
        id_suffix: paymentId.slice(-8),
        fetch_status: fetchedPayment.status,
        listed: true,
        amount_subunits: payment.amount,
        captured: true,
      },
      refund: {
        id_suffix: refund.id.slice(-8),
        create_status: createdRefund.status,
        fetch_status: fetchedRefund.status,
        listed: true,
        provider_status: fetchedRefund.body.status,
        canonical_body_sha256: refundBodySha256,
      },
      signed_application_event: {
        event_id: signedEvent.id,
        event_type: signedEvent.type,
        payload_sha256: signedEvent.payload_sha256,
        processing_status: signedEvent.processing_status,
        processed_at: signedEvent.processed_at,
        observations: observations.map((observation) => ({
          ingress: observation.ingress,
          event_type: observation.event_type,
          payload_sha256: observation.payload_sha256,
          signature_secret_generation: observation.signature_secret_generation,
          shadow_only: observation.shadow_only,
          canonical_mutation_attempted:
            observation.canonical_mutation_attempted,
          received_at: observation.received_at,
        })),
      },
    },
    null,
    2
  )
);
