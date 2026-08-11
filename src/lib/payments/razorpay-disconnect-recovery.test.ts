import { describe, expect, it } from 'vitest';

import {
  reconcileDisconnectingRazorpayOAuth,
  type DisconnectRecoveryStore,
} from './razorpay-disconnect-recovery';

function recoveryStore() {
  let state = {
    accountId: 'account',
    externalAccountId: 'acc_exact',
    providerMode: 'live' as const,
    connectionStatus: 'disconnecting',
    generation: 0,
    leaseOwner: null as string | null,
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    accessExpiresAt: new Date('2026-11-10T00:00:00Z'),
    refreshExpiresAt: new Date('2027-02-06T00:00:00Z'),
    scope: 'read_write',
  };
  const commits: string[] = [];
  const store: DisconnectRecoveryStore = {
    async load() {
      return { ...state };
    },
    async claim(owner) {
      state = {
        ...state,
        generation: state.generation + 1,
        leaseOwner: owner,
      };
      return { generation: state.generation };
    },
    async commit(owner, generation, tokens, readiness) {
      if (state.leaseOwner !== owner || state.generation !== generation) {
        return false;
      }
      commits.push(readiness.ready ? 'ready' : 'blocked');
      state = {
        ...state,
        connectionStatus: readiness.ready ? 'ready' : 'blocked',
        leaseOwner: null,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      };
      return true;
    },
    async fail(owner, generation) {
      if (state.leaseOwner !== owner || state.generation !== generation) {
        return false;
      }
      state = {
        ...state,
        connectionStatus: 'reconnect_required',
        leaseOwner: null,
      };
      return true;
    },
  };
  return { store, commits, read: () => state };
}

const rotatedTokens = {
  accountId: 'acc_exact',
  mode: 'live' as const,
  scope: 'read_write',
  accessToken: 'new-access',
  refreshToken: 'new-refresh',
  accessExpiresAt: new Date('2026-11-11T00:00:00Z'),
  refreshExpiresAt: new Date('2027-02-07T00:00:00Z'),
};

describe('Razorpay failed-disconnect recovery', () => {
  it('commits ready only after refresh rotation and provider readiness pass', async () => {
    const memory = recoveryStore();
    const result = await reconcileDisconnectingRazorpayOAuth({
      store: memory.store,
      owner: () => 'owner',
      refresh: async () => rotatedTokens,
      verify: async () => ({
        ready: true,
        merchantStatus: 'unknown',
        activationVerifiedAt: '2026-08-11T17:00:00.000Z',
        lastError: null,
      }),
    });

    expect(result.ready).toBe(true);
    expect(memory.commits).toEqual(['ready']);
    expect(memory.read()).toMatchObject({
      connectionStatus: 'ready',
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      leaseOwner: null,
    });
  });

  it('persists a provider-verified blocked result with the rotated grant', async () => {
    const memory = recoveryStore();
    const result = await reconcileDisconnectingRazorpayOAuth({
      store: memory.store,
      owner: () => 'owner',
      refresh: async () => rotatedTokens,
      verify: async () => ({
        ready: false,
        merchantStatus: 'under_review',
        activationVerifiedAt: null,
        lastError: 'Razorpay merchant is not ready for payments',
      }),
    });

    expect(result.ready).toBe(false);
    expect(memory.commits).toEqual(['blocked']);
    expect(memory.read().connectionStatus).toBe('blocked');
    expect(memory.read().refreshToken).toBe('new-refresh');
  });

  it('requires reconnect when the stored refresh grant is rejected', async () => {
    const memory = recoveryStore();
    await expect(
      reconcileDisconnectingRazorpayOAuth({
        store: memory.store,
        owner: () => 'owner',
        refresh: async () => {
          throw new Error('invalid grant');
        },
        verify: async () => {
          throw new Error('must not run');
        },
      })
    ).rejects.toThrow(/invalid grant/);
    expect(memory.read().connectionStatus).toBe('reconnect_required');
    expect(memory.commits).toEqual([]);
  });

  it('rejects and quarantines a mismatched returned merchant', async () => {
    const memory = recoveryStore();
    const rejected: string[] = [];
    await expect(
      reconcileDisconnectingRazorpayOAuth({
        store: memory.store,
        owner: () => 'owner',
        refresh: async () => ({
          ...rotatedTokens,
          accountId: 'acc_other',
        }),
        rejectMismatchedGrant: async (tokens) => {
          rejected.push(tokens.accountId);
        },
        verify: async () => {
          throw new Error('must not run');
        },
      })
    ).rejects.toThrow(/identity changed/);
    expect(rejected).toEqual(['acc_other']);
    expect(memory.read().connectionStatus).toBe('reconnect_required');
  });
});
