/**
 * Razorpay REST client — SERVER-ONLY (uses per-gym OAuth grants).
 *
 * Model 1 (multi-tenant, migration 059): each gym connects THEIR OWN
 * Razorpay account, so money flows member → gym's Razorpay → gym's bank
 * and UsefulDesk never touches it. Every call is parameterised by the gym's
 * rotating OAuth Bearer grant; there is no global Razorpay instance.
 *
 * No SDK dependency: the REST surface we need (customers, plans,
 * subscriptions) is small, so a typed fetch boundary is cleaner than an SDK
 * instance per gym. Webhook signatures verify with node:crypto.
 *
 * NEVER import this into a client component — it would bundle the secret
 * key path. It is consumed only by API route handlers.
 */

import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { RAZORPAY_REQUEST_TIMEOUT_MS } from './razorpay-config';

const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1';

export interface RazorpayAuthentication {
  mode: 'oauth';
  accessToken: string;
}

export class RazorpayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown
  ) {
    super(message);
    this.name = 'RazorpayError';
  }
}

/** Rupees → paise (Razorpay works in the smallest currency unit). */
export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/** Paise → rupees. */
export function toRupees(paise: number): number {
  return paise / 100;
}

function authHeader(auth: RazorpayAuthentication): string {
  return `Bearer ${auth.accessToken}`;
}

/**
 * Low-level authenticated call to the gym's Razorpay account. Throws
 * `RazorpayError` on a non-2xx so callers get the gateway's error body
 * (Razorpay returns `{ error: { description } }`).
 */
