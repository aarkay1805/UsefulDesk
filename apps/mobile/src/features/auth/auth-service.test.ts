import { createAuthService } from './auth-service';
import { createClient } from '@supabase/supabase-js';
import {
  createSecureSessionStorage,
  MOBILE_AUTH_STORAGE_KEY,
  MOBILE_AUTH_STORAGE_KEYS,
} from '../../data/secure-session-storage';
import { createRemoteSessionRevoker } from './session-revocation';

const REDIRECT_URL = 'usefuldesk-agent://auth/callback';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function createDependencies() {
  return {
    auth: {
      signInWithPassword: jest.fn().mockResolvedValue({
        data: {
          session: { access_token: 'session-token' },
          user: { id: 'user-1' },
        },
        error: null,
      }),
      signInWithOAuth: jest.fn().mockResolvedValue({
        data: {
          provider: 'google',
          url: 'https://accounts.example.test/oauth',
        },
        error: null,
      }),
      exchangeCodeForSession: jest.fn().mockResolvedValue({
        data: {
          session: { access_token: 'session-token' },
          user: { id: 'user-1' },
        },
        error: null,
      }),
      startAutoRefresh: jest.fn().mockResolvedValue(undefined),
      stopAutoRefresh: jest.fn().mockResolvedValue(undefined),
      signOut: jest.fn().mockResolvedValue({ error: null }),
    },
    linking: {
      createURL: jest.fn().mockReturnValue(REDIRECT_URL),
    },
    browser: {
      openAuthSessionAsync: jest.fn().mockResolvedValue({
        type: 'success' as const,
        url: `${REDIRECT_URL}?code=authorization-code`,
      }),
    },
    selectedBranch: {
      get: jest.fn().mockReturnValue('branch-1'),
      set: jest.fn(),
    },
    preference: {
      get: jest.fn().mockResolvedValue('branch-1'),
      set: jest.fn().mockResolvedValue(undefined),
      clear: jest.fn().mockResolvedValue(undefined),
    },
    sessionStorage: {
      getItem: jest.fn().mockResolvedValue(null),
      setItem: jest.fn().mockResolvedValue(undefined),
      removeItem: jest.fn().mockResolvedValue(undefined),
      allowWrites: jest.fn().mockReturnValue(true),
      purge: jest.fn().mockResolvedValue({ status: 'success' }),
    },
    remoteSession: {
      revoke: jest.fn().mockResolvedValue({ status: 'success' }),
    },
  };
}

