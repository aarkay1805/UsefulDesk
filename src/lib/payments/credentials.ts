/** Account-scoped Razorpay credentials — SERVER ONLY. */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { decryptPaymentSecret, encryptPaymentSecret } from './payment-secrets';
import {
  assertRazorpayProviderMode,
  getRazorpayOAuthConfig,
  getRazorpayProviderMode,
  isRazorpayManualRollbackEnabled,
  isRazorpayOAuthEnabled,
  RAZORPAY_OAUTH_REFRESH_WINDOW_MS,
  RAZORPAY_READINESS_FRESHNESS_MS,
  type RazorpayProviderMode,
} from './razorpay-config';
import {
  boundedRazorpayError,
  revokeRazorpayOAuthToken,
  type RazorpayOAuthTokenSet,
  type RazorpayReadiness,
} from './razorpay-oauth';
import { refreshStoredRazorpayOAuthConnection } from './razorpay-refresh';
import { RazorpayError, type RazorpayAuthentication } from './razorpay';

export type RazorpayConnectionStatusValue =
  | 'connecting'
  | 'ready'
  | 'blocked'
  | 'reconnect_required'
  | 'disconnecting'
  | 'disconnected';

export type RazorpayMerchantStatus = RazorpayReadiness['merchantStatus'];

export interface RazorpayConnectionStatus {
  authenticationMode: 'manual' | 'oauth' | null;
  connectionStatus: RazorpayConnectionStatusValue;
  merchantStatus: RazorpayMerchantStatus;
  providerMode: RazorpayProviderMode | null;
  merchantAccountSuffix: string | null;
  keyId: string;
  hasApiSecret: boolean;
  hasWebhookSecret: boolean;
  configured: boolean;
  connectedAt: string | null;
  disconnectedAt: string | null;
  activationVerifiedAt: string | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
  oauthEnabled: boolean;
  manualRollbackEnabled: boolean;
  canonicalWebhookIngress: 'legacy_account' | 'application';
}

export interface RazorpayConnection {
  accountId: string;
  gateway: 'razorpay';
  authenticationMode: 'manual' | 'oauth';
  authentication: RazorpayAuthentication;
  oauthAccessExpiresAt?: Date;
}

export interface RazorpayCredentialPatch {
  keyId: string | null;
  keySecret?: string;
  webhookSecret?: string;
}

interface CredentialRow {
  account_id: string;
  gateway: string;
  authentication_mode: 'manual' | 'oauth';
  razorpay_account_id: string | null;
  provider_mode: RazorpayProviderMode | null;
  secret_storage_version: number;
  razorpay_key_id: string | null;
  razorpay_key_secret: string | null;
  razorpay_webhook_secret: string | null;
  oauth_access_token: string | null;
  oauth_refresh_token: string | null;
  oauth_access_expires_at: string | null;
  oauth_refresh_expires_at: string | null;
  oauth_scope: string | null;
  connection_status: RazorpayConnectionStatusValue;
  merchant_status: RazorpayMerchantStatus;
  canonical_webhook_ingress: 'legacy_account' | 'application';
  connected_at: string | null;
  disconnected_at: string | null;
  activation_verified_at: string | null;
  last_verified_at: string | null;
  last_error: string | null;
}

const CREDENTIAL_COLUMNS =
  'account_id, gateway, authentication_mode, razorpay_account_id, provider_mode, secret_storage_version, razorpay_key_id, razorpay_key_secret, razorpay_webhook_secret, oauth_access_token, oauth_refresh_token, oauth_access_expires_at, oauth_refresh_expires_at, oauth_scope, connection_status, merchant_status, canonical_webhook_ingress, connected_at, disconnected_at, activation_verified_at, last_verified_at, last_error';

async function loadCredentialRow(
  admin: SupabaseClient,
  accountId: string
): Promise<CredentialRow | null> {
  const { data, error } = await admin
    .from('account_payment_credentials')
    .select(CREDENTIAL_COLUMNS)
    .eq('account_id', accountId)
    .eq('gateway', 'razorpay')
    .maybeSingle();
  if (error) throw new Error(`load Razorpay credentials: ${error.message}`);
  return (data as CredentialRow | null) ?? null;
}

