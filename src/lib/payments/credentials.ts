/**
 * Per-gym payment-gateway credentials (migration 059) — SERVER-ONLY.
 *
 * Reads `account_payment_credentials` via the service-role client so the
 * webhook + mandate routes can reach a gym's Razorpay keys. The row is
 * admin-only under RLS; the service role bypasses RLS, so callers MUST
 * already have scoped the request to the right account_id themselves.
 */

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RazorpayAuthentication } from './razorpay';

export interface RazorpayConnectionStatus {
  keyId: string;
  hasApiSecret: boolean;
  hasWebhookSecret: boolean;
  configured: boolean;
}

export interface RazorpayConnection {
  accountId: string;
  gateway: 'razorpay';
  authentication: RazorpayAuthentication;
}

export interface RazorpayCredentialPatch {
  keyId: string | null;
  keySecret?: string;
  webhookSecret?: string;
}

/** Return only browser-safe connection metadata; secret values never leave. */
export async function getRazorpayConnectionStatus(
  admin: SupabaseClient,
  accountId: string
): Promise<RazorpayConnectionStatus> {
  const { data, error } = await admin
    .from('account_payment_credentials')
    .select('razorpay_key_id, razorpay_key_secret, razorpay_webhook_secret')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) throw new Error(`load Razorpay connection: ${error.message}`);
  const keyId = (data?.razorpay_key_id as string | null) ?? '';
  const hasApiSecret = Boolean(data?.razorpay_key_secret);
  const hasWebhookSecret = Boolean(data?.razorpay_webhook_secret);
  return {
    keyId,
    hasApiSecret,
    hasWebhookSecret,
    configured: Boolean(keyId && hasApiSecret && hasWebhookSecret),
  };
}

/**
 * Load the account-scoped authentication used by Razorpay API operations.
 * OAuth token selection/refresh will be added here later; callers consume the
 * authentication union and do not know how the account connected.
 */
export async function getRazorpayConnection(
  admin: SupabaseClient,
  accountId: string
): Promise<RazorpayConnection | null> {
  const { data, error } = await admin
    .from('account_payment_credentials')
    .select('razorpay_key_id, razorpay_key_secret')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) throw new Error(`load Razorpay credentials: ${error.message}`);
  const keyId = data?.razorpay_key_id as string | null | undefined;
  const keySecret = data?.razorpay_key_secret as string | null | undefined;
  if (!keyId || !keySecret) return null;
  return {
    accountId,
    gateway: 'razorpay',
    authentication: { mode: 'api_key', keyId, keySecret },
  };
}

/** The gym's webhook signing secret, or null. */
export async function getWebhookSecret(
  admin: SupabaseClient,
  accountId: string
): Promise<string | null> {
  const { data, error } = await admin
    .from('account_payment_credentials')
    .select('razorpay_webhook_secret')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw new Error(`load Razorpay webhook secret: ${error.message}`);
  return (data?.razorpay_webhook_secret as string | null) ?? null;
}

/**
 * Store manual test credentials inside the server boundary. The account id is
 * supplied by authenticated server context, never accepted from the browser.
 * Omitted secret fields preserve their existing values.
 */
export async function saveManualRazorpayCredentials(
  admin: SupabaseClient,
  accountId: string,
  patch: RazorpayCredentialPatch
): Promise<RazorpayConnectionStatus> {
  const current = await getRazorpayConnectionStatus(admin, accountId);
  const row: Record<string, string | null> = {
    account_id: accountId,
    gateway: 'razorpay',
    razorpay_key_id: patch.keyId,
  };
  if (patch.keySecret) row.razorpay_key_secret = patch.keySecret;
  if (patch.webhookSecret) {
    row.razorpay_webhook_secret = patch.webhookSecret;
  }

  const { error } = await admin
    .from('account_payment_credentials')
    .upsert(row, { onConflict: 'account_id' });
  if (error) throw new Error(`save Razorpay credentials: ${error.message}`);

  return {
    keyId: patch.keyId ?? '',
    hasApiSecret: current.hasApiSecret || Boolean(patch.keySecret),
    hasWebhookSecret: current.hasWebhookSecret || Boolean(patch.webhookSecret),
    configured: Boolean(
      patch.keyId &&
      (current.hasApiSecret || patch.keySecret) &&
      (current.hasWebhookSecret || patch.webhookSecret)
    ),
  };
}
