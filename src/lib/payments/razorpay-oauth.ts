import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { encryptPaymentSecret, decryptPaymentSecret } from './payment-secrets';
import {
  RAZORPAY_BROWSER_ERROR_MAX_LENGTH,
  RAZORPAY_OAUTH_REFRESH_TTL_MS,
  RAZORPAY_OAUTH_STATE_TTL_MS,
  RAZORPAY_REQUEST_TIMEOUT_MS,
  type RazorpayOAuthConfig,
  type RazorpayProviderMode,
} from './razorpay-config';

const RAZORPAY_AUTHORIZE_URL = 'https://auth.razorpay.com/authorize';
const RAZORPAY_TOKEN_URL = 'https://auth.razorpay.com/token';
const RAZORPAY_REVOKE_URL = 'https://auth.razorpay.com/revoke';
const RAZORPAY_API_BASE = 'https://api.razorpay.com';

export interface RazorpayOAuthTokenSet {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  accountId: string;
  scope: string;
  mode: RazorpayProviderMode;
}

export interface RazorpayOAuthStateRow {
  id: string;
  account_id: string;
  initiated_by: string;
  client_id_fingerprint: string;
  mode: RazorpayProviderMode;
  redirect_uri: string;
  pkce_code_verifier: string;
  expires_at: string;
  consumed_at: string | null;
}

export interface RazorpayReadiness {
  ready: boolean;
  merchantStatus:
    | 'unknown'
    | 'activated'
    | 'under_review'
    | 'needs_clarification'
    | 'suspended'
    | 'rejected';
  activationVerifiedAt: string | null;
  lastError: string | null;
}

type FetchLike = typeof fetch;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function base64Url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

export function createRazorpayOAuthAttempt(input: {
  accountId: string;
  initiatedBy: string;
  config: RazorpayOAuthConfig;
  now?: Date;
  random?: (size: number) => Buffer;
}) {
  const now = input.now ?? new Date();
  const random = input.random ?? randomBytes;
  const state = base64Url(random(32));
  const codeVerifier = base64Url(random(64));
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  return {
    state,
    codeVerifier,
    codeChallenge,
    row: {
      state_hash: sha256(state),
      account_id: input.accountId,
      initiated_by: input.initiatedBy,
      client_id_fingerprint: input.config.clientIdFingerprint,
      mode: input.config.mode,
      redirect_uri: input.config.redirectUri,
      pkce_code_verifier: encryptPaymentSecret(codeVerifier),
      expires_at: new Date(
        now.getTime() + RAZORPAY_OAUTH_STATE_TTL_MS
      ).toISOString(),
      created_at: now.toISOString(),
    },
  };
}

