import 'server-only';

import { createHash } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

export type RazorpayProviderMode = 'test' | 'live';

export const RAZORPAY_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const RAZORPAY_OAUTH_REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const RAZORPAY_OAUTH_REFRESH_TTL_MS = 180 * 24 * 60 * 60 * 1000;
export const RAZORPAY_READINESS_FRESHNESS_MS = 24 * 60 * 60 * 1000;
export const RAZORPAY_REFRESH_LEASE_SECONDS = 120;
export const RAZORPAY_REQUEST_TIMEOUT_MS = 30_000;
export const RAZORPAY_BROWSER_ERROR_MAX_LENGTH = 2_000;

interface RazorpayEnv {
  [key: string]: string | undefined;
  RAZORPAY_MODE?: string;
  RAZORPAY_OAUTH_ENABLED?: string;
  RAZORPAY_OAUTH_CLIENT_ID?: string;
  RAZORPAY_OAUTH_CLIENT_SECRET?: string;
  RAZORPAY_OAUTH_REDIRECT_URI?: string;
  RAZORPAY_WEBHOOK_SECRET_CURRENT?: string;
}

export interface RazorpayOAuthConfig {
  clientId: string;
  clientSecret: string;
  clientIdFingerprint: string;
  mode: RazorpayProviderMode;
  redirectUri: string;
}

export function isRazorpayOAuthEnabled(
  env: RazorpayEnv = process.env
): boolean {
  return env.RAZORPAY_OAUTH_ENABLED === 'true';
}

export function getRazorpayProviderMode(
  env: RazorpayEnv = process.env
): RazorpayProviderMode {
  const mode = env.RAZORPAY_MODE;
  if (mode !== 'test' && mode !== 'live') {
    throw new Error('RAZORPAY_MODE must be set to test or live');
  }
  return mode;
}

export function assertRazorpayProviderMode(
  storedMode: unknown,
  expectedMode: RazorpayProviderMode
): asserts storedMode is RazorpayProviderMode {
  if (storedMode !== expectedMode) {
    throw new Error('Razorpay credential mode does not match this deployment');
  }
}

export function assertRazorpayApplicationWebhookConfigured(
  env: RazorpayEnv = process.env
): void {
  if (!env.RAZORPAY_WEBHOOK_SECRET_CURRENT?.trim()) {
    throw new Error('Razorpay application webhook is not configured');
  }
}

export type RazorpayLiveMerchantAuthorization = 'bound' | 'enrollment';

export interface RazorpayLiveRolloutAuthorization {
  accountId: string;
  enabled: boolean;
  firstBindEnabled: boolean;
  merchantId: string | null;
  credentialMerchantId: string | null;
}

interface RazorpayLiveRolloutRow {
  account_id: string;
  enabled: boolean;
  first_bind_enabled: boolean;
  merchant_id: string | null;
}

export async function loadRazorpayLiveRolloutAuthorization(
  admin: SupabaseClient,
  accountId: string,
  env: RazorpayEnv = process.env
): Promise<RazorpayLiveRolloutAuthorization> {
  if (getRazorpayProviderMode(env) !== 'live') {
    return {
      accountId,
      enabled: true,
      firstBindEnabled: false,
      merchantId: null,
      credentialMerchantId: null,
    };
  }

  const { data, error } = await admin
    .from('razorpay_live_rollout_accounts')
    .select('account_id, enabled, first_bind_enabled, merchant_id')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    throw new Error(`load Razorpay Live rollout account: ${error.message}`);
  }
  const row = data as RazorpayLiveRolloutRow | null;
  if (!row || row.account_id !== accountId || !row.enabled) {
    throw new Error('Razorpay Live OAuth is not enabled for this account');
  }
  if (row.merchant_id && !/^acc_[A-Za-z0-9]+$/.test(row.merchant_id)) {
    throw new Error('Razorpay Live rollout merchant identity is invalid');
  }
  const { data: credentialData, error: credentialError } = await admin
    .from('account_payment_credentials')
    .select('razorpay_account_id')
    .eq('account_id', accountId)
    .eq('gateway', 'razorpay')
    .eq('provider_mode', 'live')
    .maybeSingle();
  if (credentialError) {
    throw new Error(
      `load Razorpay Live credential binding: ${credentialError.message}`
    );
  }
  const credentialMerchantId =
    (credentialData as { razorpay_account_id: string | null } | null)
      ?.razorpay_account_id ?? null;
  if (
    credentialMerchantId &&
    (!/^acc_[A-Za-z0-9]+$/.test(credentialMerchantId) ||
      credentialMerchantId !== row.merchant_id)
  ) {
    throw new Error('Razorpay Live rollout credential binding is inconsistent');
  }
  return {
    accountId: row.account_id,
    enabled: row.enabled,
    firstBindEnabled: row.first_bind_enabled,
    merchantId: row.merchant_id,
    credentialMerchantId,
  };
}

