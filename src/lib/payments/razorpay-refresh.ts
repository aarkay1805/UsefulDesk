import 'server-only';

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { decryptPaymentSecret, encryptPaymentSecret } from './payment-secrets';
import {
  getRazorpayOAuthConfig,
  RAZORPAY_OAUTH_REFRESH_WINDOW_MS,
  RAZORPAY_REFRESH_LEASE_SECONDS,
  type RazorpayProviderMode,
} from './razorpay-config';
import {
  boundedRazorpayError,
  refreshRazorpayOAuthTokens,
  type RazorpayOAuthTokenSet,
} from './razorpay-oauth';

export interface OAuthRefreshSnapshot {
  accountId: string;
  providerAccountId: string;
  providerMode: RazorpayProviderMode;
  connectionStatus: string;
  generation: number;
  leaseOwner: string | null;
  leaseUntil: Date | null;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  scope: string;
}

export interface OAuthRefreshClaim {
  generation: number;
  leaseUntil: Date;
}

export interface OAuthRefreshStore {
  load(): Promise<OAuthRefreshSnapshot | null>;
  claim(owner: string): Promise<OAuthRefreshClaim | null>;
  commit(
    owner: string,
    generation: number,
    tokens: RazorpayOAuthTokenSet
  ): Promise<boolean>;
  markReconnectRequired(
    owner: string,
    generation: number,
    error: string
  ): Promise<boolean>;
}

export interface OAuthRefreshDependencies {
  refresh(tokens: OAuthRefreshSnapshot): Promise<RazorpayOAuthTokenSet>;
  now(): Date;
  wait(ms: number): Promise<void>;
  owner(): string;
}

function usableWithoutRefresh(
  snapshot: OAuthRefreshSnapshot,
  now: Date
): boolean {
  return (
    snapshot.accessExpiresAt.getTime() - now.getTime() >
    RAZORPAY_OAUTH_REFRESH_WINDOW_MS
  );
}

function assertRefreshable(snapshot: OAuthRefreshSnapshot, now: Date): void {
  if (snapshot.connectionStatus !== 'ready') {
    throw new Error('Razorpay OAuth connection requires reconnecting');
  }
  if (snapshot.refreshExpiresAt.getTime() <= now.getTime()) {
    throw new Error('Razorpay OAuth refresh token has expired');
  }
}

function committedRefreshWinner(
  winner: OAuthRefreshSnapshot | null,
  claimed: OAuthRefreshSnapshot,
  claimedGeneration: number
): winner is OAuthRefreshSnapshot {
  return Boolean(
    winner &&
    winner.connectionStatus === 'ready' &&
    winner.leaseOwner === null &&
    winner.leaseUntil === null &&
    (winner.generation > claimedGeneration ||
      winner.accessToken !== claimed.accessToken ||
      winner.accessExpiresAt.getTime() > claimed.accessExpiresAt.getTime())
  );
}

function newerRefreshIsInProgress(
  winner: OAuthRefreshSnapshot | null,
  claimedGeneration: number,
  now: Date
): boolean {
  return Boolean(
    winner &&
    winner.connectionStatus === 'ready' &&
    winner.generation > claimedGeneration &&
    winner.leaseOwner &&
    winner.leaseUntil &&
    winner.leaseUntil.getTime() > now.getTime()
  );
}

/**
 * Coordinate a rotating Razorpay refresh token across server instances. The
 * database store owns the lease/generation CAS; waiting callers only reload and
 * never submit the same refresh token concurrently.
 */