function readinessIsUsable(row: CredentialRow, now = new Date()): boolean {
  if (row.merchant_status === 'activated') return true;
  if (row.merchant_status !== 'unknown' || !row.activation_verified_at) {
    return false;
  }
  return (
    now.getTime() - new Date(row.activation_verified_at).getTime() <=
    RAZORPAY_READINESS_FRESHNESS_MS
  );
}

async function upgradeManualSecrets(
  admin: SupabaseClient,
  row: CredentialRow
): Promise<void> {
  if (row.secret_storage_version !== 0) return;
  const patch: Record<string, string | number> = {
    secret_storage_version: 1,
  };
  if (row.razorpay_key_secret) {
    patch.razorpay_key_secret = encryptPaymentSecret(row.razorpay_key_secret);
  }
  if (row.razorpay_webhook_secret) {
    patch.razorpay_webhook_secret = encryptPaymentSecret(
      row.razorpay_webhook_secret
    );
  }
  const { data, error } = await admin
    .from('account_payment_credentials')
    .update(patch)
    .eq('account_id', row.account_id)
    .eq('gateway', 'razorpay')
    .eq('secret_storage_version', 0)
    .select('account_id');
  if (error) throw new Error(`upgrade Razorpay credentials: ${error.message}`);
  if (!data?.length) {
    const current = await loadCredentialRow(admin, row.account_id);
    if (current?.secret_storage_version !== 1) {
      throw new Error('Razorpay credential upgrade was not persisted');
    }
  }
}

/** Return only browser-safe metadata; raw credential values never leave. */
export async function getRazorpayConnectionStatus(
  admin: SupabaseClient,
  accountId: string
): Promise<RazorpayConnectionStatus> {
  const row = await loadCredentialRow(admin, accountId);
  const oauthEnabled = isRazorpayOAuthEnabled();
  const manualRollbackEnabled = isRazorpayManualRollbackEnabled();
  if (!row) {
    return {
      authenticationMode: null,
      connectionStatus: 'disconnected',
      merchantStatus: 'unknown',
      providerMode: null,
      merchantAccountSuffix: null,
      keyId: '',
      hasApiSecret: false,
      hasWebhookSecret: false,
      configured: false,
      connectedAt: null,
      disconnectedAt: null,
      activationVerifiedAt: null,
      lastVerifiedAt: null,
      lastError: null,
      oauthEnabled,
      manualRollbackEnabled,
      canonicalWebhookIngress: 'legacy_account',
    };
  }

  let modeMatches = false;
  try {
    modeMatches = row.provider_mode === getRazorpayProviderMode();
  } catch {
    modeMatches = false;
  }
  const oauthMaterialComplete = Boolean(
    row.razorpay_account_id &&
    row.oauth_access_token &&
    row.oauth_refresh_token &&
    row.oauth_access_expires_at &&
    Number.isFinite(new Date(row.oauth_access_expires_at).getTime()) &&
    row.oauth_refresh_expires_at &&
    Number.isFinite(new Date(row.oauth_refresh_expires_at).getTime()) &&
    row.oauth_scope?.split(/[ ,]+/).includes('read_write')
  );
  const oauthConfigured =
    row.authentication_mode === 'oauth' &&
    oauthEnabled &&
    modeMatches &&
    row.secret_storage_version === 1 &&
    row.connection_status === 'ready' &&
    oauthMaterialComplete &&
    readinessIsUsable(row);
  const manualConfigured =
    row.authentication_mode === 'manual' &&
    manualRollbackEnabled &&
    modeMatches &&
    Boolean(
      row.razorpay_key_id &&
      row.razorpay_key_secret &&
      row.razorpay_webhook_secret
    );

  const oauthReadyButInvalid =
    row.authentication_mode === 'oauth' &&
    row.connection_status === 'ready' &&
    (!modeMatches ||
      row.secret_storage_version !== 1 ||
      !oauthMaterialComplete ||
      !readinessIsUsable(row));

  return {
    authenticationMode: row.authentication_mode,
    connectionStatus: oauthReadyButInvalid ? 'blocked' : row.connection_status,
    merchantStatus: row.merchant_status,
    providerMode: row.provider_mode,
    merchantAccountSuffix: row.razorpay_account_id
      ? row.razorpay_account_id.slice(-6)
      : null,
    keyId: manualRollbackEnabled ? (row.razorpay_key_id ?? '') : '',
    hasApiSecret: Boolean(row.razorpay_key_secret),
    hasWebhookSecret: Boolean(row.razorpay_webhook_secret),
    configured: oauthConfigured || manualConfigured,
    connectedAt: row.connected_at,
    disconnectedAt: row.disconnected_at,
    activationVerifiedAt: row.activation_verified_at,
    lastVerifiedAt: row.last_verified_at,
    lastError: oauthReadyButInvalid
      ? (row.last_error ?? 'Razorpay OAuth connection data needs attention')
      : row.last_error,
    oauthEnabled,
    manualRollbackEnabled,
    canonicalWebhookIngress: row.canonical_webhook_ingress,
  };
}

