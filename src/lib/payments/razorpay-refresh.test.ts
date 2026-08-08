import { describe, expect, it } from 'vitest';

import {
  refreshRazorpayOAuthSingleFlight,
  type OAuthRefreshSnapshot,
  type OAuthRefreshStore,
} from './razorpay-refresh';

function refreshableSnapshot(): OAuthRefreshSnapshot {
  return {
    accountId: 'account',
    providerAccountId: 'acc_123',
    providerMode: 'test',
    connectionStatus: 'ready',
    generation: 0,
    leaseOwner: null,
    leaseUntil: null,
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    accessExpiresAt: new Date(Date.now() + 60_000),
    refreshExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    scope: 'read_write',
  };
}

function inMemoryStore(initial = refreshableSnapshot()) {
  let state = initial;
  const store: OAuthRefreshStore = {
    async load() {
      return { ...state };
    },
    async claim(owner) {
      if (state.leaseUntil && state.leaseUntil.getTime() > Date.now()) {
        return null;
      }
      state = {
        ...state,
        generation: state.generation + 1,
        leaseOwner: owner,
        leaseUntil: new Date(Date.now() + 120_000),
      };
      return {
        generation: state.generation,
        leaseUntil: state.leaseUntil!,
      };
    },
    async commit(owner, generation, tokens) {
      if (state.leaseOwner !== owner || state.generation !== generation) {
        return false;
      }
      state = {
        ...state,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessExpiresAt: tokens.accessExpiresAt,
        refreshExpiresAt: tokens.refreshExpiresAt,
        scope: tokens.scope,
        leaseOwner: null,
        leaseUntil: null,
      };
      return true;
    },
    async markReconnectRequired(owner, generation) {
      if (state.leaseOwner !== owner || state.generation !== generation) {
        return false;
      }
      state = {
        ...state,
        connectionStatus: 'reconnect_required',
        leaseOwner: null,
        leaseUntil: null,
      };
      return true;
    },
  };
  return {
    store,
    read: () => state,
    write: (next: OAuthRefreshSnapshot) => {
      state = next;
    },
  };
}

describe('Razorpay OAuth refresh single-flight', () => {
  it.each([
    [2, false],
    [10, false],
    [2, true],
    [10, true],
  ] as const)(
    '%i concurrent callers submit one rotating refresh token (force=%s)',
    async (callerCount, force) => {
      const memory = inMemoryStore();
      if (force) {
        memory.read().accessExpiresAt = new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000
        );
      }
      let providerCalls = 0;
      const calls = Array.from({ length: callerCount }, () =>
        refreshRazorpayOAuthSingleFlight({
          store: memory.store,
          force,
          dependencies: {
            wait: (ms) =>
              new Promise((resolve) => setTimeout(resolve, Math.min(ms, 2))),
            refresh: async (snapshot) => {
              providerCalls += 1;
              await new Promise((resolve) => setTimeout(resolve, 10));
              return {
                accessToken: 'new-access',
                refreshToken: 'new-refresh',
                accessExpiresAt: new Date(
                  Date.now() + 90 * 24 * 60 * 60 * 1000
                ),
                refreshExpiresAt: new Date(
                  Date.now() + 180 * 24 * 60 * 60 * 1000
                ),
                accountId: snapshot.providerAccountId,
                scope: 'read_write',
                mode: 'test',
              };
            },
          },
        })
      );
      const results = await Promise.all(calls);
      expect(providerCalls).toBe(1);
      expect(
        results.every((result) => result.accessToken === 'new-access')
      ).toBe(true);
    }
  );

  it('recovers an expired stale lease', async () => {
    const snapshot = refreshableSnapshot();
    snapshot.leaseOwner = 'dead-worker';
    snapshot.leaseUntil = new Date(Date.now() - 1_000);
    const memory = inMemoryStore(snapshot);
    await refreshRazorpayOAuthSingleFlight({
      store: memory.store,
      dependencies: {
        refresh: async () => ({
          accessToken: 'recovered',
          refreshToken: 'rotated',
          accessExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
          refreshExpiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
          accountId: 'acc_123',
          scope: 'read_write',
          mode: 'test',
        }),
      },
    });
    expect(memory.read().accessToken).toBe('recovered');
  });

  it('waits for a higher-generation claimant to commit before using it', async () => {
    const memory = inMemoryStore();
    const store: OAuthRefreshStore = {
      ...memory.store,
      async commit(_owner, generation) {
        const claimedByWinner = {
          ...memory.read(),
          generation: generation + 1,
          leaseOwner: 'winner',
          leaseUntil: new Date(Date.now() + 120_000),
        };
        memory.write(claimedByWinner);
        setTimeout(() => {
          memory.write({
            ...claimedByWinner,
            accessToken: 'winner-access',
            refreshToken: 'winner-refresh',
            accessExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
            refreshExpiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
            leaseOwner: null,
            leaseUntil: null,
          });
        }, 5);
        return false;
      },
    };

    const result = await refreshRazorpayOAuthSingleFlight({
      store,
      dependencies: {
        wait: (ms) =>
          new Promise((resolve) => setTimeout(resolve, Math.min(ms, 2))),
        refresh: async (snapshot) => ({
          accessToken: 'uncommitted-access',
          refreshToken: 'uncommitted-refresh',
          accessExpiresAt: new Date(Date.now() + 90 * 86_400_000),
          refreshExpiresAt: new Date(Date.now() + 180 * 86_400_000),
          accountId: snapshot.providerAccountId,
          scope: 'read_write',
          mode: 'test',
        }),
      },
    });

    expect(result.accessToken).toBe('winner-access');
  });

  it('marks an outcome-unknown refresh as reconnect required', async () => {
    const memory = inMemoryStore();
    await expect(
      refreshRazorpayOAuthSingleFlight({
        store: memory.store,
        dependencies: {
          refresh: async () => {
            throw new Error('provider timed out');
          },
        },
      })
    ).rejects.toThrow(/timed out/);
    expect(memory.read().connectionStatus).toBe('reconnect_required');
  });
});