describe('createAuthService', () => {
  it('normalizes an existing user email before password sign-in', async () => {
    const dependencies = createDependencies();
    const service = createAuthService(dependencies);

    await expect(
      service.signInWithPassword('  ASHA@EXAMPLE.COM  ', 'correct horse')
    ).resolves.toEqual({ status: 'success' });
    expect(dependencies.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'asha@example.com',
      password: 'correct horse',
    });
    expect(dependencies.sessionStorage.allowWrites).toHaveBeenCalledTimes(1);
    expect(dependencies.auth.startAutoRefresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Invalid login credentials', 'Email or password is incorrect.'],
    [
      'Email not confirmed',
      'This account is not ready to sign in. Contact your administrator.',
    ],
    [
      'database connection details: postgres://secret',
      'Could not sign in. Please try again.',
    ],
  ])(
    'returns a safe password error for %s',
    async (authMessage, displayMessage) => {
      const dependencies = createDependencies();
      dependencies.auth.signInWithPassword.mockResolvedValueOnce({
        data: { session: null, user: null },
        error: new Error(authMessage),
      });
      const service = createAuthService(dependencies);

      await expect(
        service.signInWithPassword('asha@example.com', 'wrong password')
      ).resolves.toEqual({ status: 'error', message: displayMessage });
      expect(dependencies.sessionStorage.purge).toHaveBeenCalledTimes(1);
    }
  );

  it('surfaces a failed auth-attempt rollback as non-authenticating cleanup failure', async () => {
    const dependencies = createDependencies();
    dependencies.auth.signInWithPassword.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: new Error('Invalid login credentials'),
    });
    dependencies.sessionStorage.purge.mockResolvedValueOnce({
      status: 'failed',
    });
    const service = createAuthService(dependencies);

    await expect(
      service.signInWithPassword('asha@example.com', 'wrong password')
    ).resolves.toEqual({
      status: 'error',
      reason: 'cleanup_failed',
      message:
        'Secure sign-out is incomplete. Retry secure sign-out before signing in.',
    });
  });

  it('opens the exact PKCE callback and exchanges only its authorization code', async () => {
    const dependencies = createDependencies();
    const service = createAuthService(dependencies);

    await expect(service.signInWithGoogle()).resolves.toEqual({
      status: 'success',
    });
    expect(dependencies.linking.createURL).toHaveBeenCalledWith(
      'auth/callback',
      { scheme: 'usefuldesk-agent' }
    );
    expect(dependencies.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: REDIRECT_URL, skipBrowserRedirect: true },
    });
    expect(dependencies.browser.openAuthSessionAsync).toHaveBeenCalledWith(
      'https://accounts.example.test/oauth',
      REDIRECT_URL
    );
    expect(dependencies.auth.exchangeCodeForSession).toHaveBeenCalledWith(
      'authorization-code'
    );
    expect(dependencies.sessionStorage.allowWrites).toHaveBeenCalledTimes(1);
    expect(dependencies.auth.startAutoRefresh).toHaveBeenCalledTimes(1);
  });

  it('refuses to start OAuth when Linking does not produce the exact callback', async () => {
    const dependencies = createDependencies();
    dependencies.linking.createURL.mockReturnValueOnce(
      'exp://localhost/--/auth/callback'
    );
    const service = createAuthService(dependencies);

    await expect(service.signInWithGoogle()).resolves.toEqual({
      status: 'error',
      message: 'Could not start Google sign-in. Please try again.',
    });
    expect(dependencies.sessionStorage.allowWrites).not.toHaveBeenCalled();
    expect(dependencies.auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it('uses supported local teardown when a session was acquired before sign-in setup failed', async () => {
    const dependencies = createDependencies();
    dependencies.auth.startAutoRefresh.mockRejectedValueOnce(
      new Error('platform refresh setup failed')
    );
    const service = createAuthService(dependencies);

    await expect(
      service.signInWithPassword('asha@example.com', 'correct horse')
    ).resolves.toEqual({
      status: 'error',
      message: 'Could not sign in. Please try again.',
    });
    expect(dependencies.sessionStorage.purge).toHaveBeenCalledTimes(1);
    expect(dependencies.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it.each(['cancel', 'dismiss'])(
    '%s is a neutral Google result',
    async (type) => {
      const dependencies = createDependencies();
      dependencies.browser.openAuthSessionAsync.mockResolvedValueOnce({ type });
      const service = createAuthService(dependencies);

      await expect(service.signInWithGoogle()).resolves.toEqual({
        status: 'cancelled',
      });
      expect(dependencies.auth.exchangeCodeForSession).not.toHaveBeenCalled();
      expect(dependencies.sessionStorage.purge).toHaveBeenCalledTimes(1);
    }
  );

  it('does not report Google cancellation as neutral when secure rollback fails', async () => {
    const dependencies = createDependencies();
    dependencies.browser.openAuthSessionAsync.mockResolvedValueOnce({
      type: 'cancel',
    });
    dependencies.sessionStorage.purge.mockResolvedValueOnce({
      status: 'failed',
    });
    const service = createAuthService(dependencies);

    await expect(service.signInWithGoogle()).resolves.toEqual({
      status: 'error',
      reason: 'cleanup_failed',
      message:
        'Secure sign-out is incomplete. Retry secure sign-out before signing in.',
    });
  });

  it('reports successful remote, local-auth, and branch cleanup', async () => {
    const dependencies = createDependencies();
    const service = createAuthService(dependencies);

    await expect(service.signOut('synthetic-access-token')).resolves.toEqual({
      status: 'success',
      remote: 'success',
      localAuth: 'success',
      branchPreference: 'success',
    });
    expect(dependencies.remoteSession.revoke).toHaveBeenCalledWith(
      'synthetic-access-token'
    );
    expect(dependencies.auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
    expect(dependencies.sessionStorage.purge).toHaveBeenCalledTimes(1);
    expect(dependencies.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(dependencies.selectedBranch.set).not.toHaveBeenCalled();
    expect(dependencies.preference.clear).toHaveBeenCalledTimes(1);
  });

  it('distinguishes remote sign-out failure from successful local cleanup', async () => {
    const dependencies = createDependencies();
    dependencies.remoteSession.revoke.mockResolvedValueOnce({
      status: 'failed',
      reason: 'unavailable',
    });
    const service = createAuthService(dependencies);

    await expect(service.signOut('synthetic-access-token')).resolves.toEqual({
      status: 'error',
      remote: 'failed',
      localAuth: 'success',
      branchPreference: 'success',
      message:
        'Signed out on this device, but the remote session could not be closed.',
    });
    expect(dependencies.selectedBranch.set).not.toHaveBeenCalled();
    expect(dependencies.preference.clear).toHaveBeenCalledTimes(1);
  });

  it('distinguishes branch-preference cleanup failure from successful local auth purge', async () => {
    const dependencies = createDependencies();
    dependencies.preference.clear.mockRejectedValueOnce(
      new Error('keystore secret failure')
    );
    const service = createAuthService(dependencies);

    await expect(service.signOut('synthetic-access-token')).resolves.toEqual({
      status: 'error',
      remote: 'success',
      localAuth: 'success',
      branchPreference: 'failed',
      message: 'Signed out, but local branch data could not be cleared.',
    });
    expect(dependencies.selectedBranch.set).not.toHaveBeenCalled();
    expect(dependencies.preference.clear).toHaveBeenCalledTimes(1);
  });

  it('reports a failed local auth purge separately without exposing diagnostics', async () => {
    const dependencies = createDependencies();
    dependencies.sessionStorage.purge.mockResolvedValueOnce({
      status: 'failed',
    });
    const service = createAuthService(dependencies);

    await expect(service.signOut('synthetic-access-token')).resolves.toEqual({
      status: 'error',
      remote: 'success',
      localAuth: 'failed',
      branchPreference: 'success',
      message:
        'Secure sign-out is incomplete. Retry secure sign-out before signing in.',
    });
    expect(dependencies.selectedBranch.set).not.toHaveBeenCalled();
    expect(dependencies.preference.clear).toHaveBeenCalledTimes(1);
  });

  it('purges local auth and branch state before an offline remote attempt settles', async () => {
    const dependencies = createDependencies();
    let settleRemote!: (value: {
      status: 'failed';
      reason: 'unavailable';
    }) => void;
    dependencies.remoteSession.revoke.mockReturnValueOnce(
      new Promise((resolve) => {
        settleRemote = resolve;
      })
    );
    const service = createAuthService(dependencies);

    const pending = service.signOut('synthetic-access-token');
    await Promise.resolve();

    expect(dependencies.auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
    expect(dependencies.sessionStorage.purge).toHaveBeenCalledTimes(1);
    expect(dependencies.selectedBranch.set).not.toHaveBeenCalled();
    expect(dependencies.preference.clear).toHaveBeenCalledTimes(1);

    settleRemote({ status: 'failed', reason: 'unavailable' });
    await expect(pending).resolves.toMatchObject({
      remote: 'failed',
      localAuth: 'success',
      branchPreference: 'success',
    });
  });

  it('cannot cold-restore the configured Supabase or PKCE material after offline sign-out', async () => {
    const values = new Map<string, string>();
    const storedUser = {
      id: '00000000-0000-4000-8000-000000000001',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'asha@example.test',
    };
    values.set(
      MOBILE_AUTH_STORAGE_KEY,
      JSON.stringify({
        access_token: 'synthetic-old-access-token',
        refresh_token: 'synthetic-old-refresh-token',
        expires_at: Math.floor(Date.now() / 1_000) + 3_600,
        user: storedUser,
      })
    );
    values.set(
      `${MOBILE_AUTH_STORAGE_KEY}-code-verifier`,
      JSON.stringify('synthetic-old-code-verifier')
    );
    values.set(
      `${MOBILE_AUTH_STORAGE_KEY}-user`,
      JSON.stringify({ user: storedUser })
    );
    const adapter = {
      getItemAsync: async (key: string) => values.get(key) ?? null,
      setItemAsync: async (key: string, value: string) => {
        values.set(key, value);
      },
      deleteItemAsync: async (key: string) => {
        throw new Error(`synthetic delete failure for ${key}`);
      },
    };
    const mockedDependencies = createDependencies();
    const dependencies = {
      ...mockedDependencies,
      sessionStorage: createSecureSessionStorage(adapter),
    };
    dependencies.remoteSession.revoke.mockResolvedValueOnce({
      status: 'failed',
      reason: 'unavailable',
    });
    const service = createAuthService(dependencies);

    await service.signOut('synthetic-access-token');

    const coldStorage = createSecureSessionStorage(adapter);
    const coldClient = createClient(
      'https://example.supabase.co',
      'sb_publishable_synthetic-public-key',
      {
        auth: {
          storage: coldStorage,
          storageKey: MOBILE_AUTH_STORAGE_KEY,
          autoRefreshToken: false,
          persistSession: true,
          detectSessionInUrl: false,
        },
      }
    );
    await expect(coldClient.auth.getSession()).resolves.toMatchObject({
      data: { session: null },
      error: null,
    });
    expect([...values.entries()]).toEqual(
      MOBILE_AUTH_STORAGE_KEYS.map((key) => [key, 'null'])
    );
  });

  it('uses the real Auth JS local teardown without a second request and discards an in-flight refresh', async () => {
    const values = new Map<string, string>();
    const now = Math.floor(Date.now() / 1_000);
    const encode = (value: unknown) =>
      globalThis
        .btoa(JSON.stringify(value))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    const oldAccessToken = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
      sub: '00000000-0000-4000-8000-000000000001',
      role: 'authenticated',
      exp: now + 3_600,
    })}.${'a'.repeat(43)}`;
    const rotatedAccessToken = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(
      {
        sub: '00000000-0000-4000-8000-000000000001',
        role: 'authenticated',
        exp: now + 7_200,
      }
    )}.${'b'.repeat(43)}`;
    const storedUser = {
      id: '00000000-0000-4000-8000-000000000001',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'asha@example.test',
    };
    values.set(
      MOBILE_AUTH_STORAGE_KEY,
      JSON.stringify({
        access_token: oldAccessToken,
        refresh_token: 'synthetic-old-refresh-token',
        expires_at: now + 3_600,
        expires_in: 3_600,
        token_type: 'bearer',
        user: storedUser,
      })
    );
    values.set(
      `${MOBILE_AUTH_STORAGE_KEY}-user`,
      JSON.stringify({ user: storedUser })
    );
    const adapter = {
      getItemAsync: async (key: string) => values.get(key) ?? null,
      setItemAsync: async (key: string, value: string) => {
        values.set(key, value);
      },
      deleteItemAsync: async (key: string) => {
        values.delete(key);
      },
    };
    const sessionStorage = createSecureSessionStorage(adapter);
    const refreshStarted = deferred<void>();
    const refreshResponse = deferred<Response>();
    const authRequests: string[] = [];
    const authFetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      authRequests.push(url);
      if (!url.includes('/auth/v1/token?grant_type=refresh_token')) {
        throw new Error('Unexpected Auth JS network request');
      }
      refreshStarted.resolve(undefined);
      return refreshResponse.promise;
    });
    const client = createClient(
      'https://example.supabase.co',
      'sb_publishable_synthetic-public-key',
      {
        global: { fetch: authFetch },
        auth: {
          storage: sessionStorage,
          storageKey: MOBILE_AUTH_STORAGE_KEY,
          autoRefreshToken: false,
          persistSession: true,
          detectSessionInUrl: false,
        },
      }
    );
    await expect(client.auth.getSession()).resolves.toMatchObject({
      data: { session: { access_token: oldAccessToken } },
      error: null,
    });
    await client.realtime.setAuth(oldAccessToken);

    const events: string[] = [];
    const subscription = client.auth.onAuthStateChange((event) => {
      events.push(event);
    }).data.subscription;
    const revokeFetch = jest.fn(
      async (_input: RequestInfo | URL) => ({ ok: true }) as Response
    );
    const remoteSession = createRemoteSessionRevoker(revokeFetch, {
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'sb_publishable_synthetic-public-key',
    });
    const service = createAuthService({
      auth: client.auth,
      linking: { createURL: jest.fn().mockReturnValue(REDIRECT_URL) },
      browser: {
        openAuthSessionAsync: jest
          .fn()
          .mockResolvedValue({ type: 'cancel' as const }),
      },
      preference: {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
        clear: jest.fn().mockResolvedValue(undefined),
      },
      sessionStorage,
      remoteSession,
    });

    const refresh = client.auth.refreshSession();
    await refreshStarted.promise;
    const signOut = service.signOut(oldAccessToken);
    await Promise.resolve();
    await Promise.resolve();
    expect(revokeFetch).toHaveBeenCalledTimes(1);

    refreshResponse.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: rotatedAccessToken,
        refresh_token: 'synthetic-rotated-refresh-token',
        expires_in: 3_600,
        token_type: 'bearer',
        user: storedUser,
      }),
      headers: { get: () => 'application/json' },
    } as unknown as Response);

    await expect(refresh).resolves.toMatchObject({
      data: { session: null },
    });
    await expect(signOut).resolves.toEqual({
      status: 'success',
      remote: 'success',
      localAuth: 'success',
      branchPreference: 'success',
    });
    expect(authRequests).toHaveLength(1);
    expect(authRequests[0]).toContain(
      '/auth/v1/token?grant_type=refresh_token'
    );
    expect(revokeFetch.mock.calls[0]?.[0]).toBe(
      'https://example.supabase.co/auth/v1/logout?scope=global'
    );
    expect(events).toContain('SIGNED_OUT');
    expect(events).not.toContain('TOKEN_REFRESHED');
    await expect(client.auth.getSession()).resolves.toMatchObject({
      data: { session: null },
      error: null,
    });
    expect(client.realtime.accessTokenValue).toBe(
      'sb_publishable_synthetic-public-key'
    );
    expect(client.realtime.accessTokenValue).not.toBe(oldAccessToken);
    expect(client.realtime.accessTokenValue).not.toBe(rotatedAccessToken);
    expect(values.has(MOBILE_AUTH_STORAGE_KEY)).toBe(false);
    subscription.unsubscribe();
  });

  it('supports idempotent local-only cleanup for an external signed-out event', async () => {
    const dependencies = createDependencies();
    const service = createAuthService(dependencies);

    await expect(service.purgeLocalSession()).resolves.toEqual({
      localAuth: 'success',
      branchPreference: 'success',
    });
    expect(dependencies.remoteSession.revoke).not.toHaveBeenCalled();
    expect(dependencies.auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
    expect(dependencies.sessionStorage.purge).toHaveBeenCalledTimes(1);
    expect(dependencies.preference.clear).toHaveBeenCalledTimes(1);
  });

  it('runs supported in-process teardown only after owned storage is blocked and purged', async () => {
    const dependencies = createDependencies();
    const purge = deferred<{ status: 'success' }>();
    dependencies.sessionStorage.purge.mockReturnValueOnce(purge.promise);
    const service = createAuthService(dependencies);

    const pending = service.purgeLocalSession();
    await Promise.resolve();

    expect(dependencies.sessionStorage.purge).toHaveBeenCalledTimes(1);
    expect(dependencies.auth.signOut).not.toHaveBeenCalled();

    purge.resolve({ status: 'success' });
    await expect(pending).resolves.toEqual({
      localAuth: 'success',
      branchPreference: 'success',
    });
    expect(dependencies.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('keeps password and Google authentication disabled after unverifiable cleanup', async () => {
    const dependencies = createDependencies();
    dependencies.sessionStorage.allowWrites.mockReturnValue(false);
    const service = createAuthService(dependencies);

    await expect(
      service.signInWithPassword('asha@example.com', 'correct horse')
    ).resolves.toEqual({
      status: 'error',
      reason: 'cleanup_failed',
      message:
        'Secure sign-out is incomplete. Retry secure sign-out before signing in.',
    });
    await expect(service.signInWithGoogle()).resolves.toEqual({
      status: 'error',
      reason: 'cleanup_failed',
      message:
        'Secure sign-out is incomplete. Retry secure sign-out before signing in.',
    });
    expect(dependencies.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(dependencies.auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it('keeps new authentication unavailable until local teardown and remote revocation are terminal', async () => {
    const dependencies = createDependencies();
    const remote = deferred<{
      status: 'failed';
      reason: 'timeout';
    }>();
    dependencies.remoteSession.revoke.mockReturnValueOnce(remote.promise);
    const service = createAuthService(dependencies);

    const signOut = service.signOut('synthetic-access-token');
    await Promise.resolve();
    await Promise.resolve();

    await expect(
      service.signInWithPassword('asha@example.com', 'correct horse')
    ).resolves.toEqual({
      status: 'error',
      message: 'Secure sign-out is still in progress.',
    });
    await expect(service.signInWithGoogle()).resolves.toEqual({
      status: 'error',
      message: 'Secure sign-out is still in progress.',
    });
    expect(dependencies.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(dependencies.auth.signInWithOAuth).not.toHaveBeenCalled();

    remote.resolve({ status: 'failed', reason: 'timeout' });
    await expect(signOut).resolves.toMatchObject({
      status: 'error',
      remote: 'failed',
      localAuth: 'success',
    });
    await expect(
      service.signInWithPassword('asha@example.com', 'correct horse')
    ).resolves.toEqual({ status: 'success' });
  });
});
