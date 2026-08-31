import { createAuthService } from './auth-service';

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
    }
  );

  it('reports successful remote and local sign-out with one cleanup', async () => {
    const dependencies = createDependencies();
    const service = createAuthService(dependencies);

    await expect(service.signOut()).resolves.toEqual({
      status: 'success',
      remote: 'success',
      cleanup: 'success',
    });
    expect(dependencies.selectedBranch.set).toHaveBeenCalledTimes(1);
    expect(dependencies.selectedBranch.set).toHaveBeenCalledWith(null);
    expect(dependencies.preference.clear).toHaveBeenCalledTimes(1);
  });

  it('distinguishes remote sign-out failure from successful local cleanup', async () => {
    const dependencies = createDependencies();
    dependencies.auth.signOut.mockResolvedValueOnce({
      error: new Error('network request failed'),
    });
    const service = createAuthService(dependencies);

    await expect(service.signOut()).resolves.toEqual({
      status: 'error',
      remote: 'failed',
      cleanup: 'success',
      message:
        'Signed out on this device, but the remote session could not be closed.',
    });
    expect(dependencies.selectedBranch.set).toHaveBeenCalledTimes(1);
    expect(dependencies.preference.clear).toHaveBeenCalledTimes(1);
  });

  it('distinguishes local cleanup failure from successful remote sign-out', async () => {
    const dependencies = createDependencies();
    dependencies.preference.clear.mockRejectedValueOnce(
      new Error('keystore secret failure')
    );
    const service = createAuthService(dependencies);

    await expect(service.signOut()).resolves.toEqual({
      status: 'error',
      remote: 'success',
      cleanup: 'failed',
      message: 'Signed out, but local branch data could not be cleared.',
    });
    expect(dependencies.selectedBranch.set).toHaveBeenCalledTimes(1);
    expect(dependencies.preference.clear).toHaveBeenCalledTimes(1);
  });

  it('reports combined remote and local sign-out failure safely', async () => {
    const dependencies = createDependencies();
    dependencies.auth.signOut.mockRejectedValueOnce(
      new Error('remote infrastructure secret')
    );
    dependencies.preference.clear.mockRejectedValueOnce(
      new Error('keystore secret failure')
    );
    const service = createAuthService(dependencies);

    await expect(service.signOut()).resolves.toEqual({
      status: 'error',
      remote: 'failed',
      cleanup: 'failed',
      message: 'Could not close the remote session or clear local branch data.',
    });
    expect(dependencies.selectedBranch.set).toHaveBeenCalledTimes(1);
    expect(dependencies.preference.clear).toHaveBeenCalledTimes(1);
  });
});
