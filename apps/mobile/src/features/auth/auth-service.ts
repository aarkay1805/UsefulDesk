import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { mobileEnvironment } from '../../core/env';
import type { SecureSessionStorage } from '../../data/secure-session-storage';
import { mobileSessionStorage, mobileSupabase } from '../../data/supabase';
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
}

export type AuthActionResult =
  { status: 'success' } | { status: 'error'; message: string };

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
  const abandonAuthAttempt = async () => {
    await Promise.allSettled([
      dependencies.auth.stopAutoRefresh(),
      dependencies.sessionStorage.purge(),
    ]);
  };

  const purgeLocalSession = async (): Promise<LocalSessionPurgeResult> => {
    const stopRefresh = dependencies.auth.stopAutoRefresh().then(
      () => true,
      () => false
    );
    const purgeAuth = dependencies.sessionStorage.purge().then(
      (result) => result.status === 'success',
      () => false
    );
    const clearPreference = dependencies.preference.clear().then(
      () => true,
      () => false
    );
    const [refreshStopped, authPurged, preferenceCleared] = await Promise.all([
      stopRefresh,
      purgeAuth,
      clearPreference,
    ]);
    return {
      localAuth: refreshStopped && authPurged ? 'success' : 'failed',
      branchPreference: preferenceCleared ? 'success' : 'failed',
    };
  };

  return {
    async signInWithPassword(
      email: string,
      password: string
    ): Promise<AuthActionResult> {
      dependencies.sessionStorage.allowWrites();
      try {
        const { error } = await dependencies.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (error) {
          await abandonAuthAttempt();
          return { status: 'error', message: passwordErrorMessage(error) };
        }
        await dependencies.auth.startAutoRefresh();
        return { status: 'success' };
      } catch {
        await abandonAuthAttempt();
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
        dependencies.sessionStorage.allowWrites();
        storageEnabled = true;
        const { data, error } = await dependencies.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo, skipBrowserRedirect: true },
        });
        if (error || !data.url) {
          await abandonAuthAttempt();
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
          await abandonAuthAttempt();
          return { status: 'cancelled' };
        }
        if (browserResult.type !== 'success' || !browserResult.url) {
          await abandonAuthAttempt();
          return {
            status: 'error',
            message: 'Google sign-in was not completed.',
          };
        }

        const callback = authorizationCodeFromCallback(browserResult.url);
        if (callback.status === 'error') {
          await abandonAuthAttempt();
          return callback;
        }

        const { error: exchangeError } =
          await dependencies.auth.exchangeCodeForSession(callback.code);
        if (exchangeError) {
          await abandonAuthAttempt();
          return {
            status: 'error',
            message: 'Could not complete Google sign-in. Please try again.',
          };
        }
        await dependencies.auth.startAutoRefresh();
        return { status: 'success' };
      } catch {
        if (storageEnabled) await abandonAuthAttempt();
        return {
          status: 'error',
          message: 'Could not complete Google sign-in. Please try again.',
        };
      }
    },

    purgeLocalSession,

    async signOut(accessToken: string | null): Promise<SignOutResult> {
      const remotePromise = accessToken
        ? dependencies.remoteSession.revoke(accessToken)
        : Promise.resolve({ status: 'not_attempted' as const });
      const localPromise = purgeLocalSession();
      const [remoteResult, local] = await Promise.all([
        remotePromise,
        localPromise,
      ]);
      const remote = remoteResult.status;

      if (local.localAuth === 'failed') {
        return {
          status: 'error',
          remote,
          ...local,
          message:
            local.branchPreference === 'failed'
              ? "Could not fully clear this device's sign-in or branch data."
              : "Could not fully clear this device's sign-in. Restart the app before trying again.",
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
});

export const signInWithPassword = authService.signInWithPassword;
export const signInWithGoogle = authService.signInWithGoogle;
export const purgeLocalSession = authService.purgeLocalSession;
export const signOut = authService.signOut;