/**
 * A Live grant must match the server-owned account binding. An explicitly
 * enabled, unbound rollout account may atomically adopt its first
 * provider-issued merchant identity.
 */
export function authorizeRazorpayLiveRolloutMerchant(
  externalAccountId: string,
  rollout: RazorpayLiveRolloutAuthorization,
  env: RazorpayEnv = process.env
): RazorpayLiveMerchantAuthorization {
  if (!/^acc_[A-Za-z0-9]+$/.test(externalAccountId)) {
    throw new Error('Razorpay Live merchant identity is invalid');
  }
  if (getRazorpayProviderMode(env) !== 'live') return 'bound';
  if (!rollout.enabled) {
    throw new Error('Razorpay Live OAuth is not enabled for this account');
  }
  if (
    rollout.credentialMerchantId &&
    rollout.credentialMerchantId !== rollout.merchantId
  ) {
    throw new Error('Razorpay Live rollout credential binding is inconsistent');
  }
  if (rollout.merchantId === externalAccountId) {
    return rollout.credentialMerchantId === externalAccountId
      ? 'bound'
      : 'enrollment';
  }
  if (!rollout.merchantId && rollout.firstBindEnabled) return 'enrollment';
  throw new Error('Razorpay Live merchant is not enabled for this account');
}

export async function claimRazorpayLiveRolloutMerchant(
  admin: SupabaseClient,
  rollout: RazorpayLiveRolloutAuthorization,
  externalAccountId: string,
  env: RazorpayEnv = process.env
): Promise<RazorpayLiveMerchantAuthorization> {
  const authorization = authorizeRazorpayLiveRolloutMerchant(
    externalAccountId,
    rollout,
    env
  );
  if (
    getRazorpayProviderMode(env) !== 'live' ||
    authorization !== 'enrollment'
  ) {
    return authorization;
  }

  const { data, error } = await admin.rpc(
    'claim_razorpay_live_rollout_merchant',
    {
      p_account_id: rollout.accountId,
      p_merchant_id: externalAccountId,
    }
  );
  if (error) {
    throw new Error(`claim Razorpay Live rollout merchant: ${error.message}`);
  }
  if (data !== true) {
    throw new Error('Razorpay Live rollout merchant could not be claimed');
  }
  return authorization;
}

export function getRazorpayOAuthConfig(
  env: RazorpayEnv = process.env,
  options: { allowDisabled?: boolean } = {}
): RazorpayOAuthConfig {
  // Revocation must remain possible after an emergency kill-switch disables
  // new OAuth work; all other callers require the rollout flag.
  if (!options.allowDisabled && !isRazorpayOAuthEnabled(env)) {
    throw new Error('Razorpay OAuth is not enabled in this environment');
  }

  const clientId = env.RAZORPAY_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.RAZORPAY_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = env.RAZORPAY_OAUTH_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Razorpay OAuth client configuration is incomplete');
  }

  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new Error('RAZORPAY_OAUTH_REDIRECT_URI must be an absolute URL');
  }
  const localHttp =
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
  if (parsed.protocol !== 'https:' && !localHttp) {
    throw new Error('Razorpay OAuth redirect URI must use HTTPS');
  }

  return {
    clientId,
    clientSecret,
    clientIdFingerprint: createHash('sha256').update(clientId).digest('hex'),
    mode: getRazorpayProviderMode(env),
    redirectUri: parsed.toString(),
  };
}
