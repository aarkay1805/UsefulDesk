import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

const API_BASE = 'https://api.razorpay.com/v1';
const PROVIDER_TIMEOUT_MS = 15_000;

export interface TestBillingConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  merchantId: string;
}

export function testBillingEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    env.NODE_ENV !== 'production' &&
    env.USEFULDESK_SUBSCRIPTION_INTENTS_ENABLED === 'true' &&
    env.USEFULDESK_SAAS_RAZORPAY_MODE === 'test'
  );
}

/** Separate Usefulmade Test credentials; gym OAuth grants never enter this path. */
export function testBillingConfig(
  env: NodeJS.ProcessEnv = process.env
): TestBillingConfig {
  if (!testBillingEnabled(env))
    throw new Error('Test subscription billing is disabled');
  const keyId = env.USEFULDESK_SAAS_RAZORPAY_TEST_KEY_ID?.trim();
  const keySecret = env.USEFULDESK_SAAS_RAZORPAY_TEST_KEY_SECRET?.trim();
  const webhookSecret =
    env.USEFULDESK_SAAS_RAZORPAY_TEST_WEBHOOK_SECRET?.trim();
  const merchantId = env.USEFULDESK_SAAS_RAZORPAY_TEST_MERCHANT_ID?.trim();
  if (
    !keyId?.startsWith('rzp_test_') ||
    !keySecret ||
    !webhookSecret ||
    !merchantId?.startsWith('acc_')
  ) {
    throw new Error('Usefulmade Test merchant configuration is incomplete');
  }
  return { keyId, keySecret, webhookSecret, merchantId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function matchesHmac(
  payload: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const actual = Buffer.from(signature, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function verifyTestCheckoutSignature(
  orderId: string,
  paymentId: string,
  signature: string | null,
  config: TestBillingConfig
): boolean {
  return matchesHmac(`${orderId}|${paymentId}`, signature, config.keySecret);
}

export function verifyTestWebhookSignature(
  rawBody: string,
  signature: string | null,
  config: TestBillingConfig
): boolean {
  return matchesHmac(rawBody, signature, config.webhookSecret);
}

async function providerRequest(
  config: TestBillingConfig,
  path: string,
  init: { method?: string; body?: unknown } = {},
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
      `Usefulmade Test provider request failed (${response.status})`
    );
  return response.json() as Promise<unknown>;
}

export interface VerifiedTestOrder {
  id: string;
  amount: number;
  currency: 'INR';
  receipt: string;
}

function verifyOrder(
  value: unknown,
  expected: {
    receipt: string;
    amount: number;
  }
): VerifiedTestOrder {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !/^order_[A-Za-z0-9]+$/.test(value.id) ||
    value.amount !== expected.amount ||
    value.currency !== 'INR' ||
    value.receipt !== expected.receipt ||
    !['created', 'attempted', 'paid'].includes(String(value.status))
  ) {
    throw new Error('Usefulmade Test order does not match the plan intent');
  }
  return {
    id: value.id,
    amount: expected.amount,
    currency: 'INR',
    receipt: expected.receipt,
  };
}

export async function createTestOrder(
  config: TestBillingConfig,
  input: { requestId: string; organizationId: string; amountMinor: number },
  fetchImpl: typeof fetch = fetch
): Promise<VerifiedTestOrder> {
  const result = await providerRequest(
    config,
    '/orders',
    {
      method: 'POST',
      body: {
        amount: input.amountMinor,
        currency: 'INR',
        receipt: input.requestId,
        partial_payment: false,
        notes: {
          usefuldesk_organization_id: input.organizationId,
          usefuldesk_request_id: input.requestId,
        },
      },
    },
    fetchImpl
  );
  return verifyOrder(result, {
    receipt: input.requestId,
    amount: input.amountMinor,
  });
}

export async function fetchTestOrder(
  config: TestBillingConfig,
  input: { orderId: string; requestId: string; amountMinor: number },
  fetchImpl: typeof fetch = fetch
): Promise<VerifiedTestOrder> {
  if (!/^order_[A-Za-z0-9]+$/.test(input.orderId))
    throw new Error('Invalid Test order ID');
  const result = await providerRequest(
    config,
    `/orders/${input.orderId}`,
    {},
    fetchImpl
  );
  const order = verifyOrder(result, {
    receipt: input.requestId,
    amount: input.amountMinor,
  });
  if (order.id !== input.orderId)
    throw new Error('Test order identity changed');
  return order;
}

export interface CapturedTestPayment {
  id: string;
  orderId: string;
  amountMinor: number;
  currency: 'INR';
}

export async function fetchCapturedTestPayment(
  config: TestBillingConfig,
  input: { paymentId: string; orderId: string; amountMinor: number },
  fetchImpl: typeof fetch = fetch
): Promise<CapturedTestPayment> {
  if (!/^pay_[A-Za-z0-9]+$/.test(input.paymentId))
    throw new Error('Invalid Test payment ID');
  const result = await providerRequest(
    config,
    `/payments/${input.paymentId}`,
    {},
    fetchImpl
  );
  if (
    !isRecord(result) ||
    result.id !== input.paymentId ||
    result.order_id !== input.orderId ||
    result.amount !== input.amountMinor ||
    result.currency !== 'INR' ||
    result.status !== 'captured' ||
    result.captured !== true ||
    result.amount_refunded !== 0
  ) {
    throw new Error(
      'Usefulmade Test payment is not a matching captured payment'
    );
  }
  return {
    id: input.paymentId,
    orderId: input.orderId,
    amountMinor: input.amountMinor,
    currency: 'INR',
  };
}