export async function razorpayFetch<T = unknown>(
  creds: RazorpayAuthentication,
  path: string,
  init?: {
    method?: string;
    body?: unknown;
    bodyText?: string;
    headers?: Record<string, string>;
  }
): Promise<T> {
  if (init?.body !== undefined && init.bodyText !== undefined) {
    throw new Error('Razorpay request cannot provide body and bodyText');
  }
  const res = await fetch(`${RAZORPAY_API_BASE}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: authHeader(creds),
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    body:
      init?.bodyText ??
      (init?.body !== undefined ? JSON.stringify(init.body) : undefined),
    // Never cache authenticated gateway responses.
    cache: 'no-store',
    signal: AbortSignal.timeout(RAZORPAY_REQUEST_TIMEOUT_MS),
  });

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    json = text;
  }

  if (!res.ok) {
    const description =
      (json as { error?: { description?: string } } | null)?.error
        ?.description ?? `Razorpay request failed (${res.status})`;
    throw new RazorpayError(description, res.status, json);
  }
  return json as T;
}

// ---- typed entities (only the fields we consume) ------------------

export interface RazorpayCustomer {
  id: string;
  entity: 'customer';
  name?: string;
  contact?: string;
  email?: string;
}

export interface RazorpayPlan {
  id: string;
  entity: 'plan';
  period: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  item: { amount: number; currency: string; name: string };
}

export interface RazorpaySubscription {
  id: string;
  entity: 'subscription';
  plan_id: string;
  customer_id?: string;
  status:
    | 'created'
    | 'authenticated'
    | 'active'
    | 'pending'
    | 'halted'
    | 'cancelled'
    | 'completed'
    | 'expired';
  /** The hosted UPI-mandate auth page the member approves. */
  short_url?: string;
  /** The reusable mandate token, present once authenticated. */
  token_id?: string;
  current_start?: number;
  current_end?: number;
  paid_count?: number;
  remaining_count?: number;
  total_count?: number;
}

export interface RazorpaySubscriptionInvoice {
  id: string;
  entity: 'invoice';
  subscription_id: string;
  payment_id?: string | null;
  status: string;
  amount: number;
  amount_paid: number;
  currency: string;
  paid_at?: number | null;
  billing_start?: number | null;
  billing_end?: number | null;
}

export interface RazorpaySubscriptionInvoiceCollection {
  entity: 'collection';
  count: number;
  items: RazorpaySubscriptionInvoice[];
}

export interface RazorpayPaymentLink {
  id: string;
  entity: 'payment_link';
  amount: number;
  amount_paid: number;
  currency: string;
  accept_partial: boolean;
  reference_id: string;
  short_url: string;
  status: 'created' | 'partially_paid' | 'paid' | 'cancelled' | 'expired';
  expire_by: number;
  notes?: Record<string, string>;
  payments?: Array<{
    payment_id: string;
    amount: number;
    status: string;
    method?: string;
  }> | null;
}

export interface RazorpayPayment {
  id: string;
  entity: 'payment';
  amount: number;
  currency: string;
  status: string;
  method?: string;
  captured?: boolean;
  payment_link_id?: string;
  notes?: Record<string, string>;
  created_at?: number;
  amount_refunded?: number;
  refund_status?: 'null' | 'partial' | 'full' | null;
}

export interface RazorpayRefund {
  id: string;
  entity: 'refund';
  amount: number;
  currency: string;
  payment_id: string;
  receipt?: string | null;
  notes?: Record<string, string>;
  status: 'pending' | 'processed' | 'failed';
  created_at: number;
  speed_requested?: string;
  speed_processed?: string;
}

// ---- higher-level flows -------------------------------------------

export async function createCustomer(
  creds: RazorpayAuthentication,
  input: { name?: string; contact?: string; email?: string }
): Promise<RazorpayCustomer> {
  return razorpayFetch<RazorpayCustomer>(creds, '/customers', {
    method: 'POST',
    // fail_existing:0 → return the existing customer instead of erroring
    // when this contact was already created (idempotent onboarding).
    body: { ...input, fail_existing: 0 },
  });
}

/**
 * Create a recurring plan for one membership cadence. `amountRupees` is
 * the per-cycle fee; `period`/`interval` come from the membership plan's
 * duration (monthly = period 'monthly' interval 1, quarterly = interval 3).
 */
export async function createPlan(
  creds: RazorpayAuthentication,
  input: {
    amountRupees: number;
    currency?: string;
    name: string;
    period: RazorpayPlan['period'];
    interval: number;
  }
): Promise<RazorpayPlan> {
  return razorpayFetch<RazorpayPlan>(creds, '/plans', {
    method: 'POST',
    body: {
      period: input.period,
      interval: input.interval,
      item: {
        name: input.name,
        amount: toPaise(input.amountRupees),
        currency: input.currency ?? 'INR',
      },
    },
  });
}

/**
 * Create a subscription against a plan. The returned `short_url` is the
 * UPI-AutoPay mandate authorisation link/QR the gym shows the member;
 * once approved Razorpay fires `subscription.authenticated` then charges
 * on each cycle (`subscription.charged`).
 *
 * `totalCount` bounds how many cycles the mandate authorises. Razorpay
 * requires the member's first charge to carry AFA (handled on its hosted
 * page), satisfying the RBI first-transaction rule.
 */
export async function createSubscription(
  creds: RazorpayAuthentication,
  input: {
    planId: string;
    customerId?: string;
    totalCount: number;
    notes?: Record<string, string>;
  }
): Promise<RazorpaySubscription> {
  // Razorpay derives the per-debit ceiling from the plan amount for a
  // subscription mandate; there is no separate max-amount field here.
  return razorpayFetch<RazorpaySubscription>(creds, '/subscriptions', {
    method: 'POST',
    body: {
      plan_id: input.planId,
      customer_id: input.customerId,
      total_count: input.totalCount,
      customer_notify: 1,
      notes: input.notes,
    },
  });
}

export async function fetchSubscription(
  creds: RazorpayAuthentication,
  subscriptionId: string
): Promise<RazorpaySubscription> {
  return razorpayFetch<RazorpaySubscription>(
    creds,
    `/subscriptions/${subscriptionId}`
  );
}

export async function fetchSubscriptionInvoices(
  creds: RazorpayAuthentication,
  subscriptionId: string
): Promise<RazorpaySubscriptionInvoiceCollection> {
  return razorpayFetch<RazorpaySubscriptionInvoiceCollection>(
    creds,
    `/invoices?subscription_id=${encodeURIComponent(subscriptionId)}`
  );
}

export async function cancelSubscription(
  creds: RazorpayAuthentication,
  subscriptionId: string,
  cancelAtCycleEnd = false
): Promise<RazorpaySubscription> {
  return razorpayFetch<RazorpaySubscription>(
    creds,
    `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
    {
      method: 'POST',
      // Razorpay's immediate-cancel contract is the body-less default. The
      // official SDK sends cancel_at_cycle_end only for a scheduled cancel;
      // sending 0 is not equivalent across every provider deployment.
      ...(cancelAtCycleEnd ? { body: { cancel_at_cycle_end: 1 } } : {}),
    }
  );
}

export async function createPaymentLink(
  creds: RazorpayAuthentication,
  input: {
    amountSubunits: number;
    currency: 'INR';
    expireBy: number;
    referenceId: string;
    description: string;
    customer?: { name?: string; contact?: string; email?: string };
    notes: Record<string, string>;
  }
): Promise<RazorpayPaymentLink> {
  return razorpayFetch<RazorpayPaymentLink>(creds, '/payment_links', {
    method: 'POST',
    body: {
      amount: input.amountSubunits,
      currency: input.currency,
      accept_partial: false,
      expire_by: input.expireBy,
      reference_id: input.referenceId,
      description: input.description,
      customer: input.customer,
      notify: { sms: false, email: false },
      reminder_enable: false,
      notes: input.notes,
    },
  });
}

