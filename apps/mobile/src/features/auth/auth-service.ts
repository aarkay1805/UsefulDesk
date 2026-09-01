import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { mobileEnvironment } from '../../core/env';
import type { AuthRefreshLifecycle } from '../../data/auth-refresh-coordinator';
import type { SecureSessionStorage } from '../../data/secure-session-storage';
import {
  mobileAuthRefreshCoordinator,
  mobileSessionStorage,
  mobileSupabase,
} from '../../data/supabase';
import { branchPreference, type BranchPreference } from './branch-preference';
import { authorizationCodeFromCallback } from './google-callback';
import {
  createRemoteSessionRevoker,
  type RemoteSessionRevoker,
} from './session-revocation';

type AuthError = { message: string };
const GOOGLE_REDIRECT_URL = 'usefuldesk-agent://auth/callback';

interface AuthAdapter {
  signInWithPassword(credentials: {
    email: string;
    password: string;
  }): Promise<{ error: AuthError | null }>;
  signInWithOAuth(input: {
    provider: 'google';
    options: { redirectTo: string; skipBrowserRedirect: true };
  }): Promise<{ data: { url: string | null }; error: AuthError | null }>;
  exchangeCodeForSession(code: string): Promise<{ error: AuthError | null }>;
  startAutoRefresh(): Promise<void>;
  stopAutoRefresh(): Promise<void>;
  signOut(options: { scope: 'local' }): Promise<{ error: AuthError | null }>;
}

interface LinkingAdapter {
  createURL(path: string, options: { scheme: string }): string;
}

interface BrowserAdapter {
  openAuthSessionAsync(
    url: string,
    redirectUrl: string
  ): Promise<{ type: string; url?: string }>;
}

export interface AuthServiceDependencies {
  auth: AuthAdapter;
  linking: LinkingAdapter;
  browser: BrowserAdapter;
  preference: BranchPreference;
  sessionStorage: SecureSessionStorage;
  remoteSession: RemoteSessionRevoker;
  refreshCoordinator: AuthRefreshLifecycle;
}

export type AuthActionResult =
  | { status: 'success' }
  | {
      status: 'error';
      message: string;
      reason?: 'cleanup_failed';
    };

export type GoogleAuthResult = AuthActionResult | { status: 'cancelled' };

export type LocalSessionPurgeResult = {
  localAuth: 'success' | 'failed';
  branchPreference: 'success' | 'failed';
};

export type SignOutResult =
  | (LocalSessionPurgeResult & {
      status: 'success';
      remote: 'success' | 'not_attempted';
    })
  | (LocalSessionPurgeResult & {
      status: 'error';
      remote: 'success' | 'failed' | 'not_attempted';
      message: string;
    });

function passwordErrorMessage(error: AuthError): string {
  const normalized = error.message.toLowerCase();
  if (normalized.includes('invalid login credentials')) {
    return 'Email or password is incorrect.';
  }
  if (normalized.includes('email not confirmed')) {
    return 'This account is not ready to sign in. Contact your administrator.';
  }
  if (normalized.includes('rate limit') || normalized.includes('too many')) {
    return 'Too many sign-in attempts. Please try again later.';
  }
  return 'Could not sign in. Please try again.';
}

