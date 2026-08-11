import 'server-only';

import { createHash } from 'node:crypto';

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
  RAZORPAY_LIVE_PILOT_ACCOUNT_ID?: string;
  RAZORPAY_LIVE_PILOT_MERCHANT_ID?: string;
  RAZORPAY_LIVE_PILOT_ENROLLMENT_ENABLED?: string;
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

export function assertRazorpayLivePilotAccount(
  accountId: string,
  env: RazorpayEnv = process.env
): void {
  if (getRazorpayProviderMode(env) !== 'live') return;
  const pilotAccountId = env.RAZORPAY_LIVE_PILOT_ACCOUNT_ID?.trim();
  if (
    !pilotAccountId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      pilotAccountId
    )
  ) {
    throw new Error('RAZORPAY_LIVE_PILOT_ACCOUNT_ID must be configured');
  }
  if (accountId !== pilotAccountId) {
    throw new Error('Razorpay Live OAuth is not enabled for this account');
  }
}

export function assertRazorpayApplicationWebhookConfigured(
  env: RazorpayEnv = process.env
): void {
  if (!env.RAZORPAY_WEBHOOK_SECRET_CURRENT?.trim()) {
    throw new Error('Razorpay application webhook is not configured');
  }
}

export function assertRazorpayLivePilotMerchant(
  externalAccountId: string,
  env: RazorpayEnv = process.env
): void {
  authorizeRazorpayLivePilotMerchant(externalAccountId, env);
}

/** Require the already-pinned Live merchant; never admit first-bind enrollment. */
export function assertRazorpayPinnedLivePilotMerchant(
  externalAccountId: string,
  env: RazorpayEnv = process.env
): void {
  if (getRazorpayProviderMode(env) !== 'live') return;
  const merchantId = env.RAZORPAY_LIVE_PILOT_MERCHANT_ID?.trim();
  if (!merchantId || !/^acc_[A-Za-z0-9]+$/.test(merchantId)) {
    throw new Error('RAZORPAY_LIVE_PILOT_MERCHANT_ID must be configured');
  }
  if (externalAccountId !== merchantId) {
    throw new Error('Razorpay Live merchant does not match the pinned pilot');
  }
}

export type RazorpayLivePilotMerchantAuthorization = 'pinned' | 'enrollment';

/**
 * Live imports must match the operator-pinned merchant. During one explicitly
 * scoped co-branded signup window, the exact allowlisted tenant may instead
 * bind its first provider-issued merchant identity. The credential writer
 * separately requires that tenant to be unbound before accepting that result.
 */
export function authorizeRazorpayLivePilotMerchant(
  externalAccountId: string,
  env: RazorpayEnv = process.env
): RazorpayLivePilotMerchantAuthorization {
  if (!/^acc_[A-Za-z0-9]+$/.test(externalAccountId)) {
    throw new Error('Razorpay Live merchant identity is invalid');
  }
  if (getRazorpayProviderMode(env) !== 'live') return 'pinned';
  const merchantId = env.RAZORPAY_LIVE_PILOT_MERCHANT_ID?.trim();
  if (!merchantId || !/^acc_[A-Za-z0-9]+$/.test(merchantId)) {
    throw new Error('RAZORPAY_LIVE_PILOT_MERCHANT_ID must be configured');
  }
  if (externalAccountId === merchantId) return 'pinned';
  if (env.RAZORPAY_LIVE_PILOT_ENROLLMENT_ENABLED === 'true') {
    return 'enrollment';
  }
  throw new Error('Razorpay Live merchant is not enabled for this pilot');
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
