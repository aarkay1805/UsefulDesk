import 'server-only';

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { decryptPaymentSecret, encryptPaymentSecret } from './payment-secrets';
import {
  authorizeRazorpayLiveRolloutMerchant,
  getRazorpayOAuthConfig,
  loadRazorpayLiveRolloutAuthorization,
  RAZORPAY_REFRESH_LEASE_SECONDS,
  type RazorpayProviderMode,
} from './razorpay-config';
import {
  boundedRazorpayError,
  refreshRazorpayOAuthTokens,
  revokeRazorpayOAuthToken,
  verifyRazorpayOAuthReadiness,
  type RazorpayOAuthTokenSet,
  type RazorpayReadiness,
} from './razorpay-oauth';

interface DisconnectRecoverySnapshot {
  accountId: string;
  externalAccountId: string;
  providerMode: RazorpayProviderMode;
  connectionStatus: string;
  generation: number;
  leaseOwner: string | null;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  scope: string;
}

interface DisconnectRecoveryClaim {
  generation: number;
}

export interface DisconnectRecoveryStore {
  load(): Promise<DisconnectRecoverySnapshot | null>;
  claim(owner: string): Promise<DisconnectRecoveryClaim | null>;
  commit(
    owner: string,
    generation: number,
    tokens: RazorpayOAuthTokenSet,
    readiness: RazorpayReadiness
  ): Promise<boolean>;
  fail(owner: string, generation: number, error: string): Promise<boolean>;
}

export async function reconcileDisconnectingRazorpayOAuth(input: {
  store: DisconnectRecoveryStore;
  owner?: () => string;
  refresh: (
    snapshot: DisconnectRecoverySnapshot
  ) => Promise<RazorpayOAuthTokenSet>;
  verify: (tokens: RazorpayOAuthTokenSet) => Promise<RazorpayReadiness>;
  rejectMismatchedGrant?: (tokens: RazorpayOAuthTokenSet) => Promise<void>;
}): Promise<RazorpayReadiness> {
  const before = await input.store.load();
  if (!before || before.connectionStatus !== 'disconnecting') {
    throw new Error('Razorpay connection is not awaiting disconnect recovery');
  }
  const owner = (input.owner ?? randomUUID)();
  const claim = await input.store.claim(owner);
  if (!claim) {
    throw new Error('Razorpay disconnect recovery is already running');
  }
  const claimed = await input.store.load();
  if (
    !claimed ||
    claimed.connectionStatus !== 'disconnecting' ||
    claimed.generation !== claim.generation ||
    claimed.leaseOwner !== owner
  ) {
    throw new Error('Razorpay disconnect recovery lease could not be loaded');
  }

  try {
    const tokens = await input.refresh(claimed);
    if (tokens.accountId !== claimed.externalAccountId) {
      await input.rejectMismatchedGrant?.(tokens);
      throw new Error(
        'Razorpay OAuth merchant identity changed during disconnect recovery'
      );
    }
    let readiness: RazorpayReadiness;
    try {
      readiness = await input.verify(tokens);
    } catch (error) {
      readiness = {
        ready: false,
        merchantStatus: 'unknown',
        activationVerifiedAt: null,
        lastError: boundedRazorpayError(error),
      };
    }
    const committed = await input.store.commit(
      owner,
      claim.generation,
      tokens,
      readiness
    );
    if (!committed) {
      throw new Error('Razorpay disconnect recovery could not be committed');
    }
    return readiness;
  } catch (error) {
    await input.store.fail(
      owner,
      claim.generation,
      boundedRazorpayError(error)
    );
    throw error;
  }
}

interface StoredDisconnectRecoveryRow {
  account_id: string;
  razorpay_account_id: string | null;
  provider_mode: RazorpayProviderMode | null;
  secret_storage_version: number;
  oauth_access_token: string | null;
  oauth_refresh_token: string | null;
  oauth_access_expires_at: string | null;
  oauth_refresh_expires_at: string | null;
  oauth_scope: string | null;
  connection_status: string;
  refresh_generation: number;
  refresh_lease_owner: string | null;
  razorpay_key_id: string | null;
  razorpay_key_secret: string | null;
  razorpay_webhook_secret: string | null;
}