export function buildRazorpayAuthorizationUrl(input: {
  config: RazorpayOAuthConfig;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(RAZORPAY_AUTHORIZE_URL);
  url.searchParams.set('client_id', input.config.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', input.config.redirectUri);
  url.searchParams.set('scope', 'read_write');
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export async function peekRazorpayOAuthStateAccount(
  admin: SupabaseClient,
  rawState: string,
  initiatedBy: string,
  config: RazorpayOAuthConfig,
  now = new Date()
): Promise<string | null> {
  const { data, error } = await admin
    .from('razorpay_oauth_states')
    .select('account_id')
    .eq('state_hash', sha256(rawState))
    .eq('initiated_by', initiatedBy)
    .eq('client_id_fingerprint', config.clientIdFingerprint)
    .eq('mode', config.mode)
    .eq('redirect_uri', config.redirectUri)
    .is('consumed_at', null)
    .gt('expires_at', now.toISOString())
    .maybeSingle();
  if (error) throw new Error(`load Razorpay OAuth state: ${error.message}`);
  return (data?.account_id as string | undefined) ?? null;
}

export async function consumeRazorpayOAuthState(
  admin: SupabaseClient,
  rawState: string,
  accountId: string,
  initiatedBy: string,
  config: RazorpayOAuthConfig,
  now = new Date()
): Promise<RazorpayOAuthStateRow | null> {
  const { data, error } = await admin
    .from('razorpay_oauth_states')
    .update({ consumed_at: now.toISOString() })
    .eq('state_hash', sha256(rawState))
    .eq('account_id', accountId)
    .eq('initiated_by', initiatedBy)
    .eq('client_id_fingerprint', config.clientIdFingerprint)
    .eq('mode', config.mode)
    .eq('redirect_uri', config.redirectUri)
    .is('consumed_at', null)
    .gt('expires_at', now.toISOString())
    .select(
      'id, account_id, initiated_by, client_id_fingerprint, mode, redirect_uri, pkce_code_verifier, expires_at, consumed_at'
    )
    .maybeSingle();
  if (error) throw new Error(`consume Razorpay OAuth state: ${error.message}`);
  return (data as RazorpayOAuthStateRow | null) ?? null;
}

export function validateConsumedOAuthState(
  row: RazorpayOAuthStateRow,
  expected: {
    accountId: string;
    initiatedBy: string;
    config: RazorpayOAuthConfig;
    now?: Date;
  }
): void {
  const now = expected.now ?? new Date();
  if (
    row.account_id !== expected.accountId ||
    row.initiated_by !== expected.initiatedBy ||
    row.client_id_fingerprint !== expected.config.clientIdFingerprint ||
    row.mode !== expected.config.mode ||
    row.redirect_uri !== expected.config.redirectUri ||
    !row.consumed_at ||
    new Date(row.expires_at).getTime() <= now.getTime()
  ) {
    throw new Error('Razorpay OAuth state binding is invalid');
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const [, payload] = token.split('.');
  if (!payload) return null;
  try {
    return JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeScope(payload: Record<string, unknown>): string {
  if (typeof payload.scope === 'string') return payload.scope;
  const jwt =
    typeof payload.access_token === 'string'
      ? decodeJwtPayload(payload.access_token)
      : null;
  const scopes = jwt?.scopes;
  if (
    Array.isArray(scopes) &&
    scopes.every((scope) => typeof scope === 'string')
  ) {
    return scopes.join(' ');
  }
  return '';
}

export function parseRazorpayOAuthTokenResponse(
  payload: unknown,
  expectedMode: RazorpayProviderMode,
  now = new Date(),
  expectedAccountId?: string,
  expectedScope?: string
): RazorpayOAuthTokenSet {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Razorpay returned an invalid OAuth token response');
  }
  const body = payload as Record<string, unknown>;
  const accessToken =
    typeof body.access_token === 'string' ? body.access_token : '';
  const refreshToken =
    typeof body.refresh_token === 'string' ? body.refresh_token : '';
  const returnedAccountId =
    typeof body.razorpay_account_id === 'string'
      ? body.razorpay_account_id
      : '';
  const accountId = returnedAccountId || expectedAccountId || '';
  const expiresIn = Number(body.expires_in);
  // Refresh responses may omit scope; retain the merchant-bound grant instead
  // of treating an otherwise valid rotation as incomplete.
  const scope = normalizeScope(body) || expectedScope || '';
  if (
    body.token_type !== 'Bearer' ||
    !accessToken ||
    !refreshToken ||
    !accountId ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0 ||
    !scope.split(/[ ,]+/).includes('read_write')
  ) {
    throw new Error('Razorpay OAuth token response is incomplete');
  }
  if (body.mode != null && body.mode !== expectedMode) {
    throw new Error('Razorpay OAuth token mode does not match this deployment');
  }
  if (
    returnedAccountId &&
    expectedAccountId &&
    returnedAccountId !== expectedAccountId
  ) {
    throw new Error('Razorpay OAuth merchant identity changed during refresh');
  }

  return {
    accessToken,
    refreshToken,
    accessExpiresAt: new Date(now.getTime() + expiresIn * 1000),
    refreshExpiresAt: new Date(now.getTime() + RAZORPAY_OAUTH_REFRESH_TTL_MS),
    accountId,
    scope,
    mode: expectedMode,
  };
}

async function postOAuthJson(
  url: string,
  body: Record<string, string>,
  fetchImpl: FetchLike = fetch
): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(RAZORPAY_REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const description =
      (payload as { error?: { description?: string } } | null)?.error
        ?.description ?? `Razorpay OAuth request failed (${response.status})`;
    throw new Error(description);
  }
  return payload;
}

export async function exchangeRazorpayAuthorizationCode(input: {
  config: RazorpayOAuthConfig;
  code: string;
  encryptedCodeVerifier: string;
  fetchImpl?: FetchLike;
  now?: Date;
}): Promise<RazorpayOAuthTokenSet> {
  const payload = await postOAuthJson(
    RAZORPAY_TOKEN_URL,
    {
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: input.config.redirectUri,
      code: input.code,
      mode: input.config.mode,
      code_verifier: decryptPaymentSecret(input.encryptedCodeVerifier, 1, {
        allowVersionZero: false,
      }),
    },
    input.fetchImpl
  );
  return parseRazorpayOAuthTokenResponse(payload, input.config.mode, input.now);
}

export async function refreshRazorpayOAuthTokens(input: {
  config: RazorpayOAuthConfig;
  accountId: string;
  refreshToken: string;
  scope: string;
  fetchImpl?: FetchLike;
  now?: Date;
}): Promise<RazorpayOAuthTokenSet> {
  const payload = await postOAuthJson(
    RAZORPAY_TOKEN_URL,
    {
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
    },
    input.fetchImpl
  );
  return parseRazorpayOAuthTokenResponse(
    payload,
    input.config.mode,
    input.now,
    input.accountId,
    input.scope
  );
}

export async function revokeRazorpayOAuthToken(input: {
  config: RazorpayOAuthConfig;
  token: string;
  tokenType: 'access_token' | 'refresh_token';
  fetchImpl?: FetchLike;
}): Promise<void> {
  await postOAuthJson(
    RAZORPAY_REVOKE_URL,
    {
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      token_type_hint: input.tokenType,
      token: input.token,
    },
    input.fetchImpl
  );
}

function mapMerchantStatus(
  value: unknown
): RazorpayReadiness['merchantStatus'] {
  switch (value) {
    case 'activated':
    case 'instantly_activated':
    case 'activated_kyc_pending':
      return 'activated';
    case 'under_review':
      return 'under_review';
    case 'needs_clarification':
      return 'needs_clarification';
    case 'suspended':
      return 'suspended';
    case 'rejected':
      return 'rejected';
    default:
      return 'unknown';
  }
}

async function bearerGet(
  path: string,
  accessToken: string,
  fetchImpl: FetchLike
): Promise<{ response: Response; payload: unknown }> {
  const response = await fetchImpl(`${RAZORPAY_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(RAZORPAY_REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  return { response, payload };
}

export async function verifyRazorpayOAuthReadiness(input: {
  accessToken: string;
  accountId: string;
  fetchImpl?: FetchLike;
  now?: Date;
}): Promise<RazorpayReadiness> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = (input.now ?? new Date()).toISOString();
  const account = await bearerGet(
    `/v2/accounts/${encodeURIComponent(input.accountId)}`,
    input.accessToken,
    fetchImpl
  );

  if (account.response.ok) {
    const body = (account.payload ?? {}) as Record<string, unknown>;
    const merchantStatus = mapMerchantStatus(body.status);
    const livePayments = body.live ?? body.live_payments;
    const ready = merchantStatus === 'activated' && livePayments !== false;
    return {
      ready,
      merchantStatus,
      activationVerifiedAt: ready ? now : null,
      lastError: ready ? null : 'Razorpay merchant is not ready for payments',
    };
  }

  // Imported Technology Partner accounts can reject the v2 account lookup with
  // 400 even when the OAuth grant is valid. Fall back only for provider
  // responses that indicate the account-read capability is unavailable; the
  // five probes below are read-only and verify the capabilities UsefulDesk
  // actually relies on.
  if (![400, 401, 403, 404].includes(account.response.status)) {
    return {
      ready: false,
      merchantStatus: 'unknown',
      activationVerifiedAt: null,
      lastError: `Razorpay readiness check failed (${account.response.status})`,
    };
  }

  const capabilityPaths = [
    '/v1/customers?count=1',
    '/v1/plans?count=1',
    '/v1/subscriptions?count=1',
    '/v1/payment_links?count=1',
    '/v1/payments?count=1',
  ];
  const checks = await Promise.all(
    capabilityPaths.map((path) => bearerGet(path, input.accessToken, fetchImpl))
  );
  const failed = checks.find(({ response }) => !response.ok);
  if (failed) {
    return {
      ready: false,
      merchantStatus: 'unknown',
      activationVerifiedAt: null,
      lastError: `Razorpay capability check failed (${failed.response.status})`,
    };
  }
  return {
    ready: true,
    merchantStatus: 'unknown',
    activationVerifiedAt: now,
    lastError: null,
  };
}

export function boundedRazorpayError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Razorpay error';
  return message.slice(0, RAZORPAY_BROWSER_ERROR_MAX_LENGTH);
}
