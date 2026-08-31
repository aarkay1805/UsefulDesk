import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { mobileSupabase, selectedBranchRef } from '../../data/supabase';
import {
  signInWithGoogle,
  signInWithPassword,
  signOut,
  type AuthActionResult,
  type GoogleAuthResult,
  type SignOutResult,
} from './auth-service';
import {
  loadMobileBootstrap,
  mobileBootstrapSource,
  type BootstrapSource,
} from './bootstrap-repository';
import { branchPreference, type BranchPreference } from './branch-preference';
import type {
  AccountSummary,
  BranchAccount,
  MobileBootstrap,
  MobileProfile,
} from './branch-types';

export type AuthState =
  | { status: 'booting' }
  | { status: 'signed_out'; error?: string }
  | {
      status: 'choose_branch';
      profile: MobileProfile;
      branches: BranchAccount[];
      reason?: string;
    }
  | {
      status: 'ready';
      session: Session;
      profile: MobileProfile;
      branches: BranchAccount[];
      branch: BranchAccount;
      account: AccountSummary;
    }
  | {
      status: 'blocked';
      profile: MobileProfile | null;
      branches: BranchAccount[];
      reason: string;
    };

interface AuthStateAdapter {
  getSession(): Promise<{
    data: { session: Session | null };
    error: { message: string } | null;
  }>;
  getUser(): Promise<{
    data: { user: User | null };
    error: { message: string } | null;
  }>;
  onAuthStateChange(
    callback: (event: AuthChangeEvent, session: Session | null) => void
  ): { data: { subscription: { unsubscribe(): void } } };
}

interface SelectedBranchAdapter {
  get(): string | null;
  set(accountId: string | null): void;
}

interface AuthActions {
  signInWithPassword(
    email: string,
    password: string
  ): Promise<AuthActionResult>;
  signInWithGoogle(): Promise<GoogleAuthResult>;
  signOut(): Promise<SignOutResult>;
}

export interface AuthProviderDependencies {
  auth: AuthStateAdapter;
  source: BootstrapSource;
  loadBootstrap(
    source: BootstrapSource,
    userId: string,
    requestedBranchId: string | null
  ): Promise<MobileBootstrap>;
  preference: BranchPreference;
  selectedBranch: SelectedBranchAdapter;
  actions: AuthActions;
}

export interface AuthContextValue {
  state: AuthState;
  signInWithPassword(
    email: string,
    password: string
  ): Promise<AuthActionResult>;
  signInWithGoogle(): Promise<GoogleAuthResult>;
  signOut(): Promise<void>;
  selectBranch(accountId: string): Promise<void>;
}

const defaultDependencies: AuthProviderDependencies = {
  auth: mobileSupabase.auth,
  source: mobileBootstrapSource,
  loadBootstrap: loadMobileBootstrap,
  preference: branchPreference,
  selectedBranch: selectedBranchRef,
  actions: { signInWithPassword, signInWithGoogle, signOut },
};

const AuthContext = createContext<AuthContextValue | null>(null);

function stateFromBootstrap(
  bootstrap: MobileBootstrap,
  session: Session
): AuthState {
  if (bootstrap.status === 'ready') {
    return {
      status: 'ready',
      session,
      profile: bootstrap.profile,
      branches: bootstrap.branches,
      branch: bootstrap.branch,
      account: bootstrap.account,
    };
  }
  if (bootstrap.status === 'choose') {
    return {
      status: 'choose_branch',
      profile: bootstrap.profile,
      branches: bootstrap.branches,
    };
  }
  return {
    status: 'blocked',
    profile: bootstrap.profile,
    branches: bootstrap.branches,
    reason: bootstrap.reason,
  };
}

function isSameSession(left: Session | null, right: Session | null): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.user.id === right.user.id && left.access_token === right.access_token
  );
}