export async function getRazorpayConnection(
  admin: SupabaseClient,
  accountId: string,
  options: { forceRefresh?: boolean } = {}
): Promise<RazorpayConnection | null> {
  const mode = getRazorpayProviderMode();
  const row = await loadCredentialRow(admin, accountId);
  if (!row) return null;
  assertRazorpayProviderMode(row.provider_mode, mode);

  if (row.authentication_mode === 'oauth') {
    if (!isRazorpayOAuthEnabled()) {
      throw new Error('Razorpay OAuth is disabled in this environment');
    }
    if (row.connection_status !== 'ready' || !readinessIsUsable(row)) {
      throw new Error(
        'Razorpay OAuth connection is blocked or needs reconnecting'
      );
    }
    if (
      row.secret_storage_version !== 1 ||
      !row.oauth_access_token ||
      !row.oauth_refresh_token ||
      !row.oauth_access_expires_at ||
      !row.oauth_refresh_expires_at ||
      !row.oauth_scope?.split(/[ ,]+/).includes('read_write')
    ) {
      throw new Error('Razorpay OAuth credentials are incomplete');
    }

    const expiresAt = new Date(row.oauth_access_expires_at);
    if (
      !Number.isFinite(expiresAt.getTime()) ||
      !Number.isFinite(new Date(row.oauth_refresh_expires_at).getTime())
    ) {
      throw new Error('Razorpay OAuth credential expiry is invalid');
    }
    if (
      options.forceRefresh ||
      expiresAt.getTime() - Date.now() <= RAZORPAY_OAUTH_REFRESH_WINDOW_MS
    ) {
      const refreshed = await refreshStoredRazorpayOAuthConnection({
        admin,
        accountId,
        force: options.forceRefresh,
      });
      return {
        accountId,
        gateway: 'razorpay',
        authenticationMode: 'oauth',
        authentication: { mode: 'oauth', accessToken: refreshed.accessToken },
        oauthAccessExpiresAt: refreshed.accessExpiresAt,
      };
    }

    return {
      accountId,
      gateway: 'razorpay',
      authenticationMode: 'oauth',
      authentication: {
        mode: 'oauth',
        accessToken: decryptPaymentSecret(row.oauth_access_token, 1, {
          allowVersionZero: false,
        }),
      },
      oauthAccessExpiresAt: expiresAt,
    };
  }

  if (!isRazorpayManualRollbackEnabled()) return null;
  const keyId = row.razorpay_key_id;
  const keySecret = row.razorpay_key_secret;
  if (!keyId || !keySecret) return null;
  const plaintext = decryptPaymentSecret(
    keySecret,
    row.secret_storage_version,
    {
      allowVersionZero: true,
    }
  );
  await upgradeManualSecrets(admin, row);
  return {
    accountId,
    gateway: 'razorpay',
    authenticationMode: 'manual',
    authentication: { mode: 'api_key', keyId, keySecret: plaintext },
  };
}

/** The legacy account-webhook signing secret, or null. */
export async function getWebhookSecret(
  admin: SupabaseClient,
  accountId: string
): Promise<string | null> {
  if (!isRazorpayManualRollbackEnabled()) return null;
  const mode = getRazorpayProviderMode();
  const row = await loadCredentialRow(admin, accountId);
  if (!row?.razorpay_webhook_secret) return null;
  assertRazorpayProviderMode(row.provider_mode, mode);
  if (row.canonical_webhook_ingress !== 'legacy_account') return null;
  const plaintext = decryptPaymentSecret(
    row.razorpay_webhook_secret,
    row.secret_storage_version,
    { allowVersionZero: true }
  );
  await upgradeManualSecrets(admin, row);
  return plaintext;
}