export function createSupabaseDisconnectRecoveryStore(input: {
  admin: SupabaseClient;
  accountId: string;
  providerMode: RazorpayProviderMode;
  externalAccountId: string;
}): DisconnectRecoveryStore {
  return {
    async load() {
      const { data, error } = await input.admin
        .from('account_payment_credentials')
        .select(
          'account_id, razorpay_account_id, provider_mode, secret_storage_version, oauth_access_token, oauth_refresh_token, oauth_access_expires_at, oauth_refresh_expires_at, oauth_scope, connection_status, refresh_generation, refresh_lease_owner, razorpay_key_id, razorpay_key_secret, razorpay_webhook_secret'
        )
        .eq('account_id', input.accountId)
        .eq('gateway', 'razorpay')
        .maybeSingle();
      if (error) {
        throw new Error(`load Razorpay disconnect recovery: ${error.message}`);
      }
      if (!data) return null;
      const row = data as StoredDisconnectRecoveryRow;
      if (
        row.provider_mode !== input.providerMode ||
        row.razorpay_account_id !== input.externalAccountId ||
        row.secret_storage_version !== 1 ||
        !row.oauth_access_token ||
        !row.oauth_refresh_token ||
        !row.oauth_access_expires_at ||
        !row.oauth_refresh_expires_at ||
        !row.oauth_scope?.split(/[ ,]+/).includes('read_write') ||
        row.razorpay_key_id ||
        row.razorpay_key_secret ||
        row.razorpay_webhook_secret
      ) {
        throw new Error('Razorpay disconnect recovery credentials are invalid');
      }
      const accessExpiresAt = new Date(row.oauth_access_expires_at);
      const refreshExpiresAt = new Date(row.oauth_refresh_expires_at);
      if (
        !Number.isFinite(accessExpiresAt.getTime()) ||
        !Number.isFinite(refreshExpiresAt.getTime())
      ) {
        throw new Error('Razorpay disconnect recovery expiry is invalid');
      }
      return {
        accountId: row.account_id,
        externalAccountId: row.razorpay_account_id,
        providerMode: row.provider_mode,
        connectionStatus: row.connection_status,
        generation: row.refresh_generation,
        leaseOwner: row.refresh_lease_owner,
        accessToken: decryptPaymentSecret(row.oauth_access_token),
        refreshToken: decryptPaymentSecret(row.oauth_refresh_token),
        accessExpiresAt,
        refreshExpiresAt,
        scope: row.oauth_scope,
      };
    },

    async claim(owner) {
      const { data, error } = await input.admin.rpc(
        'claim_razorpay_oauth_disconnect_recovery',
        {
          p_account_id: input.accountId,
          p_provider_mode: input.providerMode,
          p_external_account_id: input.externalAccountId,
          p_lease_owner: owner,
          p_lease_seconds: RAZORPAY_REFRESH_LEASE_SECONDS,
        }
      );
      if (error) {
        throw new Error(`claim Razorpay disconnect recovery: ${error.message}`);
      }
      const row = Array.isArray(data) ? data[0] : null;
      return row ? { generation: Number(row.refresh_generation) } : null;
    },

    async commit(owner, generation, tokens, readiness) {
      const { data, error } = await input.admin.rpc(
        'commit_razorpay_oauth_disconnect_recovery',
        {
          p_account_id: input.accountId,
          p_provider_mode: input.providerMode,
          p_external_account_id: input.externalAccountId,
          p_lease_owner: owner,
          p_refresh_generation: generation,
          p_access_token: encryptPaymentSecret(tokens.accessToken),
          p_refresh_token: encryptPaymentSecret(tokens.refreshToken),
          p_access_expires_at: tokens.accessExpiresAt.toISOString(),
          p_refresh_expires_at: tokens.refreshExpiresAt.toISOString(),
          p_scope: tokens.scope,
          p_connection_status: readiness.ready ? 'ready' : 'blocked',
          p_merchant_status: readiness.merchantStatus,
          p_activation_verified_at: readiness.activationVerifiedAt,
          p_last_error: readiness.lastError,
        }
      );
      if (error) {
        throw new Error(
          `commit Razorpay disconnect recovery: ${error.message}`
        );
      }
      return data === true;
    },

    async fail(owner, generation, errorText) {
      const { data, error } = await input.admin.rpc(
        'fail_razorpay_oauth_disconnect_recovery',
        {
          p_account_id: input.accountId,
          p_provider_mode: input.providerMode,
          p_external_account_id: input.externalAccountId,
          p_lease_owner: owner,
          p_refresh_generation: generation,
          p_error: errorText,
        }
      );
      if (error) {
        throw new Error(`fail Razorpay disconnect recovery: ${error.message}`);
      }
      return data === true;
    },
  };
}

export async function recoverStoredRazorpayDisconnectingConnection(input: {
  admin: SupabaseClient;
  accountId: string;
}): Promise<RazorpayReadiness> {
  const config = getRazorpayOAuthConfig(process.env, { allowDisabled: true });
  const rollout = await loadRazorpayLiveRolloutAuthorization(
    input.admin,
    input.accountId
  );

  const { data, error } = await input.admin
    .from('account_payment_credentials')
    .select('razorpay_account_id')
    .eq('account_id', input.accountId)
    .eq('gateway', 'razorpay')
    .eq('authentication_mode', 'oauth')
    .maybeSingle();
  if (error || !data?.razorpay_account_id) {
    throw new Error(
      `load Razorpay recovery identity: ${error?.message ?? 'not found'}`
    );
  }
  authorizeRazorpayLiveRolloutMerchant(data.razorpay_account_id, rollout);
  const store = createSupabaseDisconnectRecoveryStore({
    admin: input.admin,
    accountId: input.accountId,
    providerMode: config.mode,
    externalAccountId: data.razorpay_account_id,
  });
  return reconcileDisconnectingRazorpayOAuth({
    store,
    refresh: (snapshot) =>
      refreshRazorpayOAuthTokens({
        config,
        accountId: snapshot.externalAccountId,
        refreshToken: snapshot.refreshToken,
        scope: snapshot.scope,
      }),
    rejectMismatchedGrant: async (tokens) => {
      const results = await Promise.allSettled([
        revokeRazorpayOAuthToken({
          config,
          token: tokens.accessToken,
          tokenType: 'access_token',
        }),
        revokeRazorpayOAuthToken({
          config,
          token: tokens.refreshToken,
          tokenType: 'refresh_token',
        }),
      ]);
      if (results.some((result) => result.status === 'rejected')) {
        throw new Error('Mismatched Razorpay OAuth grant could not be revoked');
      }
    },
    verify: (tokens) =>
      verifyRazorpayOAuthReadiness({
        accessToken: tokens.accessToken,
        accountId: tokens.accountId,
      }),
  });
}
