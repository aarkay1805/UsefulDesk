import { act, render, waitFor } from '@testing-library/react-native';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { type PropsWithChildren, useEffect } from 'react';

import type {
  AccountSummary,
  BranchAccount,
  MobileBootstrap,
  MobileProfile,
} from './branch-types';
import {
  AuthProvider,
  requireReadyAuth,
  type AuthContextValue,
  type AuthProviderDependencies,
  useAuth,
} from './auth-context';

const BRANCH_A = 'd3648c54-a4aa-4dd8-8566-1e3b38c1f497';
const BRANCH_B = 'f8b2a93d-bfa4-485a-8ab1-1b37862d6d72';
const USER_ID = '53f7dd9e-e2fd-4824-a773-a0ce541048ec';

const user = { id: USER_ID } as User;

function session(accessToken: string): Session {
  return {
    access_token: accessToken,
    refresh_token: `refresh-${accessToken}`,
    expires_in: 3600,
    expires_at: 1_800_000_000,
    token_type: 'bearer',
    user,
  };
}

const profile: MobileProfile = {
  id: 'cfaef847-2572-4c92-852e-b62c09eecae4',
  full_name: 'Asha Rao',
  email: 'asha@example.com',
  avatar_url: null,
  role: null,
  beta_features: [],
  account_id: BRANCH_A,
  account_role: 'admin',
};

function branch(accountId: string): BranchAccount {
  return {
    account_id: accountId,
    account_name: `Branch ${accountId}`,
    organization_id: '405ea376-0d27-4898-b198-0edb2a87ff38',
    organization_name: 'Useful Fitness',
    legal_entity_id: '895fd4ad-7219-4982-b8e4-a0c84f83e8d4',
    legal_entity_name: 'Useful Fitness Private Limited',
    role: 'admin',
    branch_status: 'active',
    readiness_state: 'ready',
    default_currency: 'INR',
    timezone: 'Asia/Kolkata',
    is_organization_owner: false,
    setup_reviewed_at: '2026-08-30T10:00:00.000Z',
    setup_reviewed_by: USER_ID,
  };
}

function account(accountId: string): AccountSummary {
  return {
    id: accountId,
    name: `Branch ${accountId}`,
    created_at: '2026-08-01T10:00:00.000Z',
    default_currency: 'INR',
    country_code: 'IN',
    locale: 'en-IN',
    timezone: 'Asia/Kolkata',
    date_order: 'DMY',
    time_format: '12h',
    week_start: 1,
    phone_country_code: '+91',
    measurement_system: 'metric',
    onboarding_dismissed_at: null,
    organization_id: '405ea376-0d27-4898-b198-0edb2a87ff38',
    legal_entity_id: '895fd4ad-7219-4982-b8e4-a0c84f83e8d4',
    branch_status: 'active',
    readiness_state: 'ready',
    setup_reviewed_at: '2026-08-30T10:00:00.000Z',
    setup_reviewed_by: USER_ID,
  };
}

function readyBootstrap(accountId = BRANCH_A): MobileBootstrap {
  return {
    status: 'ready',
    profile: { ...profile, account_id: accountId },
    branches: [branch(BRANCH_A), branch(BRANCH_B)],
    branch: branch(accountId),
    account: account(accountId),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function createDependencies(options?: {
  restoredSession?: Session | null;
  bootstrap?: MobileBootstrap;
}) {
  let listener:
    ((event: AuthChangeEvent, nextSession: Session | null) => void) | undefined;
  let selectedBranchId: string | null = BRANCH_A;
  const unsubscribe = jest.fn();
  const restoredSession =
    options?.restoredSession === undefined
      ? session('initial-token')
      : options.restoredSession;
  const bootstrap = options?.bootstrap ?? readyBootstrap();

  const dependencies = {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: restoredSession },
        error: null,
      }),
      getUser: jest.fn().mockResolvedValue({
        data: { user },
        error: null,
      }),
      onAuthStateChange: jest.fn(
        (
          callback: (
            event: AuthChangeEvent,
            nextSession: Session | null
          ) => void
        ) => {
          listener = callback;
          return { data: { subscription: { unsubscribe } } };
        }
      ),
    },
    source: {},
    loadBootstrap: jest.fn().mockResolvedValue(bootstrap),
    preference: {
      get: jest.fn().mockResolvedValue(BRANCH_A),
      set: jest.fn().mockResolvedValue(undefined),
      clear: jest.fn().mockResolvedValue(undefined),
    },
    selectedBranch: {
      get: jest.fn(() => selectedBranchId),
      set: jest.fn((accountId: string | null) => {
        selectedBranchId = accountId;
      }),
    },
    actions: {
      signInWithPassword: jest.fn(),
      signInWithGoogle: jest.fn(),
      signOut: jest.fn().mockResolvedValue({
        status: 'success',
        remote: 'success',
        localAuth: 'success',
        branchPreference: 'success',
      }),
      purgeLocalSession: jest.fn().mockResolvedValue({
        localAuth: 'success',
        branchPreference: 'success',
      }),
    },
  };

  return {
    dependencies: dependencies as unknown as AuthProviderDependencies,
    raw: dependencies,
    emit(event: AuthChangeEvent, nextSession: Session | null) {
      if (!listener) throw new Error('Auth listener is not registered.');
      listener(event, nextSession);
    },
    unsubscribe,
  };
}

