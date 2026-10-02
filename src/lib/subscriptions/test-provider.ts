import 'server-only';

import {
  isProviderRecord as isRecord,
  matchesProviderHmac as matchesHmac,
  requestSubscriptionProvider,
} from './provider-utils';

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
  return requestSubscriptionProvider('Test', config, path, init, fetchImpl);
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

/** Recover only one exact receipt; an empty/ambiguous result never authorizes another POST. */
export async function recoverTestOrder(
  config: TestBillingConfig,
  input: { requestId: string; organizationId: string; amountMinor: number },
  fetchImpl: typeof fetch = fetch
): Promise<VerifiedTestOrder | null> {
  const result = await providerRequest(
    config,
    `/orders?receipt=${encodeURIComponent(input.requestId)}&count=2`,
    {},
    fetchImpl
  );
  if (!isRecord(result) || !Array.isArray(result.items))
    throw new Error('Invalid Test order recovery response');
  if (result.items.length !== 1 || result.count !== 1) return null;
  const candidate: unknown = result.items[0];
  if (
    !isRecord(candidate) ||
    !isRecord(candidate.notes) ||
    candidate.notes.usefuldesk_organization_id !== input.organizationId ||
    candidate.notes.usefuldesk_request_id !== input.requestId
  ) {
    throw new Error(
      'Recovered Test order does not belong to this organization'
    );
  }
  return verifyOrder(candidate, {
    receipt: input.requestId,
    amount: input.amountMinor,
  });
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

/** A webhook's claimed failure alone never grants the paid-renewal grace. */
export async function fetchFailedTestPayment(
  config: TestBillingConfig,
  input: { paymentId: string; orderId: string; amountMinor: number },
  fetchImpl: typeof fetch = fetch
): Promise<void> {
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
    result.status !== 'failed' ||
    result.captured !== false ||
    result.amount_refunded !== 0
  ) {
    throw new Error('Usefulmade Test payment is not a matching failed payment');
  }
}

/** Read only. Provider payment creation time is the frozen payment timestamp. */
export async function fetchTestFirstPaymentTime(
  config: TestBillingConfig,
  input: { paymentId: string; orderId: string; amountMinor: number },
  fetchImpl: typeof fetch = fetch
): Promise<string> {
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
    result.amount_refunded !== 0 ||
    typeof result.created_at !== 'number' ||
    !Number.isSafeInteger(result.created_at) ||
    result.created_at <= 0 ||
    !Number.isFinite(new Date(result.created_at * 1000).getTime())
  ) {
    throw new Error('First Test payment facts do not match');
  }
  return new Date(result.created_at * 1000).toISOString();
}

export function testRefundsEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    testBillingEnabled(env) &&
    env.USEFULDESK_SUBSCRIPTION_REFUNDS_ENABLED === 'true'
  );
}
export interface TestRefundFacts {
  requestId: string;
  organizationId: string;
  paymentId: string;
  orderId: string;
  amountMinor: number;
}
export interface VerifiedTestRefund {
  id: string;
  status: 'pending' | 'failed' | 'processed';
}
function assertTestRefundConfig(config: TestBillingConfig) {
  if (!config.keyId.startsWith('rzp_test_'))
    throw new Error('Only Test refunds are supported');
}
function verifiedRefund(
  value: unknown,
  expected: TestRefundFacts
): VerifiedTestRefund {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !/^rfnd_[A-Za-z0-9]+$/.test(value.id) ||
    value.payment_id !== expected.paymentId ||
    value.amount !== expected.amountMinor ||
    value.currency !== 'INR' ||
    value.receipt !== expected.requestId ||
    !isRecord(value.notes) ||
    value.notes.usefuldesk_organization_id !== expected.organizationId ||
    value.notes.usefuldesk_request_id !== expected.requestId ||
    !['pending', 'failed', 'processed'].includes(String(value.status))
  ) {
    throw new Error('Test refund does not match the full first payment');
  }
  return { id: value.id, status: value.status as VerifiedTestRefund['status'] };
}
export async function createTestFullRefund(
  config: TestBillingConfig,
  facts: TestRefundFacts,
  fetchImpl: typeof fetch = fetch
): Promise<VerifiedTestRefund> {
  assertTestRefundConfig(config);
  await fetchCapturedTestPayment(config, facts, fetchImpl);
  const previous = await providerRequest(
    config,
    `/payments/${facts.paymentId}/refunds?count=2`,
    {},
    fetchImpl
  );
  if (
    !isRecord(previous) ||
    previous.count !== 0 ||
    !Array.isArray(previous.items) ||
    previous.items.length !== 0
  ) {
    throw new Error('An existing Test refund needs review');
  }
  return verifiedRefund(
    await providerRequest(
      config,
      `/payments/${facts.paymentId}/refund`,
      {
        method: 'POST',
        body: {
          amount: facts.amountMinor,
          speed: 'normal',
          receipt: facts.requestId,
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
export async function recoverTestFullRefund(
  config: TestBillingConfig,
  facts: TestRefundFacts,
  fetchImpl: typeof fetch = fetch
): Promise<VerifiedTestRefund | null> {
  assertTestRefundConfig(config);
  const result = await providerRequest(
    config,
    `/payments/${facts.paymentId}/refunds?count=2`,
    {},
    fetchImpl
  );
  if (!isRecord(result) || !Array.isArray(result.items))
    throw new Error('Invalid Test refund recovery response');
  if (result.count !== 1 || result.items.length !== 1) return null;
  return verifiedRefund(result.items[0], facts);
}
/** Fresh provider refund AND original payment prove a complete settlement. */
export async function fetchTestFullRefund(
  config: TestBillingConfig,
  facts: TestRefundFacts,
  refundId: string,
  fetchImpl: typeof fetch = fetch
): Promise<VerifiedTestRefund> {
  assertTestRefundConfig(config);
  if (!/^rfnd_[A-Za-z0-9]+$/.test(refundId))
    throw new Error('Invalid Test refund ID');
  const result = verifiedRefund(
    await providerRequest(
      config,
      `/payments/${facts.paymentId}/refunds/${refundId}`,
      {},
      fetchImpl
    ),
    facts
  );
  if (result.id !== refundId) throw new Error('Test refund identity changed');
  if (result.status === 'processed') {
    const payment = await providerRequest(
      config,
      `/payments/${facts.paymentId}`,
      {},
      fetchImpl
    );
    if (
      !isRecord(payment) ||
      payment.id !== facts.paymentId ||
      payment.order_id !== facts.orderId ||
      payment.amount !== facts.amountMinor ||
      payment.currency !== 'INR' ||
      payment.status !== 'refunded' ||
      payment.amount_refunded !== facts.amountMinor
    )
      throw new Error('Full Test refund is not settled yet');
  }
  return result;
}