export async function refreshRazorpayOAuthSingleFlight(input: {
  store: OAuthRefreshStore;
  force?: boolean;
  dependencies?: Partial<OAuthRefreshDependencies>;
}): Promise<OAuthRefreshSnapshot> {
  const dependencies: OAuthRefreshDependencies = {
    refresh: async () => {
      throw new Error('OAuth refresh provider is not configured');
    },
    now: () => new Date(),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    owner: () => randomUUID(),
    ...input.dependencies,
  };
  const owner = dependencies.owner();
  const startedAt = dependencies.now().getTime();
  const waitDeadline = startedAt + (RAZORPAY_REFRESH_LEASE_SECONDS + 5) * 1000;
  let initialAccessToken: string | null = null;
  let initialAccessExpiry = 0;

  while (dependencies.now().getTime() <= waitDeadline) {
    const before = await input.store.load();
    if (!before) throw new Error('Razorpay OAuth connection is missing');
    if (initialAccessToken === null) {
      initialAccessToken = before.accessToken;
      initialAccessExpiry = before.accessExpiresAt.getTime();
    }
    assertRefreshable(before, dependencies.now());
    const forcedTokenIsUnchanged =
      Boolean(input.force) &&
      before.accessToken === initialAccessToken &&
      before.accessExpiresAt.getTime() === initialAccessExpiry;
    if (
      !forcedTokenIsUnchanged &&
      usableWithoutRefresh(before, dependencies.now())
    ) {
      return before;
    }

    const claim = await input.store.claim(owner);
    if (!claim) {
      await dependencies.wait(100);
      continue;
    }

    const claimed = await input.store.load();
    if (!claimed || claimed.generation !== claim.generation) {
      throw new Error('Razorpay OAuth refresh lease could not be loaded');
    }
    assertRefreshable(claimed, dependencies.now());

    try {
      const tokens = await dependencies.refresh(claimed);
      if (tokens.accountId !== claimed.providerAccountId) {
        throw new Error(
          'Razorpay OAuth merchant identity changed during refresh'
        );
      }
      const committed = await input.store.commit(
        owner,
        claim.generation,
        tokens
      );
      if (committed) {
        const fresh = await input.store.load();
        if (fresh) return fresh;
      }

      const winner = await input.store.load();
      if (committedRefreshWinner(winner, claimed, claim.generation)) {
        return winner;
      }
      if (
        newerRefreshIsInProgress(winner, claim.generation, dependencies.now())
      ) {
        await dependencies.wait(100);
        continue;
      }
      throw new Error('Razorpay OAuth refresh result could not be committed');
    } catch (error) {
      const winner = await input.store.load();
      if (committedRefreshWinner(winner, claimed, claim.generation)) {
        return winner;
      }
      if (
        newerRefreshIsInProgress(winner, claim.generation, dependencies.now())
      ) {
        await dependencies.wait(100);
        continue;
      }
      await input.store.markReconnectRequired(
        owner,
        claim.generation,
        boundedRazorpayError(error)
      );
      throw error;
    }
  }

  throw new Error('Timed out waiting for Razorpay OAuth token refresh');
}

interface StoredRefreshRow {
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
  refresh_lease_until: string | null;
}

