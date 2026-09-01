import { createAuthService } from './auth-service';
import { createClient } from '@supabase/supabase-js';
import {
  createSecureSessionStorage,
  MOBILE_AUTH_STORAGE_KEY,
  MOBILE_AUTH_STORAGE_KEYS,
} from '../../data/secure-session-storage';
import { createRemoteSessionRevoker } from './session-revocation';
import {
  AUTH_QUIESCENCE_TIMEOUT_MS,
  createAuthRefreshCoordinator,
} from '../../data/auth-refresh-coordinator';

const REDIRECT_URL = 'usefuldesk-agent://auth/callback';
const SYNTHETIC_SUPABASE_URL = 'https://example.supabase.co';
const SYNTHETIC_PUBLIC_KEY = 'sb_publishable_synthetic-public-key';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function encodeJwtPart(value: unknown): string {
  return globalThis
    .btoa(JSON.stringify(value))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function syntheticSession(
  userId: string,
  email: string,
  refreshToken: string,
  signatureCharacter: string
) {
  const expiresAt = Math.floor(Date.now() / 1_000) + 3_600;
  const user = {
    id: userId,
    aud: 'authenticated',
    role: 'authenticated',
    email,
  };
  return {
    access_token: `${encodeJwtPart({ alg: 'HS256', typ: 'JWT' })}.${encodeJwtPart(
      { sub: userId, role: 'authenticated', exp: expiresAt }
    )}.${signatureCharacter.repeat(43)}`,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    expires_in: 3_600,
    token_type: 'bearer',
    user,
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    headers: { get: () => 'application/json' },
  } as unknown as Response;
}

function createRealAuthRaceHarness(refreshResponse: Promise<Response>) {
  const sessionA = syntheticSession(
    '00000000-0000-4000-8000-000000000001',
    'asha@example.test',
    'synthetic-refresh-a',
    'a'
  );
  const sessionB = syntheticSession(
    '00000000-0000-4000-8000-000000000002',
    'bharat@example.test',
    'synthetic-refresh-b',
    'b'
  );
  const values = new Map<string, string>([
    [MOBILE_AUTH_STORAGE_KEY, JSON.stringify(sessionA)],
    [
      `${MOBILE_AUTH_STORAGE_KEY}-user`,
      JSON.stringify({ user: sessionA.user }),
    ],
  ]);
  const sessionStorage = createSecureSessionStorage({
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => {
      values.set(key, value);
    },
    deleteItemAsync: async (key) => {
      values.delete(key);
    },
  });
  const refreshStarted = deferred<void>();
  const passwordStarted = deferred<void>();
  let refreshSignal: AbortSignal | null = null;
  const authFetch = jest.fn(
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.includes('/auth/v1/token?grant_type=refresh_token')) {
        refreshSignal = init?.signal ?? null;
        refreshStarted.resolve(undefined);
        return refreshResponse;
      }
      if (url.includes('/auth/v1/token?grant_type=password')) {
        passwordStarted.resolve(undefined);
        return Promise.resolve(jsonResponse(sessionB));
      }
      return Promise.reject(new Error('Unexpected Auth JS network request'));
    }
  );
  const refreshCoordinator = createAuthRefreshCoordinator(
    authFetch,
    SYNTHETIC_SUPABASE_URL
  );
  const client = createClient(SYNTHETIC_SUPABASE_URL, SYNTHETIC_PUBLIC_KEY, {
    global: { fetch: refreshCoordinator.fetch },
    auth: {
      storage: sessionStorage,
      storageKey: MOBILE_AUTH_STORAGE_KEY,
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
      lock: refreshCoordinator.lock,
      lockAcquireTimeout: AUTH_QUIESCENCE_TIMEOUT_MS,
    },
  });
  const revokeFetch = jest.fn(
    async () => ({ ok: true, status: 200 }) as Response
  );
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
    remoteSession: createRemoteSessionRevoker(revokeFetch, {
      supabaseUrl: SYNTHETIC_SUPABASE_URL,
      supabaseAnonKey: SYNTHETIC_PUBLIC_KEY,
    }),
    refreshCoordinator,
  });

  return {
    authFetch,
    client,
    passwordStarted,
    refreshCoordinator,
    refreshSignal: () => refreshSignal,
    refreshStarted,
    revokeFetch,
    service,
    sessionA,
    sessionB,
    values,
  };
}

