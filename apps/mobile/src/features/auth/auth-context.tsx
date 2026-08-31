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
    password: string
  ): Promise<AuthActionResult>;
  signInWithGoogle(): Promise<GoogleAuthResult>;
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

export function AuthProvider({
  children,
  dependencies = defaultDependencies,
}: PropsWithChildren<{ dependencies?: AuthProviderDependencies }>) {
  const [state, setState] = useState<AuthState>({ status: 'booting' });
  const sessionRef = useRef<Session | null>(null);
  const lastAuthSessionRef = useRef<Session | null>(null);
  const requestedBranchRef = useRef<string | null>(null);
  const explicitSignOutGenerationRef = useRef<number | null>(null);
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

  const publishSignedOut = useCallback(
    (
      generation: number,
      error?: string,
      blockSessionEvents = false
    ): boolean => {
      if (!isCurrent(generation)) return false;
      if (blockSessionEvents) signedOutBarrierRef.current = true;
      requestedBranchRef.current = null;
      sessionRef.current = null;
      lastAuthSessionRef.current = null;
      dependencies.selectedBranch.set(null);
      if (!isCurrent(generation)) return false;
      setState({
        status: 'signed_out',
        ...(error ? { error } : {}),
      });
      return true;
    },
    [dependencies.selectedBranch, isCurrent]
  );

  const localPurgeError = useCallback(
    (result: LocalSessionPurgeResult): string | undefined => {
      if (result.localAuth === 'failed') {
        return "Could not fully clear this device's sign-in. Restart the app before trying again.";
      }
      if (result.branchPreference === 'failed') {
        return 'Signed out, but local branch data could not be cleared.';
      }
      return undefined;
    },
    []
  );

  const purgeLocalForGeneration = useCallback(
    async (generation: number): Promise<void> => {
      if (!isCurrent(generation)) return;
      let result: LocalSessionPurgeResult;
      try {
        result = await dependencies.actions.purgeLocalSession();
      } catch {
        result = { localAuth: 'failed', branchPreference: 'failed' };
      }
      if (!isCurrent(generation)) return;
      const error = localPurgeError(result);
      if (error) {
        setState((current) =>
          current.status === 'signed_out'
            ? { status: 'signed_out', error }
            : current
        );
      }
    },
    [dependencies.actions, isCurrent, localPurgeError]
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
      requestedBranchId?: string
    ): Promise<void> => {
      let validation: Awaited<ReturnType<AuthStateAdapter['getUser']>>;
      try {
        validation = await dependencies.auth.getUser();
      } catch {
        if (
          publishSignedOut(
            generation,
            'Could not verify your session. Sign in again.',
            true
          )
        ) {
          void purgeLocalForGeneration(generation);
        }
        return;
      }
      if (!isCurrent(generation)) return;
      const { data, error } = validation;
      if (error || !data.user || data.user.id !== session.user.id) {
        if (
          publishSignedOut(
            generation,
            'Your session expired. Sign in again.',
            true
          )
        ) {
          void purgeLocalForGeneration(generation);
        }
        return;
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
          if (!isCurrent(generation)) return;
          publishLocalStateFailure(generation, session, null, []);
          return;
        }
      }
      if (!isCurrent(generation)) return;

      let bootstrap: MobileBootstrap;
      try {
        bootstrap = await dependencies.loadBootstrap(
          dependencies.source,
          data.user.id,
          requested ?? null
        );
      } catch {
        bootstrap = {
          status: 'blocked',
          profile: null,
          branches: [],
          reason: 'branch_access_unavailable',
        };
      }
      if (!isCurrent(generation)) return;

      if (bootstrap.status === 'ready') {
        const persisted = await mutatePreference(generation, () =>
          dependencies.preference.set(bootstrap.branch.account_id)
        );
        if (persisted === 'obsolete') return;
        if (persisted === 'failed') {
          publishLocalStateFailure(
            generation,
            session,
            bootstrap.profile,
            bootstrap.branches
          );
          return;
        }
        publishReady(generation, session, bootstrap);
        return;
      }

      const cleared = await mutatePreference(generation, () =>
        dependencies.preference.clear()
      );
      if (cleared === 'obsolete') return;
      if (cleared === 'failed') {
        publishLocalStateFailure(
          generation,
          session,
          bootstrap.profile,
          bootstrap.branches
        );
        return;
      }
      publishUnready(generation, session, bootstrap);
    },
    [
      dependencies,
      isCurrent,
      mutatePreference,
      publishLocalStateFailure,
      publishReady,
      publishSignedOut,
      publishUnready,
      purgeLocalForGeneration,
    ]
  );

  const beginSessionTransition = useCallback(
    (event: AuthChangeEvent, nextSession: Session): void => {
      if (signedOutBarrierRef.current) {
        void purgeLocalForGeneration(generationRef.current);
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
    if (explicitSignOutGenerationRef.current !== null) return;
    const generation = nextGeneration();
    signedOutBarrierRef.current = true;
    if (publishSignedOut(generation, undefined, true)) {
      void purgeLocalForGeneration(generation);
    }
  }, [nextGeneration, publishSignedOut, purgeLocalForGeneration]);

  useEffect(() => {
    mountedRef.current = true;
    signedOutBarrierRef.current = false;
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
        if (
          publishSignedOut(
            restorationGeneration,
            'Could not restore your session. Sign in again.'
          )
        ) {
          void purgeLocalForGeneration(restorationGeneration);
        }
        return;
      }
      if (!isCurrent(restorationGeneration)) return;
      const { data, error } = restored;
      if (error || !data.session) {
        if (
          publishSignedOut(
            restorationGeneration,
            error ? 'Could not restore your session. Sign in again.' : undefined
          )
        ) {
          void purgeLocalForGeneration(restorationGeneration);
        }
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
    publishSignedOut,
    purgeLocalForGeneration,
  ]);

  const selectBranch = useCallback(
    async (accountId: string): Promise<void> => {
      const session = sessionRef.current;
      if (!session) {
        const generation = nextGeneration();
        if (publishSignedOut(generation)) {
          void purgeLocalForGeneration(generation);
        }
        return;
      }
      requestedBranchRef.current = accountId;
      const generation = nextGeneration();
      await bootstrapSession(session, generation, accountId);
    },
    [
      bootstrapSession,
      nextGeneration,
      publishSignedOut,
      purgeLocalForGeneration,
    ]
  );

  const signInWithPasswordFromProvider = useCallback(
    async (email: string, password: string): Promise<AuthActionResult> => {
      signedOutBarrierRef.current = false;
      const result = await dependencies.actions.signInWithPassword(
        email,
        password
      );
      if (result.status === 'error') signedOutBarrierRef.current = true;
      return result;
    },
    [dependencies.actions]
  );

  const signInWithGoogleFromProvider =
    useCallback(async (): Promise<GoogleAuthResult> => {
      signedOutBarrierRef.current = false;
      const result = await dependencies.actions.signInWithGoogle();
      if (result.status === 'error') signedOutBarrierRef.current = true;
      return result;
    }, [dependencies.actions]);

  const signOutFromProvider = useCallback(async (): Promise<void> => {
    const accessToken = sessionRef.current?.access_token ?? null;
    const generation = nextGeneration();
    explicitSignOutGenerationRef.current = generation;
    signedOutBarrierRef.current = true;
    publishSignedOut(generation, undefined, true);

    let result: SignOutResult;
    try {
      result = await dependencies.actions.signOut(accessToken);
    } catch {
      await purgeLocalForGeneration(generation);
      result = {
        status: 'error',
        remote: 'failed',
        localAuth: 'failed',
        branchPreference: 'failed',
        message: 'Could not confirm sign-out cleanup on this device.',
      };
    }
    if (explicitSignOutGenerationRef.current === generation) {
      explicitSignOutGenerationRef.current = null;
    }
    if (!isCurrent(generation)) return;
    setState({
      status: 'signed_out',
      ...(result.status === 'error' ? { error: result.message } : {}),
    });
  }, [
    dependencies.actions,
    isCurrent,
    nextGeneration,
    publishSignedOut,
    purgeLocalForGeneration,
  ]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      signInWithPassword: signInWithPasswordFromProvider,
      signInWithGoogle: signInWithGoogleFromProvider,
      signOut: signOutFromProvider,
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
