import { createAuthService } from './auth-service';
import { createClient } from '@supabase/supabase-js';
import {
  createSecureSessionStorage,
  MOBILE_AUTH_STORAGE_KEY,
} from '../../data/secure-session-storage';

const REDIRECT_URL = 'usefuldesk-agent://auth/callback';

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
      allowWrites: jest.fn(),
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
    expect(dependencies.auth.signInWithOAuth).not.toHaveBeenCalled();
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
    expect(dependencies.selectedBranch.set).not.toHaveBeenCalled();
    expect(dependencies.preference.clear).toHaveBeenCalledTimes(1);
  });

  it('distinguishes remote sign-out failure from successful local cleanup', async () => {
    const dependencies = createDependencies();
    dependencies.remoteSession.revoke.mockResolvedValueOnce({
      status: 'failed',
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
        "Could not fully clear this device's sign-in. Restart the app before trying again.",
    });
    expect(dependencies.selectedBranch.set).not.toHaveBeenCalled();
    expect(dependencies.preference.clear).toHaveBeenCalledTimes(1);
  });

  it('purges local auth and branch state before an offline remote attempt settles', async () => {
    const dependencies = createDependencies();
    let settleRemote!: (value: { status: 'failed' }) => void;
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

    settleRemote({ status: 'failed' });
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
        values.delete(key);
      },
    };
    const mockedDependencies = createDependencies();
    const dependencies = {
      ...mockedDependencies,
      sessionStorage: createSecureSessionStorage(adapter),
    };
    dependencies.remoteSession.revoke.mockResolvedValueOnce({
      status: 'failed',
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
    expect(values.size).toBe(0);
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
});