let latest: AuthContextValue | undefined;

function Probe() {
  const value = useAuth();
  useEffect(() => {
    latest = value;
  }, [value]);
  return null;
}

function TestProvider({
  dependencies,
  children,
}: PropsWithChildren<{ dependencies: AuthProviderDependencies }>) {
  return <AuthProvider dependencies={dependencies}>{children}</AuthProvider>;
}

describe('AuthProvider', () => {
  beforeEach(() => {
    latest = undefined;
  });

  it('settles cold start without a stored session as signed out', async () => {
    const setup = createDependencies({ restoredSession: null });

    render(
      <TestProvider dependencies={setup.dependencies}>
        <Probe />
      </TestProvider>
    );

    await waitFor(() => expect(latest?.state.status).toBe('signed_out'));
    expect(setup.raw.auth.getUser).not.toHaveBeenCalled();
    expect(setup.raw.loadBootstrap).not.toHaveBeenCalled();
    expect(setup.raw.selectedBranch.set).toHaveBeenCalledWith(null);
    expect(setup.raw.actions.purgeLocalSession).toHaveBeenCalledTimes(1);
  });

  it('settles a rejected initial restore safely while keeping auth recovery subscribed', async () => {
    const setup = createDependencies();
    setup.raw.auth.getSession.mockRejectedValueOnce(
      new Error('SecureStore platform diagnostic with token material')
    );

    render(
      <TestProvider dependencies={setup.dependencies}>
        <Probe />
      </TestProvider>
    );

    await waitFor(() =>
      expect(latest?.state).toEqual({
        status: 'signed_out',
        error: 'Could not restore your session. Sign in again.',
      })
    );
    expect(setup.raw.auth.onAuthStateChange).toHaveBeenCalledTimes(1);
    expect(setup.unsubscribe).not.toHaveBeenCalled();

    act(() => setup.emit('SIGNED_IN', session('recovered-session')));
    await waitFor(() => {
      expect(latest?.state.status).toBe('ready');
      if (latest?.state.status === 'ready') {
        expect(latest.state.session.access_token).toBe('recovered-session');
      }
    });
  });

  it('requires server-validated identity before restoring ready state', async () => {
    const restoredSession = session('restored-token');
    const setup = createDependencies({ restoredSession });

    render(
      <TestProvider dependencies={setup.dependencies}>
        <Probe />
      </TestProvider>
    );

    await waitFor(() => expect(latest?.state.status).toBe('ready'));
    expect(setup.raw.auth.getUser).toHaveBeenCalledTimes(1);
    expect(setup.raw.loadBootstrap).toHaveBeenCalledWith(
      setup.raw.source,
      USER_ID,
      BRANCH_A
    );
    const bootstrap = readyBootstrap();
    if (bootstrap.status !== 'ready') throw new Error('Invalid test fixture.');
    expect(latest?.state).toEqual({
      status: 'ready',
      session: restoredSession,
      profile: bootstrap.profile,
      branches: bootstrap.branches,
      branch: bootstrap.branch,
      account: bootstrap.account,
    });
  });

  it('publishes a newer initial session without waiting for obsolete restoration', async () => {
    const oldSession = session('old-session');
    const newerSession = session('newer-session');
    const setup = createDependencies({ restoredSession: oldSession });
    const oldBootstrap = deferred<MobileBootstrap>();
    setup.raw.loadBootstrap
      .mockImplementationOnce(async () => oldBootstrap.promise)
      .mockResolvedValueOnce(readyBootstrap(BRANCH_B));

    render(
      <TestProvider dependencies={setup.dependencies}>
        <Probe />
      </TestProvider>
    );
    await waitFor(() =>
      expect(setup.raw.loadBootstrap).toHaveBeenCalledTimes(1)
    );

    act(() => setup.emit('INITIAL_SESSION', newerSession));
    await waitFor(() => {
      expect(setup.raw.loadBootstrap).toHaveBeenCalledTimes(2);
      expect(latest?.state.status).toBe('ready');
      if (latest?.state.status === 'ready') {
        expect(latest.state.session).toBe(newerSession);
        expect(latest.state.branch.account_id).toBe(BRANCH_B);
      }
    });
    const preferenceCallsBeforeObsolete =
      setup.raw.preference.set.mock.calls.length;

    await act(async () => {
      oldBootstrap.resolve(readyBootstrap(BRANCH_A));
      await oldBootstrap.promise;
    });
    expect(latest?.state.status).toBe('ready');
    if (latest?.state.status === 'ready') {
      expect(latest.state.session).toBe(newerSession);
      expect(latest.state.branch.account_id).toBe(BRANCH_B);
    }
    expect(setup.raw.preference.set).toHaveBeenCalledTimes(
      preferenceCallsBeforeObsolete
    );
    expect(setup.raw.selectedBranch.get()).toBe(BRANCH_B);
  });

  it('deduplicates an initial session with the same stable identity and access token', async () => {
    const restoredSession = session('same-session');
    const setup = createDependencies({ restoredSession });

    render(
      <TestProvider dependencies={setup.dependencies}>
        <Probe />
      </TestProvider>
    );
    await waitFor(() => expect(latest?.state.status).toBe('ready'));

    act(() =>
      setup.emit('INITIAL_SESSION', {
        ...restoredSession,
        user: { ...restoredSession.user },
      })
    );
    await act(async () => Promise.resolve());

    expect(setup.raw.loadBootstrap).toHaveBeenCalledTimes(1);
    if (latest?.state.status === 'ready') {
      expect(latest.state.session).toBe(restoredSession);
    }
  });

  it('does not bootstrap when the stored session cannot be validated', async () => {
    const setup = createDependencies();
    setup.raw.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: new Error('invalid jwt with server details'),
    });

    render(
      <TestProvider dependencies={setup.dependencies}>
        <Probe />
      </TestProvider>
    );

    await waitFor(() => expect(latest?.state.status).toBe('signed_out'));
    expect(latest?.state).toEqual({
      status: 'signed_out',
      error: 'Your session expired. Sign in again.',
    });
    expect(setup.raw.loadBootstrap).not.toHaveBeenCalled();
  });

  it('settles safely when server identity validation rejects unexpectedly', async () => {
    const setup = createDependencies();
    setup.raw.auth.getUser.mockRejectedValueOnce(new Error('network secret'));

    render(
      <TestProvider dependencies={setup.dependencies}>
        <Probe />
      </TestProvider>
    );

    await waitFor(() => expect(latest?.state.status).toBe('signed_out'));
    expect(latest?.state).toEqual({
      status: 'signed_out',
      error: 'Could not verify your session. Sign in again.',
    });
    expect(setup.raw.loadBootstrap).not.toHaveBeenCalled();
  });

  it('exposes branch choice when an existing user has multiple branches', async () => {
    const branches = [branch(BRANCH_A), branch(BRANCH_B)];
    const setup = createDependencies({
      bootstrap: { status: 'choose', profile, branches },
    });

    render(
      <TestProvider dependencies={setup.dependencies}>
        <Probe />
      </TestProvider>
    );

    await waitFor(() => expect(latest?.state.status).toBe('choose_branch'));
    expect(latest?.state).toEqual({
      status: 'choose_branch',
      profile,
      branches,
    });
  });

  it('exposes a safe blocked membership state', async () => {
    const branches = [branch(BRANCH_A)];
    const setup = createDependencies({
      bootstrap: {
        status: 'blocked',
        profile,
        branches,
        reason: 'no_active_branch',
      },
    });

    render(
      <TestProvider dependencies={setup.dependencies}>
        <Probe />
      </TestProvider>
    );

    await waitFor(() => expect(latest?.state.status).toBe('blocked'));
    expect(latest?.state).toEqual({
      status: 'blocked',
      profile,
      branches,
      reason: 'no_active_branch',
    });
  });

  it('preserves the exact authorized branch when the token refreshes', async () => {
    const setup = createDependencies();

    render(
      <TestProvider dependencies={setup.dependencies}>
        <Probe />
      </TestProvider>
    );
    await waitFor(() => expect(latest?.state.status).toBe('ready'));

    const refreshedSession = session('refreshed-token');
    act(() => setup.emit('TOKEN_REFRESHED', refreshedSession));

    await waitFor(() => {
      expect(latest?.state.status).toBe('ready');
      if (latest?.state.status === 'ready') {
        expect(latest.state.session).toBe(refreshedSession);
      }
      expect(setup.raw.loadBootstrap).toHaveBeenLastCalledWith(
        setup.raw.source,
        USER_ID,
        BRANCH_A
      );
    });
  });

  it('keeps branch A published until branch B validation and persistence both succeed', async () => {
    const setup = createDependencies();
    const branchSwitch = deferred<MobileBootstrap>();
    const preferenceWrite = deferred<void>();
    setup.raw.loadBootstrap
      .mockResolvedValueOnce(readyBootstrap(BRANCH_A))
      .mockImplementationOnce(async () => branchSwitch.promise);

    render(
      <TestProvider dependencies={setup.dependencies}>
        <Probe />
      </TestProvider>
    );
    await waitFor(() => expect(latest?.state.status).toBe('ready'));
    setup.raw.selectedBranch.set.mockClear();
    setup.raw.preference.set.mockClear();
    setup.raw.preference.set.mockImplementationOnce(
      async () => preferenceWrite.promise
    );

    let selection!: Promise<void>;
    act(() => {
      selection = latest!.selectBranch(BRANCH_B);
    });
    await waitFor(() =>
      expect(setup.raw.loadBootstrap).toHaveBeenCalledTimes(2)
    );
    expect(setup.raw.selectedBranch.get()).toBe(BRANCH_A);
    expect(latest?.state.status).toBe('ready');
    if (latest?.state.status === 'ready') {
      expect(latest.state.branch.account_id).toBe(BRANCH_A);
    }

    await act(async () => {
      branchSwitch.resolve(readyBootstrap(BRANCH_B));
      await branchSwitch.promise;
    });
    await waitFor(() =>
      expect(setup.raw.preference.set).toHaveBeenCalledWith(BRANCH_B)
    );
    expect(setup.raw.selectedBranch.get()).toBe(BRANCH_A);
    if (latest?.state.status === 'ready') {
      expect(latest.state.branch.account_id).toBe(BRANCH_A);
    }

    await act(async () => {
      preferenceWrite.resolve();
      await selection;
    });
    expect(setup.raw.selectedBranch.get()).toBe(BRANCH_B);
    expect(setup.raw.selectedBranch.set).toHaveBeenCalledTimes(1);
    expect(latest?.state.status).toBe('ready');
    if (latest?.state.status === 'ready') {
      expect(latest.state.branch.account_id).toBe(BRANCH_B);
    }
  });

  it('lets a refreshed session supersede delayed branch work without losing the requested branch', async () => {
    const setup = createDependencies();
    const obsoleteSwitch = deferred<MobileBootstrap>();
    setup.raw.loadBootstrap
      .mockResolvedValueOnce(readyBootstrap(BRANCH_A))
      .mockImplementationOnce(async () => obsoleteSwitch.promise)
      .mockResolvedValueOnce(readyBootstrap(BRANCH_B));

    render(
      <TestProvider dependencies={setup.dependencies}>
        <Probe />
      </TestProvider>
    );
    await waitFor(() => expect(latest?.state.status).toBe('ready'));
    setup.raw.preference.set.mockClear();

    act(() => {
      void latest!.selectBranch(BRANCH_B);
    });
    await waitFor(() =>
      expect(setup.raw.loadBootstrap).toHaveBeenCalledTimes(2)
    );
    act(() => setup.emit('TOKEN_REFRESHED', session('new-refresh')));

    await waitFor(() => {
      expect(setup.raw.loadBootstrap).toHaveBeenCalledTimes(3);
      expect(setup.raw.loadBootstrap).toHaveBeenLastCalledWith(
        setup.raw.source,
        USER_ID,
        BRANCH_B
      );
      expect(latest?.state.status).toBe('ready');
      if (latest?.state.status === 'ready') {
        expect(latest.state.session.access_token).toBe('new-refresh');
        expect(latest.state.branch.account_id).toBe(BRANCH_B);
      }
    });

    const preferenceCallsBeforeObsolete =
      setup.raw.preference.set.mock.calls.length;
    await act(async () => {
      obsoleteSwitch.resolve(readyBootstrap(BRANCH_B));
      await obsoleteSwitch.promise;
    });
    expect(setup.raw.preference.set).toHaveBeenCalledTimes(
      preferenceCallsBeforeObsolete
    );
  });

  it('uses service-owned cleanup exactly once for explicit sign-out and its event', async () => {
    const setup = createDependencies();
    setup.raw.actions.signOut.mockImplementationOnce(async () => {
      await setup.raw.preference.clear();
      setup.emit('SIGNED_OUT', null);
      return {
        status: 'success',
        remote: 'success',
        localAuth: 'success',
        branchPreference: 'success',
      } as const;
    });

    render(
      <TestProvider dependencies={setup.dependencies}>
        <Probe />
      </TestProvider>
    );
    await waitFor(() => expect(latest?.state.status).toBe('ready'));
    setup.raw.selectedBranch.set.mockClear();
    setup.raw.preference.clear.mockClear();

    await act(async () => latest!.signOut());

    await waitFor(() => {
      expect(latest?.state).toEqual({ status: 'signed_out' });
    });
    expect(setup.raw.actions.signOut).toHaveBeenCalledWith('initial-token');
    expect(setup.raw.selectedBranch.set).toHaveBeenCalledTimes(1);
    expect(setup.raw.preference.clear).toHaveBeenCalledTimes(1);
  });

  it('signs out immediately ahead of delayed bootstrap and rejects a later refresh event', async () => {
    const setup = createDependencies();
    const obsoleteBootstrap = deferred<MobileBootstrap>();
    const remoteSignOut =
      deferred<
        Awaited<ReturnType<AuthProviderDependencies['actions']['signOut']>>
      >();
    setup.raw.loadBootstrap.mockImplementationOnce(
      async () => obsoleteBootstrap.promise
    );
    setup.raw.actions.signOut.mockImplementationOnce(
      async () => remoteSignOut.promise
    );

    render(
      <TestProvider dependencies={setup.dependencies}>
        <Probe />
      </TestProvider>
    );
    await waitFor(() =>
      expect(setup.raw.loadBootstrap).toHaveBeenCalledTimes(1)
    );
    setup.raw.preference.set.mockClear();

    let pendingSignOut!: Promise<void>;
    act(() => {
      pendingSignOut = latest!.signOut();
    });
    await waitFor(() => expect(latest?.state.status).toBe('signed_out'));
    expect(setup.raw.selectedBranch.get()).toBeNull();
    expect(setup.raw.actions.signOut).toHaveBeenCalledWith('initial-token');

    await act(async () => {
      obsoleteBootstrap.resolve(readyBootstrap(BRANCH_A));
      await obsoleteBootstrap.promise;
    });
    expect(setup.raw.preference.set).not.toHaveBeenCalled();
    expect(latest?.state.status).toBe('signed_out');

    remoteSignOut.resolve({
      status: 'error',
      remote: 'failed',
      localAuth: 'success',
      branchPreference: 'success',
      message:
        'Signed out on this device, but the remote session could not be closed.',
    });
    await act(async () => pendingSignOut);

    act(() => setup.emit('TOKEN_REFRESHED', session('late-refresh')));
    await act(async () => Promise.resolve());
    expect(setup.raw.loadBootstrap).toHaveBeenCalledTimes(1);
    expect(latest?.state.status).toBe('signed_out');
    expect(setup.raw.actions.purgeLocalSession).toHaveBeenCalled();
  });

  it('clears branch state exactly once for an external signed-out event', async () => {
    const setup = createDependencies();
    setup.raw.actions.purgeLocalSession.mockImplementationOnce(async () => {
      await setup.raw.preference.clear();
      return {
        localAuth: 'success',
        branchPreference: 'success',
      } as const;
    });

    render(
      <TestProvider dependencies={setup.dependencies}>
        <Probe />
      </TestProvider>
    );
    await waitFor(() => expect(latest?.state.status).toBe('ready'));
    setup.raw.selectedBranch.set.mockClear();
    setup.raw.preference.clear.mockClear();

    act(() => setup.emit('SIGNED_OUT', null));

    await waitFor(() =>
      expect(latest?.state).toEqual({ status: 'signed_out' })
    );
    expect(setup.raw.selectedBranch.set).toHaveBeenCalledTimes(1);
    expect(setup.raw.preference.clear).toHaveBeenCalledTimes(1);
    expect(setup.raw.actions.purgeLocalSession).toHaveBeenCalledTimes(1);
  });

  it('does not retain an earlier sign-out failure after a later success', async () => {
    const setup = createDependencies();
    setup.raw.actions.signOut
      .mockResolvedValueOnce({
        status: 'error',
        remote: 'failed',
        localAuth: 'success',
        branchPreference: 'success',
        message:
          'Signed out on this device, but the remote session could not be closed.',
      })
      .mockResolvedValueOnce({
        status: 'success',
        remote: 'success',
        localAuth: 'success',
        branchPreference: 'success',
      });

    render(
      <TestProvider dependencies={setup.dependencies}>
        <Probe />
      </TestProvider>
    );
    await waitFor(() => expect(latest?.state.status).toBe('ready'));

    await act(async () => latest!.signOut());
    expect(latest?.state.status).toBe('signed_out');
    if (latest?.state.status === 'signed_out') {
      expect(latest.state.error).toBeDefined();
    }

    await act(async () => latest!.signOut());
    expect(latest?.state).toEqual({ status: 'signed_out' });
  });

  it('invalidates unmounted work so it cannot overwrite a remounted provider', async () => {
    const setup = createDependencies();
    const pendingBootstrap = deferred<MobileBootstrap>();
    setup.raw.loadBootstrap.mockImplementationOnce(
      async () => pendingBootstrap.promise
    );
    const view = render(
      <TestProvider dependencies={setup.dependencies}>
        <Probe />
      </TestProvider>
    );
    await waitFor(() =>
      expect(setup.raw.loadBootstrap).toHaveBeenCalledTimes(1)
    );

    view.unmount();
    expect(setup.unsubscribe).toHaveBeenCalledTimes(1);

    const remount = createDependencies({
      restoredSession: session('remounted-session'),
      bootstrap: readyBootstrap(BRANCH_B),
    });
    remount.raw.selectedBranch = setup.raw.selectedBranch;
    remount.raw.preference = setup.raw.preference;
    render(
      <TestProvider dependencies={remount.dependencies}>
        <Probe />
      </TestProvider>
    );
    await waitFor(() => {
      expect(latest?.state.status).toBe('ready');
      if (latest?.state.status === 'ready') {
        expect(latest.state.branch.account_id).toBe(BRANCH_B);
      }
    });

    setup.raw.preference.set.mockClear();
    setup.raw.selectedBranch.set.mockClear();
    pendingBootstrap.resolve(readyBootstrap(BRANCH_A));
    await act(async () => pendingBootstrap.promise);

    expect(setup.raw.preference.set).not.toHaveBeenCalled();
    expect(setup.raw.selectedBranch.set).not.toHaveBeenCalled();
    expect(setup.raw.selectedBranch.get()).toBe(BRANCH_B);
    if (latest?.state.status === 'ready') {
      expect(latest.state.branch.account_id).toBe(BRANCH_B);
    }
  });
});

describe('requireReadyAuth', () => {
  const actions = {
    signInWithPassword: jest.fn(),
    signInWithGoogle: jest.fn(),
    signOut: jest.fn(),
    selectBranch: jest.fn(),
  };

  it('fails closed when a protected screen receives unresolved auth state', () => {
    expect(() =>
      requireReadyAuth({ state: { status: 'booting' }, ...actions })
    ).toThrow('Protected route rendered without ready authentication.');
  });

  it('returns a ready provider value without weakening its state type', () => {
    const ready = readyBootstrap();
    if (ready.status !== 'ready') throw new Error('Invalid test fixture.');
    const value: AuthContextValue = {
      state: {
        status: 'ready',
        session: session('ready-token'),
        profile: ready.profile,
        branches: ready.branches,
        branch: ready.branch,
        account: ready.account,
      },
      ...actions,
    };

    expect(requireReadyAuth(value)).toBe(value);
  });
});
