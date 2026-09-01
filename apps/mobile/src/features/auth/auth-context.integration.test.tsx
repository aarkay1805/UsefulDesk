import {
  createClient,
  type AuthChangeEvent,
  type Session,
  type User,
} from '@supabase/supabase-js';
import { act, render, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';

import {
  AUTH_QUIESCENCE_TIMEOUT_MS,
  createAuthRefreshCoordinator,
} from '../../data/auth-refresh-coordinator';
import {
  createSecureSessionStorage,
  MOBILE_AUTH_STORAGE_KEY,
} from '../../data/secure-session-storage';
import {
  AuthProvider,
  type AuthContextValue,
  type AuthProviderDependencies,
  useAuth,
} from './auth-context';
import { createAuthService } from './auth-service';
import type {
  AccountSummary,
  BranchAccount,
  MobileBootstrap,
  MobileProfile,
} from './branch-types';

const SUPABASE_URL = 'https://example.supabase.co';
const PUBLIC_KEY = 'sb_publishable_synthetic-public-key';
const REDIRECT_URL = 'usefuldesk-agent://auth/callback';
const USER_ID = '00000000-0000-4000-8000-000000000042';
const BRANCH_ID = '00000000-0000-4000-8000-000000000043';

function encodeJwtPart(value: unknown): string {
  return globalThis
    .btoa(JSON.stringify(value))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

const user: User = {
  id: USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'asha@example.test',
  email_confirmed_at: '2026-08-31T10:00:00.000Z',
  phone: '',
  confirmed_at: '2026-08-31T10:00:00.000Z',
  last_sign_in_at: '2026-08-31T10:00:00.000Z',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  identities: [],
  created_at: '2026-08-31T10:00:00.000Z',
  updated_at: '2026-08-31T10:00:00.000Z',
  is_anonymous: false,
};

function session(): Session {
  const expiresAt = Math.floor(Date.now() / 1_000) + 3_600;
  return {
    access_token: `${encodeJwtPart({ alg: 'HS256', typ: 'JWT' })}.${encodeJwtPart(
      { sub: USER_ID, role: 'authenticated', exp: expiresAt }
    )}.${'a'.repeat(43)}`,
    refresh_token: 'synthetic-refresh-token',
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

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

const profile: MobileProfile = {
  id: USER_ID,
  full_name: 'Asha Rao',
  email: user.email!,
  avatar_url: null,
  role: null,
  beta_features: [],
  account_id: BRANCH_ID,
  account_role: 'admin',
};

const branch: BranchAccount = {
  account_id: BRANCH_ID,
  account_name: 'Useful Fitness',
  organization_id: '00000000-0000-4000-8000-000000000044',
  organization_name: 'Useful Fitness',
  legal_entity_id: '00000000-0000-4000-8000-000000000045',
  legal_entity_name: 'Useful Fitness Private Limited',
  role: 'admin',
  branch_status: 'active',
  readiness_state: 'ready',
  default_currency: 'INR',
  timezone: 'Asia/Kolkata',
  is_organization_owner: false,
  setup_reviewed_at: '2026-08-31T10:00:00.000Z',
  setup_reviewed_by: USER_ID,
};

const account: AccountSummary = {
  id: BRANCH_ID,
  name: 'Useful Fitness',
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
  organization_id: branch.organization_id,
  legal_entity_id: branch.legal_entity_id,
  branch_status: 'active',
  readiness_state: 'ready',
  setup_reviewed_at: branch.setup_reviewed_at,
  setup_reviewed_by: USER_ID,
};

const bootstrap: MobileBootstrap = {
  status: 'ready',
  profile,
  branches: [branch],
  branch,
  account,
};

let latest: AuthContextValue | undefined;

function Probe() {
  const value = useAuth();
  useEffect(() => {
    latest = value;
  }, [value]);
  return null;
}

function createHarness(browserResult: 'cancel' | 'dismiss' = 'cancel') {
  const values = new Map<string, string>();
  const sessionStorage = createSecureSessionStorage({
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => {
      values.set(key, value);
    },
    deleteItemAsync: async (key) => {
      values.delete(key);
    },
  });
  let passwordResponse: 'invalid' | 'success' = 'invalid';
  const authFetch = jest.fn(
    async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(requestUrl(input));
      if (
        url.pathname === '/auth/v1/token' &&
        url.searchParams.get('grant_type') === 'password'
      ) {
        return passwordResponse === 'success'
          ? jsonResponse(session())
          : jsonResponse(
              {
                error: 'invalid_grant',
                error_description: 'Invalid login credentials',
              },
              400
            );
      }
      if (url.pathname === '/auth/v1/user') return jsonResponse(user);
      if (url.pathname === '/auth/v1/logout') return jsonResponse({});
      return Promise.reject(new Error('Unexpected Auth JS network request'));
    }
  );
  const refreshCoordinator = createAuthRefreshCoordinator(
    authFetch,
    SUPABASE_URL
  );
  const client = createClient(SUPABASE_URL, PUBLIC_KEY, {
    global: { fetch: refreshCoordinator.fetch },
    auth: {
      storage: sessionStorage,
      storageKey: MOBILE_AUTH_STORAGE_KEY,
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
      lock: refreshCoordinator.lock,
      lockAcquireTimeout: AUTH_QUIESCENCE_TIMEOUT_MS,
    },
  });
  const retire = jest.spyOn(refreshCoordinator, 'retire');
  const purgeStorage = jest.spyOn(sessionStorage, 'purge');
  const localSignOut = jest.spyOn(client.auth, 'signOut');
  const browser = {
    openAuthSessionAsync: jest.fn().mockResolvedValue({ type: browserResult }),
  };
  const preference = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  };
  const service = createAuthService({
    auth: client.auth,
    linking: { createURL: jest.fn().mockReturnValue(REDIRECT_URL) },
    browser,
    preference,
    sessionStorage,
    remoteSession: {
      revoke: jest.fn().mockResolvedValue({ status: 'success' }),
    },
    refreshCoordinator,
  });
  const actions = {
    signInWithPassword: jest.fn(
      (...args: Parameters<typeof service.signInWithPassword>) =>
        service.signInWithPassword(...args)
    ),
    signInWithGoogle: jest.fn(
      (...args: Parameters<typeof service.signInWithGoogle>) =>
        service.signInWithGoogle(...args)
    ),
    signOut: jest.fn(service.signOut),
    purgeLocalSession: jest.fn(service.purgeLocalSession),
  };
  let selectedBranch: string | null = null;
  const dependencies: AuthProviderDependencies = {
    auth: client.auth,
    source: {
      getProfile: jest.fn(),
      getBranches: jest.fn(),
      getAccount: jest.fn(),
    },
    loadBootstrap: jest.fn().mockResolvedValue(bootstrap),
    preference,
    selectedBranch: {
      get: () => selectedBranch,
      set: (value) => {
        selectedBranch = value;
      },
    },
    actions,
  };
  const events: AuthChangeEvent[] = [];
  const eventSubscription = client.auth.onAuthStateChange((event) => {
    events.push(event);
  }).data.subscription;

  return {
    actions,
    authFetch,
    browser,
    client,
    dependencies,
    eventSubscription,
    events,
    localSignOut,
    purgeStorage,
    refreshCoordinator,
    retire,
    sessionStorage,
    setPasswordResponse(value: 'invalid' | 'success') {
      passwordResponse = value;
    },
    values,
  };
}

async function mountSignedOut(
  harness: ReturnType<typeof createHarness>
): Promise<ReturnType<typeof render>> {
  const view = render(
    <AuthProvider dependencies={harness.dependencies}>
      <Probe />
    </AuthProvider>
  );
  await waitFor(() => expect(latest?.state.status).toBe('signed_out'));
  await waitFor(() =>
    expect(harness.refreshCoordinator.isQuiescent()).toBe(true)
  );
  harness.actions.purgeLocalSession.mockClear();
  harness.retire.mockClear();
  harness.purgeStorage.mockClear();
  harness.localSignOut.mockClear();
  harness.events.length = 0;
  return view;
}

async function proveReplacementAndLaterSignedOut(
  harness: ReturnType<typeof createHarness>
): Promise<void> {
  harness.setPasswordResponse('success');
  await act(async () => {
    await latest!.signInWithPassword('asha@example.test', 'correct-password');
  });
  await waitFor(() => expect(latest?.state.status).toBe('ready'));
  harness.actions.purgeLocalSession.mockClear();

  await act(async () => {
    await harness.client.auth.signOut({ scope: 'local' });
  });
  await waitFor(() => expect(latest?.state.status).toBe('signed_out'));
  expect(harness.actions.purgeLocalSession).toHaveBeenCalledTimes(1);
  expect(harness.refreshCoordinator.isQuiescent()).toBe(true);
}

describe('AuthProvider real Auth JS rollback integration', () => {
  beforeEach(() => {
    latest = undefined;
  });

  it('preserves an invalid-password outcome while owning its real rollback event', async () => {
    const harness = createHarness();
    const view = await mountSignedOut(harness);

    let result!: Awaited<ReturnType<AuthContextValue['signInWithPassword']>>;
    await act(async () => {
      result = await latest!.signInWithPassword(
        'asha@example.test',
        'incorrect-password'
      );
    });

    expect(result).toEqual({
      status: 'error',
      message: 'Email or password is incorrect.',
    });
    expect(latest?.state).toEqual({ status: 'signed_out' });
    expect(harness.events).toContain('SIGNED_OUT');
    expect(harness.actions.purgeLocalSession).not.toHaveBeenCalled();
    expect(harness.retire).toHaveBeenCalledTimes(1);
    expect(harness.purgeStorage).toHaveBeenCalledTimes(1);
    expect(harness.localSignOut).toHaveBeenCalledTimes(1);
    expect(harness.refreshCoordinator.isQuiescent()).toBe(true);

    await proveReplacementAndLaterSignedOut(harness);
    view.unmount();
    harness.eventSubscription.unsubscribe();
    await harness.client.auth.stopAutoRefresh();
  });

  it.each(['cancel', 'dismiss'] as const)(
    'preserves Google %s while owning its real rollback event',
    async (browserResult) => {
      const harness = createHarness(browserResult);
      const view = await mountSignedOut(harness);

      let result!: Awaited<ReturnType<AuthContextValue['signInWithGoogle']>>;
      await act(async () => {
        result = await latest!.signInWithGoogle();
      });

      expect(result).toEqual({ status: 'cancelled' });
      expect(latest?.state).toEqual({ status: 'signed_out' });
      expect(harness.events).toContain('SIGNED_OUT');
      expect(harness.actions.purgeLocalSession).not.toHaveBeenCalled();
      expect(harness.retire).toHaveBeenCalledTimes(1);
      expect(harness.purgeStorage).toHaveBeenCalledTimes(1);
      expect(harness.localSignOut).toHaveBeenCalledTimes(1);
      expect(harness.refreshCoordinator.isQuiescent()).toBe(true);

      await proveReplacementAndLaterSignedOut(harness);
      view.unmount();
      harness.eventSubscription.unsubscribe();
      await harness.client.auth.stopAutoRefresh();
    }
  );
});