function createDependencies() {
  let refreshGeneration = 0;
  let refreshQuiescent = true;
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
    refreshCoordinator: {
      retire: jest.fn(() => {
        refreshGeneration += 1;
        refreshQuiescent = false;
        return {
          generation: refreshGeneration,
          waitForRequests: jest.fn().mockResolvedValue(undefined),
        };
      }),
      complete: jest.fn((retirement: { generation: number }) => {
        if (retirement.generation !== refreshGeneration) return false;
        refreshQuiescent = true;
        return true;
      }),
      isQuiescent: jest.fn(() => refreshQuiescent),
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

  it('owns the exact supported sign-out event immediately before rollback teardown', async () => {
    const dependencies = createDependencies();
    const beforeLocalSignOut = jest.fn();
    dependencies.auth.signInWithPassword.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: new Error('Invalid login credentials'),
    });
    dependencies.auth.signOut.mockImplementationOnce(async () => {
      expect(beforeLocalSignOut).toHaveBeenCalledTimes(1);
      return { error: null };
    });
    const service = createAuthService(dependencies);

    await expect(
      service.signInWithPassword('asha@example.com', 'wrong password', {
        beforeLocalSignOut,
      })
    ).resolves.toEqual({
      status: 'error',
      message: 'Email or password is incorrect.',
    });
    expect(beforeLocalSignOut).toHaveBeenCalledTimes(1);
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
    expect(dependencies.refreshCoordinator.retire).toHaveBeenCalledTimes(1);
    expect(dependencies.refreshCoordinator.complete).toHaveBeenCalledTimes(1);
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
    const refreshCoordinator = createAuthRefreshCoordinator(
      authFetch,
      'https://example.supabase.co'
    );
    const client = createClient(
      'https://example.supabase.co',
      'sb_publishable_synthetic-public-key',
      {
        global: { fetch: refreshCoordinator.fetch },
        auth: {
          storage: sessionStorage,
          storageKey: MOBILE_AUTH_STORAGE_KEY,
          autoRefreshToken: false,
          persistSession: true,
          detectSessionInUrl: false,
          lock: refreshCoordinator.lock,
          lockAcquireTimeout: AUTH_QUIESCENCE_TIMEOUT_MS,
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
      refreshCoordinator,
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

  it('waits for a winning invalid-refresh continuation before replacement authentication', async () => {
    const rawRefresh = deferred<Response>();
    const harness = createRealAuthRaceHarness(rawRefresh.promise);
    await expect(harness.client.auth.getSession()).resolves.toMatchObject({
      data: { session: { access_token: harness.sessionA.access_token } },
    });

    const initialSession = deferred<void>();
    const staleSignedOutStarted = deferred<void>();
    const releaseStaleSignedOut = deferred<void>();
    const events: string[] = [];
    let holdFirstSignedOut = true;
    const subscription = harness.client.auth.onAuthStateChange(
      async (event) => {
        events.push(event);
        if (event === 'INITIAL_SESSION') initialSession.resolve(undefined);
        if (event === 'SIGNED_OUT' && holdFirstSignedOut) {
          holdFirstSignedOut = false;
          staleSignedOutStarted.resolve(undefined);
          await releaseStaleSignedOut.promise;
        }
      }
    ).data.subscription;

    try {
      await initialSession.promise;
      const refresh = harness.client.auth.refreshSession();
      await harness.refreshStarted.promise;
      rawRefresh.resolve(
        jsonResponse(
          {
            error_code: 'refresh_token_not_found',
            message: 'Invalid Refresh Token',
          },
          400
        )
      );
      await staleSignedOutStarted.promise;

      let signOutSettled = false;
      const signOut = harness.service
        .signOut(harness.sessionA.access_token)
        .then((result) => {
          signOutSettled = true;
          return result;
        });
      await Promise.resolve();

      await expect(
        harness.service.signInWithPassword(
          harness.sessionB.user.email,
          'synthetic-password'
        )
      ).resolves.toEqual({
        status: 'error',
        message: 'Secure sign-out is still in progress.',
      });
      expect(signOutSettled).toBe(false);

      releaseStaleSignedOut.resolve(undefined);
      await expect(refresh).resolves.toMatchObject({
        data: { session: null },
        error: { message: 'Invalid Refresh Token' },
      });
      await expect(signOut).resolves.toMatchObject({
        status: 'success',
        localAuth: 'success',
      });
      expect(harness.refreshCoordinator.isQuiescent()).toBe(true);

      await expect(
        harness.service.signInWithPassword(
          harness.sessionB.user.email,
          'synthetic-password'
        )
      ).resolves.toEqual({ status: 'success' });
      const replacementEvent = events.lastIndexOf('SIGNED_IN');
      expect(replacementEvent).toBeGreaterThan(-1);
      expect(events.slice(replacementEvent + 1)).not.toContain('SIGNED_OUT');
      await expect(harness.client.auth.getSession()).resolves.toMatchObject({
        data: { session: { access_token: harness.sessionB.access_token } },
      });
      expect(
        JSON.parse(harness.values.get(MOBILE_AUTH_STORAGE_KEY) ?? '{}')
      ).toMatchObject({ access_token: harness.sessionB.access_token });
    } finally {
      releaseStaleSignedOut.resolve(undefined);
      subscription.unsubscribe();
      await harness.client.auth.stopAutoRefresh();
    }
  });

  it('aborts a never-settling refresh and ignores its late invalid response after user B signs in', async () => {
    const rawRefresh = deferred<Response>();
    const harness = createRealAuthRaceHarness(rawRefresh.promise);
    await expect(harness.client.auth.getSession()).resolves.toMatchObject({
      data: { session: { access_token: harness.sessionA.access_token } },
    });

    const initialSession = deferred<void>();
    const events: string[] = [];
    const subscription = harness.client.auth.onAuthStateChange((event) => {
      events.push(event);
      if (event === 'INITIAL_SESSION') initialSession.resolve(undefined);
    }).data.subscription;

    try {
      await initialSession.promise;
      const refresh = harness.client.auth.refreshSession();
      await harness.refreshStarted.promise;
      const signOut = harness.service.signOut(harness.sessionA.access_token);

      await expect(
        harness.service.signInWithPassword(
          harness.sessionB.user.email,
          'synthetic-password'
        )
      ).resolves.toEqual({
        status: 'error',
        message: 'Secure sign-out is still in progress.',
      });
      await expect(refresh).resolves.toMatchObject({
        data: { session: null },
        error: { message: 'Auth refresh request retired' },
      });
      await expect(signOut).resolves.toMatchObject({
        status: 'success',
        localAuth: 'success',
      });
      expect(harness.refreshSignal()?.aborted).toBe(true);

      await expect(
        harness.service.signInWithPassword(
          harness.sessionB.user.email,
          'synthetic-password'
        )
      ).resolves.toEqual({ status: 'success' });
      await harness.passwordStarted.promise;
      const replacementEvent = events.lastIndexOf('SIGNED_IN');
      expect(replacementEvent).toBeGreaterThan(-1);

      rawRefresh.resolve(
        jsonResponse(
          {
            error_code: 'refresh_token_not_found',
            message: 'Invalid Refresh Token',
          },
          400
        )
      );
      await Promise.resolve();
      await Promise.resolve();

      expect(events.slice(replacementEvent + 1)).not.toContain('SIGNED_OUT');
      await expect(harness.client.auth.getSession()).resolves.toMatchObject({
        data: { session: { access_token: harness.sessionB.access_token } },
      });
      expect(
        JSON.parse(harness.values.get(MOBILE_AUTH_STORAGE_KEY) ?? '{}')
      ).toMatchObject({ access_token: harness.sessionB.access_token });
      expect(harness.client.realtime.accessTokenValue).toBe(
        harness.sessionB.access_token
      );
      expect(harness.authFetch).toHaveBeenCalledTimes(2);
      expect(harness.revokeFetch).toHaveBeenCalledTimes(1);
    } finally {
      subscription.unsubscribe();
      await harness.client.auth.stopAutoRefresh();
    }
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

  it('coalesces concurrent local cleanup into one deterministic operation', async () => {
    const dependencies = createDependencies();
    const localSignOut = deferred<{ error: null }>();
    dependencies.auth.signOut.mockReturnValue(localSignOut.promise);
    const service = createAuthService(dependencies);

    const first = service.purgeLocalSession();
    await Promise.resolve();
    await Promise.resolve();
    const second = service.purgeLocalSession();
    localSignOut.resolve({ error: null });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual({
      localAuth: 'success',
      branchPreference: 'success',
    });
    expect(secondResult).toBe(firstResult);
    expect(dependencies.refreshCoordinator.retire).toHaveBeenCalledTimes(1);
    expect(dependencies.auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
    expect(dependencies.sessionStorage.purge).toHaveBeenCalledTimes(1);
    expect(dependencies.auth.signOut).toHaveBeenCalledTimes(1);
    expect(dependencies.preference.clear).toHaveBeenCalledTimes(1);
  });

  it('publishes cleanup latches before synchronous retirement reentry', async () => {
    const dependencies = createDependencies();
    dependencies.auth.signInWithPassword.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: new Error('Invalid login credentials'),
    });
    const retire =
      dependencies.refreshCoordinator.retire.getMockImplementation();
    if (!retire) throw new Error('Missing retirement fixture.');
    let service!: ReturnType<typeof createAuthService>;
    let retireReentry: ReturnType<typeof service.purgeLocalSession> | null =
      null;
    let preferenceReentry: ReturnType<typeof service.purgeLocalSession> | null =
      null;
    let didReenterRetirement = false;
    let didReenterPreference = false;
    dependencies.refreshCoordinator.retire.mockImplementation(() => {
      if (!didReenterRetirement) {
        didReenterRetirement = true;
        retireReentry = service.purgeLocalSession();
      }
      return retire();
    });
    dependencies.preference.clear.mockImplementation(() => {
      if (!didReenterPreference) {
        didReenterPreference = true;
        preferenceReentry = service.purgeLocalSession();
      }
      return Promise.resolve();
    });
    service = createAuthService(dependencies);

    const authResult = await service.signInWithPassword(
      'asha@example.com',
      'wrong password'
    );
    if (!retireReentry) throw new Error('Retirement did not reenter cleanup.');
    const purgeResult = await retireReentry;

    expect(authResult).toEqual({
      status: 'error',
      message: 'Email or password is incorrect.',
    });
    expect(preferenceReentry).toBe(retireReentry);
    await expect(preferenceReentry).resolves.toBe(purgeResult);
    expect(purgeResult).toEqual({
      localAuth: 'success',
      branchPreference: 'success',
    });
    expect(dependencies.refreshCoordinator.retire).toHaveBeenCalledTimes(1);
    expect(dependencies.auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
    expect(dependencies.sessionStorage.purge).toHaveBeenCalledTimes(1);
    expect(dependencies.auth.signOut).toHaveBeenCalledTimes(1);
    expect(dependencies.preference.clear).toHaveBeenCalledTimes(1);
    expect(dependencies.refreshCoordinator.isQuiescent()).toBe(true);
  });

  it('clears a failed coalesced cleanup so a secure retry can start', async () => {
    const dependencies = createDependencies();
    dependencies.auth.signOut
      .mockRejectedValueOnce(new Error('synthetic teardown failure'))
      .mockResolvedValueOnce({ error: null });
    const service = createAuthService(dependencies);

    await expect(service.purgeLocalSession()).resolves.toEqual({
      localAuth: 'failed',
      branchPreference: 'success',
    });
    await expect(service.purgeLocalSession()).resolves.toEqual({
      localAuth: 'success',
      branchPreference: 'success',
    });
    expect(dependencies.refreshCoordinator.retire).toHaveBeenCalledTimes(2);
    expect(dependencies.auth.signOut).toHaveBeenCalledTimes(2);
    expect(dependencies.preference.clear).toHaveBeenCalledTimes(2);
  });

  it('runs supported in-process teardown only after owned storage is blocked and purged', async () => {
    const dependencies = createDependencies();
    const purge = deferred<{ status: 'success' }>();
    const refreshesRetired = deferred<void>();
    dependencies.sessionStorage.purge.mockReturnValueOnce(purge.promise);
    dependencies.refreshCoordinator.retire.mockReturnValueOnce({
      generation: 1,
      waitForRequests: jest.fn(() => refreshesRetired.promise),
    });
    dependencies.refreshCoordinator.complete.mockReturnValueOnce(true);
    const service = createAuthService(dependencies);

    const pending = service.purgeLocalSession();
    await Promise.resolve();

    expect(dependencies.sessionStorage.purge).toHaveBeenCalledTimes(1);
    expect(dependencies.auth.signOut).not.toHaveBeenCalled();

    purge.resolve({ status: 'success' });
    await Promise.resolve();
    expect(dependencies.auth.signOut).not.toHaveBeenCalled();

    refreshesRetired.resolve(undefined);
    await expect(pending).resolves.toEqual({
      localAuth: 'success',
      branchPreference: 'success',
    });
    expect(dependencies.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(dependencies.refreshCoordinator.complete).toHaveBeenCalledTimes(1);
  });

  it('keeps authentication disabled until refresh quiescence is proven', async () => {
    const dependencies = createDependencies();
    dependencies.refreshCoordinator.isQuiescent.mockReturnValue(false);
    const service = createAuthService(dependencies);

    await expect(
      service.signInWithPassword('asha@example.com', 'correct horse')
    ).resolves.toEqual({
      status: 'error',
      reason: 'cleanup_failed',
      message:
        'Secure sign-out is incomplete. Retry secure sign-out before signing in.',
    });
    await expect(service.signInWithGoogle()).resolves.toMatchObject({
      status: 'error',
      reason: 'cleanup_failed',
    });
    expect(dependencies.sessionStorage.allowWrites).not.toHaveBeenCalled();
    expect(dependencies.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(dependencies.auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it('does not reopen authentication when the supported quiescence teardown fails', async () => {
    const dependencies = createDependencies();
    dependencies.auth.signOut.mockResolvedValueOnce({
      error: new Error('synthetic local teardown failure'),
    });
    const service = createAuthService(dependencies);

    await expect(service.purgeLocalSession()).resolves.toMatchObject({
      localAuth: 'failed',
    });
    expect(dependencies.refreshCoordinator.complete).not.toHaveBeenCalled();
    await expect(
      service.signInWithPassword('asha@example.com', 'correct horse')
    ).resolves.toMatchObject({
      status: 'error',
      reason: 'cleanup_failed',
    });
    expect(dependencies.auth.signInWithPassword).not.toHaveBeenCalled();
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
