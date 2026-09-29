import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

const API_BASE = 'https://api.razorpay.com/v1';
const PROVIDER_TIMEOUT_MS = 15_000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORDER_ID = /^order_[A-Za-z0-9]+$/;
const PAYMENT_ID = /^pay_[A-Za-z0-9]+$/;
const REFUND_ID = /^rfnd_[A-Za-z0-9]+$/;

export interface LiveBillingConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  merchantId: string;
  pilotOrganizationId: string;
}

/** Usefulmade's SaaS merchant is distinct from Test billing and gym OAuth. */
export function liveBillingConfig(
  env: NodeJS.ProcessEnv = process.env
): LiveBillingConfig {
  if (
    env.NODE_ENV !== 'production' ||
    env.VERCEL_ENV !== 'production' ||
    env.USEFULDESK_SAAS_RAZORPAY_MODE !== 'live' ||
    env.USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED !== 'true'
  )
    throw new Error('Live subscription intake is disabled');
  const keyId = env.USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID?.trim();
  const keySecret = env.USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_SECRET?.trim();
  const webhookSecret =
    env.USEFULDESK_SAAS_RAZORPAY_LIVE_WEBHOOK_SECRET?.trim();
  const merchantId = env.USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID?.trim();
  const pilotOrganizationId =
    env.USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID?.trim();
  if (
    !/^rzp_live_[A-Za-z0-9]+$/.test(keyId ?? '') ||
    !keySecret ||
    !webhookSecret ||
    !/^acc_[A-Za-z0-9]+$/.test(merchantId ?? '') ||
    !UUID.test(pilotOrganizationId ?? '') ||
    env.USEFULDESK_SAAS_RAZORPAY_TEST_KEY_ID ||
    env.USEFULDESK_SAAS_RAZORPAY_TEST_KEY_SECRET ||
    env.USEFULDESK_SAAS_RAZORPAY_TEST_WEBHOOK_SECRET ||
    env.USEFULDESK_SAAS_RAZORPAY_TEST_MERCHANT_ID
  )
    throw new Error('Usefulmade Live merchant configuration is incomplete');
  return {
    keyId: keyId!,
    keySecret,
    webhookSecret,
    merchantId: merchantId!,
    pilotOrganizationId: pilotOrganizationId!,
  };
}

export function liveOrdersEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.USEFULDESK_SAAS_LIVE_ORDERS_ENABLED === 'true';
}

export function liveRefundsEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.USEFULDESK_SAAS_LIVE_REFUNDS_ENABLED === 'true';
}

export function liveSettlementsEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED === 'true';
}

