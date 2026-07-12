/**
 * Razorpay REST client — SERVER-ONLY (reads per-gym secret keys).
 *
 * Model 1 (multi-tenant, migration 059): each gym connects THEIR OWN
 * Razorpay account, so money flows member → gym's Razorpay → gym's bank
 * and UsefulDesk never touches it. Every call is therefore parameterised
 * by the gym's `RazorpayCredentials` (key_id + key_secret) rather than a
 * single platform key — there is no global Razorpay instance on purpose.
 *
 * No SDK dependency: the REST surface we need (customers, plans,
 * subscriptions) is small, and per-request Basic-auth fetch is cleaner
 * than instantiating an SDK object per gym. Webhook signatures verify
 * with node:crypto.
 *
 * NEVER import this into a client component — it would bundle the secret
 * key path. It is consumed only by API route handlers.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const RAZORPAY_API_BASE = "https://api.razorpay.com/v1";

export interface RazorpayCredentials {
  keyId: string;
  keySecret: string;
}

/** A gym's stored gateway config (row from account_payment_credentials). */
export interface AccountGatewayConfig {
  keyId: string | null;
  keySecret: string | null;
  webhookSecret: string | null;
}

export class RazorpayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "RazorpayError";
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

function authHeader({ keyId, keySecret }: RazorpayCredentials): string {
  const token = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  return `Basic ${token}`;
}

/**
 * Low-level authenticated call to the gym's Razorpay account. Throws
 * `RazorpayError` on a non-2xx so callers get the gateway's error body
 * (Razorpay returns `{ error: { description } }`).
 */
export async function razorpayFetch<T = unknown>(
  creds: RazorpayCredentials,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(`${RAZORPAY_API_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: authHeader(creds),
      "Content-Type": "application/json",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    // Never cache authenticated gateway responses.
    cache: "no-store",
  });

  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : null;

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
  entity: "customer";
  name?: string;
  contact?: string;
  email?: string;
}

export interface RazorpayPlan {
  id: string;
  entity: "plan";
  period: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  item: { amount: number; currency: string; name: string };
}

export interface RazorpaySubscription {
  id: string;
  entity: "subscription";
  plan_id: string;
  customer_id?: string;
  status:
    | "created"
    | "authenticated"
    | "active"
    | "pending"
    | "halted"
    | "cancelled"
    | "completed"
    | "expired";
  /** The hosted UPI-mandate auth page the member approves. */
  short_url?: string;
  /** The reusable mandate token, present once authenticated. */
  token_id?: string;
  current_start?: number;
  current_end?: number;
}

// ---- higher-level flows -------------------------------------------

export async function createCustomer(
  creds: RazorpayCredentials,
  input: { name?: string; contact?: string; email?: string },
): Promise<RazorpayCustomer> {
  return razorpayFetch<RazorpayCustomer>(creds, "/customers", {
    method: "POST",
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
  creds: RazorpayCredentials,
  input: {
    amountRupees: number;
    currency?: string;
    name: string;
    period: RazorpayPlan["period"];
    interval: number;
  },
): Promise<RazorpayPlan> {
  return razorpayFetch<RazorpayPlan>(creds, "/plans", {
    method: "POST",
    body: {
      period: input.period,
      interval: input.interval,
      item: {
        name: input.name,
        amount: toPaise(input.amountRupees),
        currency: input.currency ?? "INR",
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
  creds: RazorpayCredentials,
  input: {
    planId: string;
    customerId?: string;
    totalCount: number;
    notes?: Record<string, string>;
  },
): Promise<RazorpaySubscription> {
  // Razorpay derives the per-debit ceiling from the plan amount for a
  // subscription mandate; there is no separate max-amount field here.
  return razorpayFetch<RazorpaySubscription>(creds, "/subscriptions", {
    method: "POST",
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
  creds: RazorpayCredentials,
  subscriptionId: string,
): Promise<RazorpaySubscription> {
  return razorpayFetch<RazorpaySubscription>(
    creds,
    `/subscriptions/${subscriptionId}`,
  );
}

export async function cancelSubscription(
  creds: RazorpayCredentials,
  subscriptionId: string,
  cancelAtCycleEnd = false,
): Promise<RazorpaySubscription> {
  return razorpayFetch<RazorpaySubscription>(
    creds,
    `/subscriptions/${subscriptionId}/cancel`,
    { method: "POST", body: { cancel_at_cycle_end: cancelAtCycleEnd ? 1 : 0 } },
  );
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
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  // timingSafeEqual throws on length mismatch — guard first.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Map a Razorpay subscription status onto our mandate status
 * (payment_mandates.status). Unknown states park as 'pending'.
 */
export function mandateStatusFromSubscription(
  status: RazorpaySubscription["status"],
): "pending" | "active" | "paused" | "revoked" | "expired" | "failed" {
  switch (status) {
    case "authenticated":
    case "active":
      return "active";
    case "halted":
    case "pending":
      return "failed";
    case "cancelled":
      return "revoked";
    case "completed":
    case "expired":
      return "expired";
    case "created":
    default:
      return "pending";
  }
}