export function createAuthService(dependencies: AuthServiceDependencies) {
  let signOutPending = false;

  const cleanupFailure = (): AuthActionResult => ({
    status: 'error',
    reason: 'cleanup_failed',
    message:
      'Secure sign-out is incomplete. Retry secure sign-out before signing in.',
  });

  const enableAuthStorage = (): AuthActionResult | null => {
    if (signOutPending) {
      return {
        status: 'error',
        message: 'Secure sign-out is still in progress.',
      };
    }
    if (!dependencies.refreshCoordinator.isQuiescent()) {
      return cleanupFailure();
    }
    if (!dependencies.sessionStorage.allowWrites()) {
      return cleanupFailure();
    }
    return null;
  };

  const teardownLocalAuth = async (): Promise<boolean> => {
    const retirement = dependencies.refreshCoordinator.retire();
    const stopRefresh = (async () => {
      try {
        await dependencies.auth.stopAutoRefresh();
        return true;
      } catch {
        return false;
      }
    })();
    const purgeStorage = (async () => {
      try {
        return (await dependencies.sessionStorage.purge()).status === 'success';
      } catch {
        return false;
      }
    })();
    const waitForRefreshes = retirement.waitForRequests().then(
      () => true,
      () => false
    );
    const [refreshStopped, authPurged, refreshesRetired] = await Promise.all([
      stopRefresh,
      purgeStorage,
      waitForRefreshes,
    ]);
    let inProcessTeardown = false;
    try {
      inProcessTeardown =
        (await dependencies.auth.signOut({ scope: 'local' })).error === null;
    } catch {
      inProcessTeardown = false;
    }
    if (
      !refreshStopped ||
      !authPurged ||
      !refreshesRetired ||
      !inProcessTeardown
    ) {
      return false;
    }
    return dependencies.refreshCoordinator.complete(retirement);
  };

  const abandonAuthAttempt = async (): Promise<boolean> => teardownLocalAuth();

  const purgeLocalSession = async (): Promise<LocalSessionPurgeResult> => {
    const clearPreference = dependencies.preference.clear().then(
      () => true,
      () => false
    );
    const [authPurged, preferenceCleared] = await Promise.all([
      teardownLocalAuth(),
      clearPreference,
    ]);
    return {
      localAuth: authPurged ? 'success' : 'failed',
      branchPreference: preferenceCleared ? 'success' : 'failed',
    };
  };

  return {
    async signInWithPassword(
      email: string,
      password: string
    ): Promise<AuthActionResult> {
      const storageError = enableAuthStorage();
      if (storageError) return storageError;
      try {
        const { error } = await dependencies.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (error) {
          if (!(await abandonAuthAttempt())) return cleanupFailure();
          return { status: 'error', message: passwordErrorMessage(error) };
        }
        await dependencies.auth.startAutoRefresh();
        return { status: 'success' };
      } catch {
        if (!(await abandonAuthAttempt())) {
          return cleanupFailure();
        }
        return {
          status: 'error',
          message: 'Could not sign in. Please try again.',
        };
      }
    },

    async signInWithGoogle(): Promise<GoogleAuthResult> {
      let storageEnabled = false;
      try {
        const redirectTo = dependencies.linking.createURL('auth/callback', {
          scheme: 'usefuldesk-agent',
        });
        if (redirectTo !== GOOGLE_REDIRECT_URL) {
          return {
            status: 'error',
            message: 'Could not start Google sign-in. Please try again.',
          };
        }
        const storageError = enableAuthStorage();
        if (storageError) return storageError;
        storageEnabled = true;
        const { data, error } = await dependencies.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo, skipBrowserRedirect: true },
        });
        if (error || !data.url) {
          if (!(await abandonAuthAttempt())) return cleanupFailure();
          return {
            status: 'error',
            message: 'Could not start Google sign-in. Please try again.',
          };
        }

        const browserResult = await dependencies.browser.openAuthSessionAsync(
          data.url,
          redirectTo
        );
        if (
          browserResult.type === 'cancel' ||
          browserResult.type === 'dismiss'
        ) {
          if (!(await abandonAuthAttempt())) return cleanupFailure();
          return { status: 'cancelled' };
        }
        if (browserResult.type !== 'success' || !browserResult.url) {
          if (!(await abandonAuthAttempt())) return cleanupFailure();
          return {
            status: 'error',
            message: 'Google sign-in was not completed.',
          };
        }

        const callback = authorizationCodeFromCallback(browserResult.url);
        if (callback.status === 'error') {
          if (!(await abandonAuthAttempt())) return cleanupFailure();
          return callback;
        }

        const { error: exchangeError } =
          await dependencies.auth.exchangeCodeForSession(callback.code);
        if (exchangeError) {
          if (!(await abandonAuthAttempt())) return cleanupFailure();
          return {
            status: 'error',
            message: 'Could not complete Google sign-in. Please try again.',
          };
        }
        await dependencies.auth.startAutoRefresh();
        return { status: 'success' };
      } catch {
        if (storageEnabled && !(await abandonAuthAttempt())) {
          return cleanupFailure();
        }
        return {
          status: 'error',
          message: 'Could not complete Google sign-in. Please try again.',
        };
      }
    },

    purgeLocalSession,

    async signOut(accessToken: string | null): Promise<SignOutResult> {
      signOutPending = true;
      let remoteResult:
        | Awaited<ReturnType<RemoteSessionRevoker['revoke']>>
        | { status: 'not_attempted' };
      let local: LocalSessionPurgeResult;
      try {
        const remotePromise = accessToken
          ? dependencies.remoteSession.revoke(accessToken)
          : Promise.resolve({ status: 'not_attempted' as const });
        [remoteResult, local] = await Promise.all([
          remotePromise,
          purgeLocalSession(),
        ]);
      } finally {
        signOutPending = false;
      }
      const remote = remoteResult.status;

      if (local.localAuth === 'failed') {
        return {
          status: 'error',
          remote,
          ...local,
          message:
            'Secure sign-out is incomplete. Retry secure sign-out before signing in.',
        };
      }
      if (local.branchPreference === 'failed') {
        return {
          status: 'error',
          remote,
          ...local,
          message: 'Signed out, but local branch data could not be cleared.',
        };
      }
      if (remote === 'failed') {
        return {
          status: 'error',
          remote,
          ...local,
          message:
            'Signed out on this device, but the remote session could not be closed.',
        };
      }
      return { status: 'success', remote, ...local };
    },
  };
}

const authService = createAuthService({
  auth: mobileSupabase.auth,
  linking: Linking,
  browser: WebBrowser,
  preference: branchPreference,
  sessionStorage: mobileSessionStorage,
  remoteSession: createRemoteSessionRevoker(fetch, mobileEnvironment),
  refreshCoordinator: mobileAuthRefreshCoordinator,
});

export const signInWithPassword = authService.signInWithPassword;
export const signInWithGoogle = authService.signInWithGoogle;
export const purgeLocalSession = authService.purgeLocalSession;
export const signOut = authService.signOut;