export function liveRefundReconciliationEnabled(
  env: NodeJS.ProcessEnv = process.env
) {
  return env.USEFULDESK_SAAS_LIVE_REFUND_RECONCILIATION_ENABLED === 'true';
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hmacMatches(
  payload: string,
  signature: string | null,
  secret: string
) {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const actual = Buffer.from(signature, 'hex');
  return timingSafeEqual(expected, actual);
}

export function verifyLiveWebhookSignature(
  rawBody: string,
  signature: string | null,
  config: LiveBillingConfig
) {
  return hmacMatches(rawBody, signature, config.webhookSecret);
}

export function verifyLiveCheckoutSignature(
  orderId: string,
  paymentId: string,
  signature: string | null,
  config: LiveBillingConfig
) {
  return (
    ORDER_ID.test(orderId) &&
    PAYMENT_ID.test(paymentId) &&
    hmacMatches(`${orderId}|${paymentId}`, signature, config.keySecret)
  );
}

async function request(
  config: LiveBillingConfig,
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown } = {},
  fetchImpl: typeof fetch = fetch
): Promise<unknown> {
  const response = await fetchImpl(`${API_BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok)
    throw new Error(
      `Usefulmade Live provider request failed (${response.status})`
    );
  return response.json() as Promise<unknown>;
}

export interface LiveOrderFacts {
  requestId: string;
  organizationId: string;
  amountMinor: number;
}

function assertFacts(facts: LiveOrderFacts) {
  if (
    !UUID.test(facts.requestId) ||
    !UUID.test(facts.organizationId) ||
    !Number.isSafeInteger(facts.amountMinor) ||
    facts.amountMinor < 1
  )
    throw new Error('Invalid Live order facts');
}

function assertMoneyGate(
  config: LiveBillingConfig,
  kind: 'orders' | 'refunds',
  env: NodeJS.ProcessEnv
) {
  const current = liveBillingConfig(env);
  if (
    (kind === 'orders' ? !liveOrdersEnabled(env) : !liveRefundsEnabled(env)) ||
    current.keyId !== config.keyId ||
    current.keySecret !== config.keySecret ||
    current.merchantId !== config.merchantId ||
    current.pilotOrganizationId !== config.pilotOrganizationId
  )
    throw new Error(`Live ${kind} are disabled or unbound`);
}

function verifiedOrder(value: unknown, facts: LiveOrderFacts) {
  if (
    !record(value) ||
    typeof value.id !== 'string' ||
    !ORDER_ID.test(value.id) ||
    value.amount !== facts.amountMinor ||
    value.currency !== 'INR' ||
    value.receipt !== facts.requestId ||
    !['created', 'attempted', 'paid'].includes(String(value.status)) ||
    !record(value.notes) ||
    value.notes.usefuldesk_organization_id !== facts.organizationId ||
    value.notes.usefuldesk_request_id !== facts.requestId
  )
    throw new Error('Usefulmade Live order identity does not match');
  return {
    id: value.id,
    amountMinor: facts.amountMinor,
    currency: 'INR' as const,
  };
}

/** The caller must save one durable claim before invoking this POST. */
export async function createLiveOrder(
  config: LiveBillingConfig,
  facts: LiveOrderFacts,
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env
) {
  assertMoneyGate(config, 'orders', env);
  assertFacts(facts);
  if (facts.organizationId !== config.pilotOrganizationId)
    throw new Error('Organization is outside the Live pilot');
  return verifiedOrder(
    await request(
      config,
      '/orders',
      {
        method: 'POST',
        body: {
          amount: facts.amountMinor,
          currency: 'INR',
          receipt: facts.requestId,
          partial_payment: false,
          notes: {
            usefuldesk_organization_id: facts.organizationId,
            usefuldesk_request_id: facts.requestId,
          },
        },
      },
      fetchImpl
    ),
    facts
  );
}

/** An ambiguous create never authorizes another POST. */
export async function recoverLiveOrder(
  config: LiveBillingConfig,
  facts: LiveOrderFacts,
  fetchImpl: typeof fetch = fetch
) {
  assertFacts(facts);
  if (facts.organizationId !== config.pilotOrganizationId)
    throw new Error('Organization is outside the Live pilot');
  const result = await request(
    config,
    `/orders?receipt=${encodeURIComponent(facts.requestId)}&count=2`,
    {},
    fetchImpl
  );
  if (!record(result) || !Array.isArray(result.items))
    throw new Error('Invalid Live order recovery response');
  if (result.count !== 1 || result.items.length !== 1) return null;
  return verifiedOrder(result.items[0], facts);
}

export async function fetchLiveOrder(
  config: LiveBillingConfig,
  facts: LiveOrderFacts & { orderId: string },
  fetchImpl: typeof fetch = fetch
) {
  assertFacts(facts);
  if (
    facts.organizationId !== config.pilotOrganizationId ||
    !ORDER_ID.test(facts.orderId)
  )
    throw new Error('Invalid Live order identity');
  const result = verifiedOrder(
    await request(config, `/orders/${facts.orderId}`, {}, fetchImpl),
    facts
  );
  if (result.id !== facts.orderId)
    throw new Error('Live order identity changed');
  return result;
}

/** Fresh provider GET; credentials, order notes, and the DB merchant binding must agree. */
export async function fetchCapturedLivePayment(
  config: LiveBillingConfig,
  facts: LiveOrderFacts & { orderId: string; paymentId: string },
  fetchImpl: typeof fetch = fetch
) {
  assertFacts(facts);
  if (
    facts.organizationId !== config.pilotOrganizationId ||
    !ORDER_ID.test(facts.orderId) ||
    !PAYMENT_ID.test(facts.paymentId)
  )
    throw new Error('Invalid Live payment identity');
  verifiedOrder(
    await request(config, `/orders/${facts.orderId}`, {}, fetchImpl),
    facts
  );
  const payment = await request(
    config,
    `/payments/${facts.paymentId}`,
    {},
    fetchImpl
  );
  if (
    !record(payment) ||
    payment.id !== facts.paymentId ||
    payment.order_id !== facts.orderId ||
    payment.amount !== facts.amountMinor ||
    payment.currency !== 'INR' ||
    payment.status !== 'captured' ||
    payment.captured !== true ||
    payment.amount_refunded !== 0
  )
    throw new Error('Usefulmade Live payment is not a matching capture');
  return {
    id: facts.paymentId,
    orderId: facts.orderId,
    amountMinor: facts.amountMinor,
  };
}

/** Resolve a refund webhook to its order without trusting a claimed order ID. */
export async function fetchLivePaymentOrderId(
  config: LiveBillingConfig,
  paymentId: string,
  fetchImpl: typeof fetch = fetch
) {
  if (!PAYMENT_ID.test(paymentId)) throw new Error('Invalid Live payment ID');
  const payment = await request(
    config,
    `/payments/${paymentId}`,
    {},
    fetchImpl
  );
  if (
    !record(payment) ||
    payment.id !== paymentId ||
    typeof payment.order_id !== 'string' ||
    !ORDER_ID.test(payment.order_id)
  )
    throw new Error('Live payment has no valid order');
  return payment.order_id;
}

export interface LiveRefundFacts extends LiveOrderFacts {
  orderId: string;
  paymentId: string;
  refundRequestId: string;
}

function verifiedRefund(value: unknown, facts: LiveRefundFacts) {
  if (
    !record(value) ||
    typeof value.id !== 'string' ||
    !REFUND_ID.test(value.id) ||
    value.payment_id !== facts.paymentId ||
    value.amount !== facts.amountMinor ||
    value.currency !== 'INR' ||
    value.receipt !== facts.refundRequestId ||
    !['pending', 'failed', 'processed'].includes(String(value.status)) ||
    !record(value.notes) ||
    value.notes.usefuldesk_organization_id !== facts.organizationId ||
    value.notes.usefuldesk_request_id !== facts.refundRequestId
  )
    throw new Error('Usefulmade Live refund identity does not match');
  return {
    id: value.id,
    status: value.status as 'pending' | 'failed' | 'processed',
  };
}

/** Caller must first save a single refund claim and confirm no later paid obligation. */
export async function createLiveFullRefund(
  config: LiveBillingConfig,
  facts: LiveRefundFacts,
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env
) {
  assertMoneyGate(config, 'refunds', env);
  if (!UUID.test(facts.refundRequestId))
    throw new Error('Invalid Live refund request');
  await fetchCapturedLivePayment(config, facts, fetchImpl);
  const previous = await request(
    config,
    `/payments/${facts.paymentId}/refunds?count=2`,
    {},
    fetchImpl
  );
  if (
    !record(previous) ||
    previous.count !== 0 ||
    !Array.isArray(previous.items) ||
    previous.items.length !== 0
  )
    throw new Error('Existing Live refund requires review');
  return verifiedRefund(
    await request(
      config,
      `/payments/${facts.paymentId}/refund`,
      {
        method: 'POST',
        body: {
          amount: facts.amountMinor,
          speed: 'normal',
          receipt: facts.refundRequestId,
          notes: {
            usefuldesk_organization_id: facts.organizationId,
            usefuldesk_request_id: facts.refundRequestId,
          },
        },
      },
      fetchImpl
    ),
    facts
  );
}

export async function recoverLiveFullRefund(
  config: LiveBillingConfig,
  facts: LiveRefundFacts,
  fetchImpl: typeof fetch = fetch
) {
  assertFacts(facts);
  if (
    facts.organizationId !== config.pilotOrganizationId ||
    !UUID.test(facts.refundRequestId)
  )
    throw new Error('Invalid Live refund identity');
  const result = await request(
    config,
    `/payments/${facts.paymentId}/refunds?count=2`,
    {},
    fetchImpl
  );
  if (!record(result) || !Array.isArray(result.items))
    throw new Error('Invalid Live refund recovery response');
  if (result.count !== 1 || result.items.length !== 1) return null;
  return verifiedRefund(result.items[0], facts);
}

export async function fetchLiveRefund(
  config: LiveBillingConfig,
  facts: LiveRefundFacts,
  refundId: string,
  fetchImpl: typeof fetch = fetch
) {
  assertFacts(facts);
  if (
    facts.organizationId !== config.pilotOrganizationId ||
    !UUID.test(facts.refundRequestId) ||
    !REFUND_ID.test(refundId)
  )
    throw new Error('Invalid Live refund identity');
  const result = verifiedRefund(
    await request(
      config,
      `/payments/${facts.paymentId}/refunds/${refundId}`,
      {},
      fetchImpl
    ),
    facts
  );
  if (result.id !== refundId) throw new Error('Live refund identity changed');
  return result;
}

export async function fetchSettledLiveFullRefund(
  config: LiveBillingConfig,
  facts: LiveRefundFacts,
  refundId: string,
  fetchImpl: typeof fetch = fetch
) {
  const refund = await fetchLiveRefund(config, facts, refundId, fetchImpl);
  if (refund.id !== refundId || refund.status !== 'processed')
    throw new Error('Live refund has not settled');
  const payment = await request(
    config,
    `/payments/${facts.paymentId}`,
    {},
    fetchImpl
  );
  if (
    !record(payment) ||
    payment.id !== facts.paymentId ||
    payment.order_id !== facts.orderId ||
    payment.amount !== facts.amountMinor ||
    payment.currency !== 'INR' ||
    payment.status !== 'refunded' ||
    payment.amount_refunded !== facts.amountMinor
  )
    throw new Error('Original Live payment is not fully refunded');
  return refund;
}
