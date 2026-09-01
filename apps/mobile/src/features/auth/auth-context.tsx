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
  purgeLocalSession,
  signOut,
  type AuthActionResult,
  type AuthAttemptLifecycle,
  type GoogleAuthResult,
  type LocalSessionPurgeResult,
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
  BranchBlockReason,
  MobileBootstrap,
  MobileProfile,
} from './branch-types';

export type AuthState =
  | { status: 'booting' }
  | { status: 'signing_out' }
  | { status: 'cleanup_failed'; error: string }
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
      reason: BranchBlockReason;
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
    password: string,
    lifecycle?: AuthAttemptLifecycle
  ): Promise<AuthActionResult>;
  signInWithGoogle(lifecycle?: AuthAttemptLifecycle): Promise<GoogleAuthResult>;
  signOut(accessToken: string | null): Promise<SignOutResult>;
  purgeLocalSession(): Promise<LocalSessionPurgeResult>;
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
  recoverUnauthorizedSession?(): Promise<void>;
  selectBranch(accountId: string): Promise<void>;
}

export type ReadyAuthState = Extract<AuthState, { status: 'ready' }>;
export type ReadyAuthContextValue = Omit<AuthContextValue, 'state'> & {
  state: ReadyAuthState;
};

const defaultDependencies: AuthProviderDependencies = {
  auth: mobileSupabase.auth,
  source: mobileBootstrapSource,
  loadBootstrap: loadMobileBootstrap,
  preference: branchPreference,
  selectedBranch: selectedBranchRef,
  actions: {
    signInWithPassword,
    signInWithGoogle,
    signOut,
    purgeLocalSession,
  },
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

type BootstrapSessionOutcome =
  'published_ready' | 'published_unready' | 'failed' | 'obsolete';

export function AuthProvider({
  children,
  dependencies = defaultDependencies,
}: PropsWithChildren<{ dependencies?: AuthProviderDependencies }>) {
  const [state, setState] = useState<AuthState>({ status: 'booting' });
  const sessionRef = useRef<Session | null>(null);
  const lastAuthSessionRef = useRef<Session | null>(null);
  const requestedBranchRef = useRef<string | null>(null);
  const ownedSignOutEventGenerationRef = useRef<number | null>(null);
  const cleanupInFlightGenerationRef = useRef<number | null>(null);
  const authAvailabilityRef = useRef<'blocked' | 'allowed' | 'cleanup_failed'>(
    'blocked'
  );
  const signedOutBarrierRef = useRef(false);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);

  const isCurrent = useCallback((generation: number): boolean => {
    return mountedRef.current && generationRef.current === generation;
  }, []);

  const nextGeneration = useCallback((): number => {
    generationRef.current += 1;
    return generationRef.current;
  }, []);

  const publishSigningOut = useCallback(
    (generation: number): boolean => {
      if (!isCurrent(generation)) return false;
      signedOutBarrierRef.current = true;
      authAvailabilityRef.current = 'blocked';
      requestedBranchRef.current = null;
      sessionRef.current = null;
      lastAuthSessionRef.current = null;
      dependencies.selectedBranch.set(null);
      if (!isCurrent(generation)) return false;
      setState({ status: 'signing_out' });
      return true;
    },
    [dependencies.selectedBranch, isCurrent]
  );

  const publishSignedOut = useCallback(
    (generation: number, error?: string): boolean => {
      if (!isCurrent(generation)) return false;
      signedOutBarrierRef.current = true;
      authAvailabilityRef.current = 'allowed';
      setState({
        status: 'signed_out',
        ...(error ? { error } : {}),
      });
      return true;
    },
    [isCurrent]
  );

  const localPurgeError = useCallback(
    (result: LocalSessionPurgeResult): string | undefined => {
      if (result.localAuth === 'failed') {
        return 'Secure sign-out is incomplete. Retry secure sign-out before signing in.';
      }
      if (result.branchPreference === 'failed') {
        return 'Signed out, but local branch data could not be cleared.';
      }
      return undefined;
    },
    []
  );

  const purgeLocalForGeneration = useCallback(
    async (generation: number, settledError?: string): Promise<void> => {
      if (!publishSigningOut(generation)) return;
      cleanupInFlightGenerationRef.current = generation;
      ownedSignOutEventGenerationRef.current = generation;
      let result: LocalSessionPurgeResult;
      try {
        result = await dependencies.actions.purgeLocalSession();
      } catch {
        result = { localAuth: 'failed', branchPreference: 'failed' };
      }
      if (ownedSignOutEventGenerationRef.current === generation) {
        ownedSignOutEventGenerationRef.current = null;
      }
      if (cleanupInFlightGenerationRef.current === generation) {
        cleanupInFlightGenerationRef.current = null;
      }
      if (!isCurrent(generation)) return;
      const error = localPurgeError(result);
      if (result.localAuth === 'failed') {
        authAvailabilityRef.current = 'cleanup_failed';
        setState({
          status: 'cleanup_failed',
          error:
            error ??
            'Secure sign-out is incomplete. Retry secure sign-out before signing in.',
        });
        return;
      }
      publishSignedOut(generation, error ?? settledError);
    },
    [
      dependencies.actions,
      isCurrent,
      localPurgeError,
      publishSignedOut,
      publishSigningOut,
    ]
  );

  const mutatePreference = useCallback(
    async (
      generation: number,
      mutation: () => Promise<void>
    ): Promise<'success' | 'failed' | 'obsolete'> => {
      if (!isCurrent(generation)) return 'obsolete';
      try {
        await mutation();
      } catch {
        return isCurrent(generation) ? 'failed' : 'obsolete';
      }
      return isCurrent(generation) ? 'success' : 'obsolete';
    },
    [isCurrent]
  );

  const publishReady = useCallback(
    (
      generation: number,
      session: Session,
      bootstrap: Extract<MobileBootstrap, { status: 'ready' }>
    ): boolean => {
      if (!isCurrent(generation)) return false;
      dependencies.selectedBranch.set(bootstrap.branch.account_id);
      if (!isCurrent(generation)) return false;
      requestedBranchRef.current = null;
      sessionRef.current = session;
      authAvailabilityRef.current = 'blocked';
      setState(stateFromBootstrap(bootstrap, session));
      return true;
    },
    [dependencies.selectedBranch, isCurrent]
  );

  const publishUnready = useCallback(
    (
      generation: number,
      session: Session,
      bootstrap: Exclude<MobileBootstrap, { status: 'ready' }>
    ): boolean => {
      if (!isCurrent(generation)) return false;
      dependencies.selectedBranch.set(null);
      if (!isCurrent(generation)) return false;
      requestedBranchRef.current = null;
      sessionRef.current = session;
      authAvailabilityRef.current = 'blocked';
      setState(stateFromBootstrap(bootstrap, session));
      return true;
    },
    [dependencies.selectedBranch, isCurrent]
  );

  const publishLocalStateFailure = useCallback(
    (
      generation: number,
      session: Session,
      profile: MobileProfile | null,
      branches: BranchAccount[]
    ): void => {
      publishUnready(generation, session, {
        status: 'blocked',
        profile,
        branches,
        reason: 'local_state_unavailable',
      });
    },
    [publishUnready]
  );

  const bootstrapSession = useCallback(
    async (
      session: Session,
      generation: number,
      requestedBranchId?: string,
      preserveReadyState = false
    ): Promise<BootstrapSessionOutcome> => {
      let validation: Awaited<ReturnType<AuthStateAdapter['getUser']>>;
      try {
        validation = await dependencies.auth.getUser();
      } catch {
        if (preserveReadyState && isCurrent(generation)) return 'failed';
        void purgeLocalForGeneration(
          generation,
          'Could not verify your session. Sign in again.'
        );
        return isCurrent(generation) ? 'failed' : 'obsolete';
      }
      if (!isCurrent(generation)) return 'obsolete';
      const { data, error } = validation;
      if (error || !data.user || data.user.id !== session.user.id) {
        void purgeLocalForGeneration(
          generation,
          'Your session expired. Sign in again.'
        );
        return isCurrent(generation) ? 'failed' : 'obsolete';
      }

      let requested =
        requestedBranchId ??
        requestedBranchRef.current ??
        dependencies.selectedBranch.get() ??
        undefined;
      if (requested === undefined) {
        try {
          requested = (await dependencies.preference.get()) ?? undefined;
        } catch {
          if (!isCurrent(generation)) return 'obsolete';
          publishLocalStateFailure(generation, session, null, []);
          return 'failed';
        }
      }
      if (!isCurrent(generation)) return 'obsolete';

      let bootstrap: MobileBootstrap;
      try {
        bootstrap = await dependencies.loadBootstrap(
          dependencies.source,
          data.user.id,
          requested ?? null
        );
      } catch {
        if (preserveReadyState) {
          return isCurrent(generation) ? 'failed' : 'obsolete';
        }
        bootstrap = {
          status: 'blocked',
          profile: null,
          branches: [],
          reason: 'branch_access_unavailable',
        };
      }
      if (!isCurrent(generation)) return 'obsolete';

      if (bootstrap.status === 'ready') {
        const persisted = await mutatePreference(generation, () =>
          dependencies.preference.set(bootstrap.branch.account_id)
        );
        if (persisted === 'obsolete') return 'obsolete';
        if (persisted === 'failed') {
          if (!preserveReadyState) {
            publishLocalStateFailure(
              generation,
              session,
              bootstrap.profile,
              bootstrap.branches
            );
          }
          return 'failed';
        }
        return publishReady(generation, session, bootstrap)
          ? 'published_ready'
          : 'obsolete';
      }

      if (preserveReadyState) {
        return 'failed';
      }

      const cleared = await mutatePreference(generation, () =>
        dependencies.preference.clear()
      );
      if (cleared === 'obsolete') return 'obsolete';
      if (cleared === 'failed') {
        publishLocalStateFailure(
          generation,
          session,
          bootstrap.profile,
          bootstrap.branches
        );
        return 'failed';
      }
      return publishUnready(generation, session, bootstrap)
        ? 'published_unready'
        : 'obsolete';
    },
    [
      dependencies,
      isCurrent,
      mutatePreference,
      publishLocalStateFailure,
      publishReady,
      publishUnready,
      purgeLocalForGeneration,
    ]
  );

  const beginSessionTransition = useCallback(
    (event: AuthChangeEvent, nextSession: Session): void => {
      if (signedOutBarrierRef.current) {
        if (cleanupInFlightGenerationRef.current !== generationRef.current) {
          void purgeLocalForGeneration(nextGeneration());
        }
        return;
      }
      if (
        event === 'INITIAL_SESSION' &&
        isSameSession(lastAuthSessionRef.current, nextSession)
      ) {
        return;
      }

      const previousSession = lastAuthSessionRef.current;
      const replacingUser = Boolean(
        previousSession && previousSession.user.id !== nextSession.user.id
      );
      const requested = replacingUser
        ? undefined
        : (requestedBranchRef.current ??
          dependencies.selectedBranch.get() ??
          undefined);
      const generation = nextGeneration();
      ownedSignOutEventGenerationRef.current = null;
      authAvailabilityRef.current = 'blocked';
      lastAuthSessionRef.current = nextSession;
      sessionRef.current = nextSession;

      if (replacingUser && isCurrent(generation)) {
        requestedBranchRef.current = null;
        dependencies.selectedBranch.set(null);
        if (isCurrent(generation)) setState({ status: 'booting' });
      }
      void bootstrapSession(nextSession, generation, requested);
    },
    [
      bootstrapSession,
      dependencies.selectedBranch,
      isCurrent,
      nextGeneration,
      purgeLocalForGeneration,
    ]
  );

  const handleSignedOutEvent = useCallback((): void => {
    if (
      ownedSignOutEventGenerationRef.current !== null &&
      ownedSignOutEventGenerationRef.current === generationRef.current
    ) {
      ownedSignOutEventGenerationRef.current = null;
      return;
    }
    ownedSignOutEventGenerationRef.current = null;
    if (cleanupInFlightGenerationRef.current === generationRef.current) return;
    const generation = nextGeneration();
    void purgeLocalForGeneration(generation);
  }, [nextGeneration, purgeLocalForGeneration]);

  useEffect(() => {
    mountedRef.current = true;
    signedOutBarrierRef.current = false;
    authAvailabilityRef.current = 'blocked';
    ownedSignOutEventGenerationRef.current = null;
    cleanupInFlightGenerationRef.current = null;
    requestedBranchRef.current = null;
    sessionRef.current = null;
    lastAuthSessionRef.current = null;
    const restorationGeneration = nextGeneration();
    dependencies.selectedBranch.set(null);

    const subscription = dependencies.auth.onAuthStateChange(
      (event, nextSession) => {
        if (event === 'SIGNED_OUT' || !nextSession) {
          handleSignedOutEvent();
          return;
        }
        if (
          event === 'INITIAL_SESSION' ||
          event === 'SIGNED_IN' ||
          event === 'TOKEN_REFRESHED' ||
          event === 'USER_UPDATED'
        ) {
          beginSessionTransition(event, nextSession);
        }
      }
    ).data.subscription;

    void (async () => {
      let restored: Awaited<ReturnType<AuthStateAdapter['getSession']>>;
      try {
        restored = await dependencies.auth.getSession();
      } catch {
        void purgeLocalForGeneration(
          restorationGeneration,
          'Could not restore your session. Sign in again.'
        );
        return;
      }
      if (!isCurrent(restorationGeneration)) return;
      const { data, error } = restored;
      if (error || !data.session) {
        void purgeLocalForGeneration(
          restorationGeneration,
          error ? 'Could not restore your session. Sign in again.' : undefined
        );
        return;
      }

      lastAuthSessionRef.current = data.session;
      sessionRef.current = data.session;
      const generation = nextGeneration();
      void bootstrapSession(data.session, generation);
    })();

    return () => {
      generationRef.current += 1;
      mountedRef.current = false;
      signedOutBarrierRef.current = true;
      authAvailabilityRef.current = 'blocked';
      ownedSignOutEventGenerationRef.current = null;
      cleanupInFlightGenerationRef.current = null;
      requestedBranchRef.current = null;
      sessionRef.current = null;
      lastAuthSessionRef.current = null;
      subscription.unsubscribe();
      dependencies.selectedBranch.set(null);
    };
  }, [
    beginSessionTransition,
    bootstrapSession,
    dependencies.auth,
    dependencies.selectedBranch,
    handleSignedOutEvent,
    isCurrent,
    nextGeneration,
    purgeLocalForGeneration,
  ]);

  const selectBranch = useCallback(
    async (accountId: string): Promise<void> => {
      const session = sessionRef.current;
      if (!session) {
        const generation = nextGeneration();
        void purgeLocalForGeneration(generation);
        throw new Error('Branch selection was not committed.');
      }
      requestedBranchRef.current = accountId;
      const generation = nextGeneration();
      const outcome = await bootstrapSession(
        session,
        generation,
        accountId,
        state.status === 'ready'
      );
      if (outcome === 'published_ready') return;
      if (isCurrent(generation)) requestedBranchRef.current = null;
      throw new Error('Branch selection was not committed.');
    },
    [
      bootstrapSession,
      isCurrent,
      nextGeneration,
      purgeLocalForGeneration,
      state.status,
    ]
  );

  const beginAuthAttempt = useCallback(():
    { generation: number } | { error: AuthActionResult } => {
    if (authAvailabilityRef.current !== 'allowed') {
      return {
        error: {
          status: 'error',
          message:
            authAvailabilityRef.current === 'cleanup_failed'
              ? 'Secure sign-out is incomplete. Retry secure sign-out before signing in.'
              : 'Secure sign-out is still in progress.',
          ...(authAvailabilityRef.current === 'cleanup_failed'
            ? { reason: 'cleanup_failed' as const }
            : {}),
        },
      };
    }

    const generation = nextGeneration();
    ownedSignOutEventGenerationRef.current = null;
    cleanupInFlightGenerationRef.current = null;
    authAvailabilityRef.current = 'blocked';
    signedOutBarrierRef.current = false;
    return { generation };
  }, [nextGeneration]);

  const settleFailedAuthAttempt = useCallback(
    (generation: number, cleanupFailed = false): void => {
      if (!isCurrent(generation)) return;
      signedOutBarrierRef.current = true;
      if (cleanupFailed) {
        authAvailabilityRef.current = 'cleanup_failed';
        setState({
          status: 'cleanup_failed',
          error:
            'Secure sign-out is incomplete. Retry secure sign-out before signing in.',
        });
        return;
      }
      authAvailabilityRef.current = 'allowed';
    },
    [isCurrent]
  );

  const signInWithPasswordFromProvider = useCallback(
    async (email: string, password: string): Promise<AuthActionResult> => {
      const attempt = beginAuthAttempt();
      if ('error' in attempt) return attempt.error;
      const lifecycle: AuthAttemptLifecycle = {
        beforeLocalSignOut() {
          if (isCurrent(attempt.generation)) {
            ownedSignOutEventGenerationRef.current = attempt.generation;
          }
        },
      };
      try {
        const result = await dependencies.actions.signInWithPassword(
          email,
          password,
          lifecycle
        );
        if (result.status === 'error') {
          const cleanupFailed = result.reason === 'cleanup_failed';
          settleFailedAuthAttempt(attempt.generation, cleanupFailed);
          if (cleanupFailed) {
            return {
              status: 'error',
              reason: 'cleanup_failed',
              message:
                'Secure sign-out is incomplete. Retry secure sign-out before signing in.',
            };
          }
        }
        return result;
      } catch {
        settleFailedAuthAttempt(attempt.generation);
        return {
          status: 'error',
          message: 'Could not sign in. Please try again.',
        };
      } finally {
        if (ownedSignOutEventGenerationRef.current === attempt.generation) {
          ownedSignOutEventGenerationRef.current = null;
        }
      }
    },
    [beginAuthAttempt, dependencies.actions, isCurrent, settleFailedAuthAttempt]
  );

  const signInWithGoogleFromProvider =
    useCallback(async (): Promise<GoogleAuthResult> => {
      const attempt = beginAuthAttempt();
      if ('error' in attempt) return attempt.error;
      const lifecycle: AuthAttemptLifecycle = {
        beforeLocalSignOut() {
          if (isCurrent(attempt.generation)) {
            ownedSignOutEventGenerationRef.current = attempt.generation;
          }
        },
      };
      try {
        const result = await dependencies.actions.signInWithGoogle(lifecycle);
        if (result.status !== 'success') {
          const cleanupFailed =
            result.status === 'error' && result.reason === 'cleanup_failed';
          settleFailedAuthAttempt(attempt.generation, cleanupFailed);
          if (cleanupFailed) {
            return {
              status: 'error',
              reason: 'cleanup_failed',
              message:
                'Secure sign-out is incomplete. Retry secure sign-out before signing in.',
            };
          }
        }
        return result;
      } catch {
        settleFailedAuthAttempt(attempt.generation);
        return {
          status: 'error',
          message: 'Could not complete Google sign-in. Please try again.',
        };
      } finally {
        if (ownedSignOutEventGenerationRef.current === attempt.generation) {
          ownedSignOutEventGenerationRef.current = null;
        }
      }
    }, [
      beginAuthAttempt,
      dependencies.actions,
      isCurrent,
      settleFailedAuthAttempt,
    ]);

  const signOutFromProvider = useCallback(async (): Promise<void> => {
    if (cleanupInFlightGenerationRef.current !== null) return;
    const accessToken = sessionRef.current?.access_token ?? null;
    const generation = nextGeneration();
    if (!publishSigningOut(generation)) return;
    cleanupInFlightGenerationRef.current = generation;
    ownedSignOutEventGenerationRef.current = generation;

    let result: SignOutResult;
    try {
      result = await dependencies.actions.signOut(accessToken);
    } catch {
      let local: LocalSessionPurgeResult;
      try {
        ownedSignOutEventGenerationRef.current = generation;
        local = await dependencies.actions.purgeLocalSession();
      } catch {
        local = { localAuth: 'failed', branchPreference: 'failed' };
      }
      result = {
        status: 'error',
        remote: 'failed',
        ...local,
        message:
          local.localAuth === 'failed'
            ? 'Secure sign-out is incomplete. Retry secure sign-out before signing in.'
            : 'Signed out on this device, but the remote session could not be closed.',
      };
    }
    if (ownedSignOutEventGenerationRef.current === generation) {
      ownedSignOutEventGenerationRef.current = null;
    }
    if (cleanupInFlightGenerationRef.current === generation) {
      cleanupInFlightGenerationRef.current = null;
    }
    if (!isCurrent(generation)) return;
    if (result.localAuth === 'failed') {
      authAvailabilityRef.current = 'cleanup_failed';
      setState({
        status: 'cleanup_failed',
        error:
          'Secure sign-out is incomplete. Retry secure sign-out before signing in.',
      });
      return;
    }
    publishSignedOut(
      generation,
      result.status === 'error' ? result.message : undefined
    );
  }, [
    dependencies.actions,
    isCurrent,
    nextGeneration,
    publishSignedOut,
    publishSigningOut,
  ]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      signInWithPassword: signInWithPasswordFromProvider,
      signInWithGoogle: signInWithGoogleFromProvider,
      signOut: signOutFromProvider,
      recoverUnauthorizedSession: signOutFromProvider,
      selectBranch,
    }),
    [
      selectBranch,
      signInWithGoogleFromProvider,
      signInWithPasswordFromProvider,
      signOutFromProvider,
      state,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider.');
  return context;
}

export function requireReadyAuth(
  context: AuthContextValue
): ReadyAuthContextValue {
  if (context.state.status !== 'ready') {
    throw new Error('Protected route rendered without ready authentication.');
  }
  return context as ReadyAuthContextValue;
}

export function useReadyAuth(): ReadyAuthContextValue {
  return requireReadyAuth(useAuth());
}