export function createSupabaseOAuthRefreshStore(input: {
  admin: SupabaseClient;
  accountId: string;
  providerMode: RazorpayProviderMode;
}): OAuthRefreshStore {
  return {
    async load() {
      const { data, error } = await input.admin
        .from('account_payment_credentials')
        .select(
          'account_id, razorpay_account_id, provider_mode, secret_storage_version, oauth_access_token, oauth_refresh_token, oauth_access_expires_at, oauth_refresh_expires_at, oauth_scope, connection_status, refresh_generation, refresh_lease_owner, refresh_lease_until'
        )
        .eq('account_id', input.accountId)
        .eq('gateway', 'razorpay')
        .maybeSingle();
      if (error)
        throw new Error(`load Razorpay OAuth refresh: ${error.message}`);
      if (!data) return null;
      const row = data as StoredRefreshRow;
      if (
        row.provider_mode !== input.providerMode ||
        row.secret_storage_version !== 1 ||
        !row.razorpay_account_id ||
        !row.oauth_access_token ||
        !row.oauth_refresh_token ||
        !row.oauth_access_expires_at ||
        !row.oauth_refresh_expires_at ||
        !row.oauth_scope?.split(/[ ,]+/).includes('read_write')
      ) {
        throw new Error('Razorpay OAuth refresh credentials are incomplete');
      }
      const accessExpiresAt = new Date(row.oauth_access_expires_at);
      const refreshExpiresAt = new Date(row.oauth_refresh_expires_at);
      if (
        !Number.isFinite(accessExpiresAt.getTime()) ||
        !Number.isFinite(refreshExpiresAt.getTime())
      ) {
        throw new Error('Razorpay OAuth refresh expiry is invalid');
      }
      return {
        accountId: row.account_id,
        providerAccountId: row.razorpay_account_id,
        providerMode: row.provider_mode,
        connectionStatus: row.connection_status,
        generation: row.refresh_generation,
        leaseOwner: row.refresh_lease_owner,
        leaseUntil: row.refresh_lease_until
          ? new Date(row.refresh_lease_until)
          : null,
        accessToken: decryptPaymentSecret(row.oauth_access_token, 1, {
          allowVersionZero: false,
        }),
        refreshToken: decryptPaymentSecret(row.oauth_refresh_token, 1, {
          allowVersionZero: false,
        }),
        accessExpiresAt,
        refreshExpiresAt,
        scope: row.oauth_scope,
      };
    },

    async claim(owner) {
      const { data, error } = await input.admin.rpc(
        'claim_razorpay_oauth_refresh',
        {
          p_account_id: input.accountId,
          p_provider_mode: input.providerMode,
          p_lease_owner: owner,
          p_lease_seconds: RAZORPAY_REFRESH_LEASE_SECONDS,
        }
      );
      if (error)
        throw new Error(`claim Razorpay OAuth refresh: ${error.message}`);
      const row = Array.isArray(data) ? data[0] : null;
      if (!row) return null;
      return {
        generation: Number(row.refresh_generation),
        leaseUntil: new Date(row.refresh_lease_until),
      };
    },

    async commit(owner, generation, tokens) {
      const { data, error } = await input.admin.rpc(
        'commit_razorpay_oauth_refresh',
        {
          p_account_id: input.accountId,
          p_provider_mode: input.providerMode,
          p_lease_owner: owner,
          p_refresh_generation: generation,
          p_access_token: encryptPaymentSecret(tokens.accessToken),
          p_refresh_token: encryptPaymentSecret(tokens.refreshToken),
          p_access_expires_at: tokens.accessExpiresAt.toISOString(),
          p_refresh_expires_at: tokens.refreshExpiresAt.toISOString(),
          p_scope: tokens.scope,
        }
      );
      if (error)
        throw new Error(`commit Razorpay OAuth refresh: ${error.message}`);
      return data === true;
    },

    async markReconnectRequired(owner, generation, errorText) {
      const { data, error } = await input.admin.rpc(
        'mark_razorpay_oauth_reconnect_required',
        {
          p_account_id: input.accountId,
          p_provider_mode: input.providerMode,
          p_lease_owner: owner,
          p_refresh_generation: generation,
          p_error: errorText,
        }
      );
      if (error) {
        throw new Error(`mark Razorpay OAuth reconnect: ${error.message}`);
      }
      return data === true;
    },
  };
}

export async function refreshStoredRazorpayOAuthConnection(input: {
  admin: SupabaseClient;
  accountId: string;
  force?: boolean;
}): Promise<OAuthRefreshSnapshot> {
  const config = getRazorpayOAuthConfig();
  const store = createSupabaseOAuthRefreshStore({
    admin: input.admin,
    accountId: input.accountId,
    providerMode: config.mode,
  });
  return refreshRazorpayOAuthSingleFlight({
    store,
    force: input.force,
    dependencies: {
      refresh: (snapshot) =>
        refreshRazorpayOAuthTokens({
          config,
          accountId: snapshot.providerAccountId,
          refreshToken: snapshot.refreshToken,
          scope: snapshot.scope,
        }),
    },
  });
}