export async function saveManualRazorpayCredentials(
  admin: SupabaseClient,
  accountId: string,
  patch: RazorpayCredentialPatch
): Promise<RazorpayConnectionStatus> {
  if (!isRazorpayManualRollbackEnabled()) {
    throw new Error('Manual Razorpay rollback is disabled');
  }
  const mode = getRazorpayProviderMode();
  const current = await loadCredentialRow(admin, accountId);
  if (current?.secret_storage_version === 0) {
    await upgradeManualSecrets(admin, current);
  }
  const hasApiSecret = Boolean(current?.razorpay_key_secret || patch.keySecret);
  const hasWebhookSecret = Boolean(
    current?.razorpay_webhook_secret || patch.webhookSecret
  );
  const configured = Boolean(patch.keyId && hasApiSecret && hasWebhookSecret);
  const row: Record<string, string | number | null> = {
    account_id: accountId,
    gateway: 'razorpay',
    authentication_mode: 'manual',
    provider_mode: mode,
    secret_storage_version: 1,
    razorpay_key_id: patch.keyId,
    connection_status: configured ? 'ready' : 'disconnected',
    merchant_status: 'unknown',
    last_error: null,
  };
  if (patch.keySecret) {
    row.razorpay_key_secret = encryptPaymentSecret(patch.keySecret);
  }
  if (patch.webhookSecret) {
    row.razorpay_webhook_secret = encryptPaymentSecret(patch.webhookSecret);
  }
  const { error } = await admin
    .from('account_payment_credentials')
    .upsert(row, { onConflict: 'account_id' });
  if (error) throw new Error(`save Razorpay credentials: ${error.message}`);
  return getRazorpayConnectionStatus(admin, accountId);
}

export async function beginRazorpayOAuthConnection(
  admin: SupabaseClient,
  accountId: string,
  tokens: RazorpayOAuthTokenSet
): Promise<void> {
  const mode = getRazorpayProviderMode();
  assertRazorpayProviderMode(tokens.mode, mode);
  const current = await loadCredentialRow(admin, accountId);
  if (
    current?.authentication_mode === 'oauth' &&
    current.razorpay_account_id &&
    current.razorpay_account_id !== tokens.accountId
  ) {
    throw new Error(
      'Disconnect the existing Razorpay merchant before connecting a different account'
    );
  }
  const now = new Date().toISOString();
  const { error } = await admin.from('account_payment_credentials').upsert(
    {
      account_id: accountId,
      gateway: 'razorpay',
      authentication_mode: 'oauth',
      razorpay_account_id: tokens.accountId,
      provider_mode: mode,
      secret_storage_version: 1,
      oauth_access_token: encryptPaymentSecret(tokens.accessToken),
      oauth_refresh_token: encryptPaymentSecret(tokens.refreshToken),
      oauth_access_expires_at: tokens.accessExpiresAt.toISOString(),
      oauth_refresh_expires_at: tokens.refreshExpiresAt.toISOString(),
      oauth_scope: tokens.scope,
      connection_status: 'connecting',
      merchant_status: 'unknown',
      connected_at: now,
      disconnected_at: null,
      activation_verified_at: null,
      last_verified_at: now,
      last_error: null,
    },
    { onConflict: 'account_id' }
  );
  if (error?.code === '23505') {
    throw new Error(
      'This Razorpay merchant is already connected to another account'
    );
  }
  if (error)
    throw new Error(`save Razorpay OAuth connection: ${error.message}`);
}

export async function finalizeRazorpayOAuthConnection(
  admin: SupabaseClient,
  accountId: string,
  readiness: RazorpayReadiness
): Promise<void> {
  const { data, error } = await admin
    .from('account_payment_credentials')
    .update({
      connection_status: readiness.ready ? 'ready' : 'blocked',
      merchant_status: readiness.merchantStatus,
      activation_verified_at: readiness.activationVerifiedAt,
      last_verified_at: new Date().toISOString(),
      last_error: readiness.lastError,
    })
    .eq('account_id', accountId)
    .eq('gateway', 'razorpay')
    .eq('authentication_mode', 'oauth')
    .select('account_id');
  if (error)
    throw new Error(`verify Razorpay OAuth connection: ${error.message}`);
  if (!data?.length) throw new Error('Razorpay OAuth connection was not found');
}

