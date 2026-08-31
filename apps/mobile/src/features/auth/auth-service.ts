import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { mobileSupabase, selectedBranchRef } from '../../data/supabase';
import { branchPreference, type BranchPreference } from './branch-preference';
import { authorizationCodeFromCallback } from './google-callback';

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
  signOut(): Promise<{ error: AuthError | null }>;
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

interface SelectedBranchAdapter {
  get(): string | null;
  set(id: string | null): void;
}

export interface AuthServiceDependencies {
  auth: AuthAdapter;
  linking: LinkingAdapter;
  browser: BrowserAdapter;
  selectedBranch: SelectedBranchAdapter;
  preference: BranchPreference;
}

export type AuthActionResult =
  { status: 'success' } | { status: 'error'; message: string };

export type GoogleAuthResult = AuthActionResult | { status: 'cancelled' };

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
  return {
    async signInWithPassword(
      email: string,
      password: string
    ): Promise<AuthActionResult> {
      try {
        const { error } = await dependencies.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (error) {
          return { status: 'error', message: passwordErrorMessage(error) };
        }
        return { status: 'success' };
      } catch {
        return {
          status: 'error',
          message: 'Could not sign in. Please try again.',
        };
      }
    },

    async signInWithGoogle(): Promise<GoogleAuthResult> {
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
        const { data, error } = await dependencies.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo, skipBrowserRedirect: true },
        });
        if (error || !data.url) {
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
          return { status: 'cancelled' };
        }
        if (browserResult.type !== 'success' || !browserResult.url) {
          return {
            status: 'error',
            message: 'Google sign-in was not completed.',
          };
        }

        const callback = authorizationCodeFromCallback(browserResult.url);
        if (callback.status === 'error') return callback;

        const { error: exchangeError } =
          await dependencies.auth.exchangeCodeForSession(callback.code);
        if (exchangeError) {
          return {
            status: 'error',
            message: 'Could not complete Google sign-in. Please try again.',
          };
        }
        return { status: 'success' };
      } catch {
        return {
          status: 'error',
          message: 'Could not complete Google sign-in. Please try again.',
        };
      }
    },

    async signOut(): Promise<AuthActionResult> {
      let remoteFailed = false;
      try {
        const { error } = await dependencies.auth.signOut();
        remoteFailed = error !== null;
      } catch {
        remoteFailed = true;
      }

      dependencies.selectedBranch.set(null);
      try {
        await dependencies.preference.clear();
      } catch {
        return {
          status: 'error',
          message: 'Signed out, but local branch data could not be cleared.',
        };
      }

      if (remoteFailed) {
        return {
          status: 'error',
          message:
            'Signed out on this device, but the remote session could not be closed.',
        };
      }
      return { status: 'success' };
    },
  };
}

const authService = createAuthService({
  auth: mobileSupabase.auth,
  linking: Linking,
  browser: WebBrowser,
  selectedBranch: selectedBranchRef,
  preference: branchPreference,
});

export const signInWithPassword = authService.signInWithPassword;
export const signInWithGoogle = authService.signInWithGoogle;
export const signOut = authService.signOut;