export function AuthProvider({
  children,
  dependencies = defaultDependencies,
}: PropsWithChildren<{ dependencies?: AuthProviderDependencies }>) {
  const [state, setState] = useState<AuthState>({ status: 'booting' });
  const sessionRef = useRef<Session | null>(null);
  const lastAuthSessionRef = useRef<Session | null>(null);
  const explicitSignOutRef = useRef(false);
  const mountedRef = useRef(false);
  const transitionQueueRef = useRef<Promise<void>>(Promise.resolve());

  const commit = useCallback((nextState: AuthState) => {
    if (mountedRef.current) setState(nextState);
  }, []);

  const enqueue = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const pending = transitionQueueRef.current.then(work, work);
    transitionQueueRef.current = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  }, []);

  const clearLocalBranch = useCallback(async (): Promise<
    string | undefined
  > => {
    dependencies.selectedBranch.set(null);
    try {
      await dependencies.preference.clear();
      return undefined;
    } catch {
      return 'Signed out, but local branch data could not be cleared.';
    }
  }, [dependencies]);

  const settleSignedOut = useCallback(
    async (error?: string) => {
      sessionRef.current = null;
      const cleanupError = await clearLocalBranch();
      commit({
        status: 'signed_out',
        ...(cleanupError || error ? { error: cleanupError ?? error } : {}),
      });
    },
    [clearLocalBranch, commit]
  );

  const bootstrapSession = useCallback(
    async (session: Session, requestedBranchId?: string) => {
      let validation: Awaited<ReturnType<AuthStateAdapter['getUser']>>;
      try {
        validation = await dependencies.auth.getUser();
      } catch {
        await settleSignedOut('Could not verify your session. Sign in again.');
        return;
      }
      const { data, error } = validation;
      if (error || !data.user) {
        await settleSignedOut('Your session expired. Sign in again.');
        return;
      }

      let requested = requestedBranchId;
      if (requested === undefined) {
        requested = dependencies.selectedBranch.get() ?? undefined;
        if (requested === undefined) {
          try {
            requested = (await dependencies.preference.get()) ?? undefined;
          } catch {
            commit({
              status: 'blocked',
              profile: null,
              branches: [],
              reason: 'Saved branch could not be read.',
            });
            return;
          }
        }
      }

      const bootstrap = await dependencies.loadBootstrap(
        dependencies.source,
        data.user.id,
        requested ?? null
      );
      sessionRef.current = session;
      commit(stateFromBootstrap(bootstrap, session));
    },
    [commit, dependencies, settleSignedOut]
  );

  useEffect(() => {
    mountedRef.current = true;
    let subscription: { unsubscribe(): void } | undefined;

    void enqueue(async () => {
      const { data, error } = await dependencies.auth.getSession();
      if (!mountedRef.current) return;
      lastAuthSessionRef.current = data.session;

      subscription = dependencies.auth.onAuthStateChange(
        (event, nextSession) => {
          const explicitSignOutOwnsCleanup =
            event === 'SIGNED_OUT' && explicitSignOutRef.current;
          void enqueue(async () => {
            if (event === 'INITIAL_SESSION') {
              if (isSameSession(lastAuthSessionRef.current, nextSession)) {
                return;
              }
              lastAuthSessionRef.current = nextSession;
            } else {
              lastAuthSessionRef.current = nextSession;
            }

            if (event === 'SIGNED_OUT') {
              sessionRef.current = null;
              if (explicitSignOutOwnsCleanup) return;
              await settleSignedOut();
              return;
            }
            if (!nextSession) {
              await settleSignedOut();
              return;
            }
            if (
              event === 'INITIAL_SESSION' ||
              event === 'SIGNED_IN' ||
              event === 'TOKEN_REFRESHED' ||
              event === 'USER_UPDATED'
            ) {
              await bootstrapSession(nextSession);
            }
          });
        }
      ).data.subscription;

      if (error || !data.session) {
        await settleSignedOut(
          error ? 'Could not restore your session. Sign in again.' : undefined
        );
        return;
      }

      sessionRef.current = data.session;
      await bootstrapSession(data.session);
    });

    return () => {
      mountedRef.current = false;
      subscription?.unsubscribe();
    };
  }, [bootstrapSession, dependencies.auth, enqueue, settleSignedOut]);

  const selectBranch = useCallback(
    (accountId: string) =>
      enqueue(async () => {
        const session = sessionRef.current;
        if (!session) {
          await settleSignedOut();
          return;
        }
        await bootstrapSession(session, accountId);
      }),
    [bootstrapSession, enqueue, settleSignedOut]
  );

  const signOutFromProvider = useCallback(
    () =>
      enqueue(async () => {
        explicitSignOutRef.current = true;
        const result = await dependencies.actions.signOut();
        explicitSignOutRef.current = false;
        sessionRef.current = null;
        lastAuthSessionRef.current = null;
        commit({
          status: 'signed_out',
          ...(result.status === 'error' ? { error: result.message } : {}),
        });
      }),
    [commit, dependencies.actions, enqueue]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      signInWithPassword: dependencies.actions.signInWithPassword,
      signInWithGoogle: dependencies.actions.signInWithGoogle,
      signOut: signOutFromProvider,
      selectBranch,
    }),
    [dependencies.actions, selectBranch, signOutFromProvider, state]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider.');
  return context;
}