export async function disconnectRazorpayOAuthConnection(
  admin: SupabaseClient,
  accountId: string
): Promise<void> {
  const config = getRazorpayOAuthConfig(process.env, { allowDisabled: true });
  const row = await loadCredentialRow(admin, accountId);
  if (!row || row.authentication_mode !== 'oauth') return;
  assertRazorpayProviderMode(row.provider_mode, config.mode);
  if (row.secret_storage_version !== 1) {
    throw new Error(
      'Razorpay OAuth credentials have an invalid storage version'
    );
  }
  const { data: blocked, error: blockError } = await admin
    .from('account_payment_credentials')
    .update({ connection_status: 'disconnecting', last_error: null })
    .eq('account_id', accountId)
    .eq('authentication_mode', 'oauth')
    .select('account_id');
  if (blockError || !blocked?.length) {
    throw new Error(
      `block Razorpay connection: ${blockError?.message ?? 'not found'}`
    );
  }

  const revocations: Promise<void>[] = [];
  if (row.oauth_refresh_token) {
    revocations.push(
      revokeRazorpayOAuthToken({
        config,
        tokenType: 'refresh_token',
        token: decryptPaymentSecret(row.oauth_refresh_token, 1, {
          allowVersionZero: false,
        }),
      })
    );
  }
  if (row.oauth_access_token) {
    revocations.push(
      revokeRazorpayOAuthToken({
        config,
        tokenType: 'access_token',
        token: decryptPaymentSecret(row.oauth_access_token, 1, {
          allowVersionZero: false,
        }),
      })
    );
  }

  const results = await Promise.allSettled(revocations);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  if (failure) {
    await admin
      .from('account_payment_credentials')
      .update({
        last_error: boundedRazorpayError(failure.reason),
      })
      .eq('account_id', accountId)
      .eq('authentication_mode', 'oauth');
    throw failure.reason;
  }

  const { data, error } = await admin
    .from('account_payment_credentials')
    .update({
      razorpay_account_id: null,
      oauth_access_token: null,
      oauth_refresh_token: null,
      oauth_access_expires_at: null,
      oauth_refresh_expires_at: null,
      oauth_scope: null,
      connection_status: 'disconnected',
      merchant_status: 'unknown',
      refresh_lease_owner: null,
      refresh_lease_until: null,
      disconnected_at: new Date().toISOString(),
      activation_verified_at: null,
      last_verified_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('account_id', accountId)
    .eq('authentication_mode', 'oauth')
    .select('account_id');
  if (error || !data?.length) {
    throw new Error(
      `disconnect Razorpay connection: ${error?.message ?? 'not found'}`
    );
  }
}

function oauthExpiryError(error: RazorpayError): boolean {
  if (error.status !== 401) return false;
  const detail = JSON.stringify(error.body ?? '').toLowerCase();
  return /token|expired|oauth|authoriz/.test(detail);
}

/** Retry one authenticated operation once after an attributable OAuth 401. */
export async function runRazorpayOperation<T>(
  admin: SupabaseClient,
  connection: RazorpayConnection,
  operation: (authentication: RazorpayAuthentication) => Promise<T>
): Promise<T> {
  try {
    return await operation(connection.authentication);
  } catch (error) {
    const clockExpired =
      connection.oauthAccessExpiresAt != null &&
      connection.oauthAccessExpiresAt.getTime() <= Date.now();
    if (
      connection.authenticationMode !== 'oauth' ||
      !(error instanceof RazorpayError) ||
      (!clockExpired && !oauthExpiryError(error))
    ) {
      throw error;
    }
    const refreshed = await getRazorpayConnection(admin, connection.accountId, {
      forceRefresh: true,
    });
    if (!refreshed || refreshed.authenticationMode !== 'oauth') throw error;
    return operation(refreshed.authentication);
  }
}