export async function fetchPaymentLink(
  creds: RazorpayAuthentication,
  paymentLinkId: string
): Promise<RazorpayPaymentLink> {
  return razorpayFetch<RazorpayPaymentLink>(
    creds,
    `/payment_links/${encodeURIComponent(paymentLinkId)}`
  );
}

export async function listPaymentLinksByReference(
  creds: RazorpayAuthentication,
  referenceId: string
): Promise<RazorpayPaymentLink[]> {
  const result = await razorpayFetch<{ payment_links?: RazorpayPaymentLink[] }>(
    creds,
    `/payment_links?reference_id=${encodeURIComponent(referenceId)}&count=10`
  );
  return Array.isArray(result.payment_links) ? result.payment_links : [];
}

export async function cancelPaymentLink(
  creds: RazorpayAuthentication,
  paymentLinkId: string
): Promise<RazorpayPaymentLink> {
  return razorpayFetch<RazorpayPaymentLink>(
    creds,
    `/payment_links/${encodeURIComponent(paymentLinkId)}/cancel`,
    { method: 'POST' }
  );
}

export async function fetchPayment(
  creds: RazorpayAuthentication,
  paymentId: string
): Promise<RazorpayPayment> {
  return razorpayFetch<RazorpayPayment>(
    creds,
    `/payments/${encodeURIComponent(paymentId)}`
  );
}

export async function listPayments(input: {
  creds: RazorpayAuthentication;
  from: number;
  to?: number;
  count: number;
  skip: number;
}): Promise<RazorpayPayment[]> {
  const query = new URLSearchParams({
    from: String(input.from),
    count: String(input.count),
    skip: String(input.skip),
  });
  if (input.to !== undefined) query.set('to', String(input.to));
  const result = await razorpayFetch<{ items?: RazorpayPayment[] }>(
    input.creds,
    `/payments?${query.toString()}`
  );
  return Array.isArray(result.items) ? result.items : [];
}

export async function createRefund(input: {
  creds: RazorpayAuthentication;
  paymentId: string;
  idempotencyKey: string;
  canonicalBody: string;
}): Promise<RazorpayRefund> {
  if (!/^[A-Za-z0-9_-]{10,}$/.test(input.idempotencyKey)) {
    throw new Error('Razorpay refund idempotency key is invalid');
  }
  return razorpayFetch<RazorpayRefund>(
    input.creds,
    `/payments/${encodeURIComponent(input.paymentId)}/refund`,
    {
      method: 'POST',
      bodyText: input.canonicalBody,
      headers: { 'X-Refund-Idempotency': input.idempotencyKey },
    }
  );
}

export async function fetchRefund(
  creds: RazorpayAuthentication,
  refundId: string
): Promise<RazorpayRefund> {
  return razorpayFetch<RazorpayRefund>(
    creds,
    `/refunds/${encodeURIComponent(refundId)}`
  );
}

export async function listRefunds(input: {
  creds: RazorpayAuthentication;
  from: number;
  to?: number;
  count: number;
  skip: number;
}): Promise<RazorpayRefund[]> {
  const query = new URLSearchParams({
    from: String(input.from),
    count: String(input.count),
    skip: String(input.skip),
  });
  if (input.to !== undefined) query.set('to', String(input.to));
  const result = await razorpayFetch<{ items?: RazorpayRefund[] }>(
    input.creds,
    `/refunds?${query.toString()}`
  );
  return Array.isArray(result.items) ? result.items : [];
}

export async function listPaymentRefunds(input: {
  creds: RazorpayAuthentication;
  paymentId: string;
  count: number;
  skip: number;
}): Promise<RazorpayRefund[]> {
  const query = new URLSearchParams({
    count: String(input.count),
    skip: String(input.skip),
  });
  const result = await razorpayFetch<{ items?: RazorpayRefund[] }>(
    input.creds,
    `/payments/${encodeURIComponent(input.paymentId)}/refunds?${query.toString()}`
  );
  return Array.isArray(result.items) ? result.items : [];
}

// ---- webhook signature verification -------------------------------

/**
 * Verify a Razorpay webhook payload against the gym's webhook secret.
 * Razorpay signs the RAW request body with HMAC-SHA256 and sends the hex
 * digest in `X-Razorpay-Signature`. Compare in constant time. MUST run
 * before any DB write in the webhook route.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  // timingSafeEqual throws on length mismatch — guard first.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Map a Razorpay subscription status onto our mandate status
 * (payment_mandates.status). Unknown states park as 'pending'.
 */
export function mandateStatusFromSubscription(
  status: RazorpaySubscription['status']
): 'pending' | 'active' | 'paused' | 'revoked' | 'expired' | 'failed' {
  switch (status) {
    case 'authenticated':
    case 'active':
      return 'active';
    case 'halted':
    case 'pending':
      return 'failed';
    case 'cancelled':
      return 'revoked';
    case 'completed':
    case 'expired':
      return 'expired';
    case 'created':
    default:
      return 'pending';
  }
}
