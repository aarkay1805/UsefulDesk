/**
 * Per-gym payment-gateway credentials (migration 059) — SERVER-ONLY.
 *
 * Reads `account_payment_credentials` via the service-role client so the
 * webhook + mandate routes can reach a gym's Razorpay keys. The row is
 * admin-only under RLS; the service role bypasses RLS, so callers MUST
 * already have scoped the request to the right account_id themselves.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AccountGatewayConfig,
  RazorpayCredentials,
} from "./razorpay";

/** Fetch a gym's stored gateway config, or null if it never connected. */
export async function getAccountGatewayConfig(
  admin: SupabaseClient,
  accountId: string,
): Promise<AccountGatewayConfig | null> {
  const { data } = await admin
    .from("account_payment_credentials")
    .select("razorpay_key_id, razorpay_webhook_secret")
    .eq("account_id", accountId)
    .maybeSingle();

  if (!data) return null;
  return {
    keyId: (data.razorpay_key_id as string | null) ?? null,
    // The secret key is never selected here — it must not travel further
    // than the API-credential helper below (least exposure).
    keySecret: null,
    webhookSecret: (data.razorpay_webhook_secret as string | null) ?? null,
  };
}

/**
 * Fetch the FULL API credentials (key id + secret) for server calls to
 * the gym's Razorpay account. Returns null unless BOTH are present.
 * Kept separate from getAccountGatewayConfig so most call-sites read the
 * public bits without ever materialising the secret.
 */
export async function getRazorpayCredentials(
  admin: SupabaseClient,
  accountId: string,
): Promise<RazorpayCredentials | null> {
  const { data } = await admin
    .from("account_payment_credentials")
    .select("razorpay_key_id, razorpay_key_secret")
    .eq("account_id", accountId)
    .maybeSingle();

  const keyId = data?.razorpay_key_id as string | null | undefined;
  const keySecret = data?.razorpay_key_secret as string | null | undefined;
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret };
}

/** The gym's webhook signing secret, or null. */
export async function getWebhookSecret(
  admin: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("account_payment_credentials")
    .select("razorpay_webhook_secret")
    .eq("account_id", accountId)
    .maybeSingle();
  return (data?.razorpay_webhook_secret as string | null) ?? null;
}
