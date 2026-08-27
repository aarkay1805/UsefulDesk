'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';
import { DEFAULT_CURRENCY } from '@/lib/currency';
import {
  resolveAccountLocale,
  DEFAULT_ACCOUNT_LOCALE,
  type AccountLocale,
} from '@/lib/locale/config';
import {
  buildFormatters,
  DEFAULT_FORMATTERS,
  type LocaleFormatters,
} from '@/lib/locale/format';
import {
  canEditSettings as canEditSettingsFor,
  canManageMembers as canManageMembersFor,
  canSendMessages as canSendMessagesFor,
  type AccountRole,
} from '@/lib/auth/roles';
import {
  BRANCH_QUERY_PARAM,
  isBranchAccountId,
} from '@/lib/auth/branch-context';
import {
  resolveAccountStatus,
  type AccountStatus,
} from '@/lib/auth/account-recovery';
import {
  loadDashboardAuthBootstrap,
  type AccountSummary,
  type BranchAccount,
  type DashboardAuthBootstrap,
  type Profile,
} from '@/lib/auth/dashboard-bootstrap';

export type { AccountStatus } from '@/lib/auth/account-recovery';

export type { AccountSummary, BranchAccount, Profile };

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  /**
   * Session-level loading. Flips to false as soon as we know whether
   * a user is signed in, *without* waiting for the profile row. Use
   * this for chrome (sidebar / header) that can render with just the
   * user object.
   */
  loading: boolean;
  /**
   * Profile-row loading. Stays true until `fetchProfile` settles
   * (success, missing row, or error). Code that branches on
   * `profile.beta_features` MUST gate on this — otherwise it sees the
   * `{ loading: false, profile: null }` window during initial load
   * and may take the "not opted in" branch incorrectly.
   */
  profileLoading: boolean;
  signOut: () => Promise<void>;
  /** Re-fetch the current user's profile row — call after a save from
   *  the settings form so header/sidebar reflect the change without a
   *  full page reload. */
  refreshProfile: () => Promise<void>;

  // ----------------------------------------------------------
  // Account-scoped context (added by the account-sharing series)
  //
  // All of these are nullable until `profileLoading` is false.
  // After the profile resolves they're guaranteed to be set,
  // because migration 017 made `account_id` / `account_role`
  // NOT NULL on `profiles`.
  // ----------------------------------------------------------

  /** Outcome of resolving the signed-in user's branch and role. */
  accountStatus: AccountStatus;
  /** Underlying reason when account access is unresolved. */
  accountStatusDetail: string | null;
  /** Account id the current user belongs to. Null while loading. */
  accountId: string | null;
  /** Role within that account. Null while loading. */
  accountRole: AccountRole | null;
  /** Lightweight account meta — id + name + default_currency. Null while loading. */
  account: AccountSummary | null;
  /** Every branch this login may enter, returned by an auth-bound RPC. */
  branches: BranchAccount[];
  /** Selected organization, derived from the selected branch. */
  organizationId: string | null;
  /** True only for the selected branch's organization owner. */
  isOrganizationOwner: boolean;
  /** Fail-closed reason when an explicit URL branch is malformed/unauthorized. */
  branchAccessError: string | null;
  /** Audit the switch, then hard-reload into the target branch URL. */
  switchBranch: (accountId: string) => Promise<void>;
  /** Account default deal currency. Falls back to DEFAULT_CURRENCY only
   *  before account hydration; dashboard consumers mount after `ready`. */
  defaultCurrency: string;
  /** Resolved localization config (migration 055). India-shaped before
   *  hydration; dashboard consumers mount only after the account row loads. */
  locale: AccountLocale;
  /** Locale-bound formatters (dates, numbers, money, today) for
   *  `locale`. Prefer reading these via `useLocale()`. */
  fmt: LocaleFormatters;
  /** True if `accountRole === 'owner'`. */
  isOwner: boolean;
  /** True if `accountRole === 'admin'` (does NOT include owner — use canManageMembers for "admin or above"). */
  isAdmin: boolean;
  /** True if `accountRole === 'agent'`. */
  isAgent: boolean;
  /** True if `accountRole === 'viewer'`. */
  isViewer: boolean;
  /** True if the caller can manage members (admin+). */
  canManageMembers: boolean;
  /** True if the caller can edit account-wide settings (admin+). */
  canEditSettings: boolean;
  /** True if the caller can send messages and edit operational data (agent+). */
  canSendMessages: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * AuthProvider — wrap this around the dashboard layout.
 * A normal dashboard request starts from the server-validated user and
 * account bootstrap. The browser listener remains authoritative for later
 * refresh, sign-in, and sign-out events without repeating cold-start reads.
 */
export function AuthProvider({
  children,
  initialUser = null,
  initialBootstrap = null,
}: {
  children: ReactNode;
  initialUser?: User | null;
  initialBootstrap?: DashboardAuthBootstrap | null;
}) {
  const [user, setUser] = useState<User | null>(initialUser);
  const [profile, setProfile] = useState<Profile | null>(
    initialBootstrap?.profile ?? null
  );
  const [account, setAccount] = useState<AccountSummary | null>(
    initialBootstrap?.account ?? null
  );
  const [branches, setBranches] = useState<BranchAccount[]>(
    initialBootstrap?.branches ?? []
  );
  const [branchAccessError, setBranchAccessError] = useState<string | null>(
    initialBootstrap?.branchAccessError ?? null
  );
  const [accountStatusDetail, setAccountStatusDetail] = useState<string | null>(
    initialBootstrap?.accountStatusDetail ?? null
  );
  const [loading, setLoading] = useState(!initialUser);
  // Tracked separately from `loading`. The session settles fast (one
  // local cookie read); the profile fetch crosses the network and
  // settles later. Callers that gate on `profile.*` need to know which
  // window they're in — see the type doc above.
  const [profileLoading, setProfileLoading] = useState(!initialBootstrap);
  const hasServerBootstrap = Boolean(initialUser && initialBootstrap);

  // Tracks the user ID we've successfully initiated/completed fetching
  // a profile for. This prevents redundant re-fetches and toggling
  // profileLoading back to true on window focus events/token refresh.
  const lastFetchedUserIdRef = useRef<string | null>(
    initialUser && initialBootstrap ? initialUser.id : null
  );

  // Shared across init, auth-state-change listener, and the exposed
  // refreshProfile() callback. Reads the current session's user id and
  // pulls the matching profile row along with its account summary.
  const fetchProfile = useCallback(async (userId: string) => {
    const supabase = createClient();
    setProfileLoading(true);
    setAccountStatusDetail(null);
    lastFetchedUserIdRef.current = userId;
    try {
      const currentUrl = new URL(window.location.href);
      const requestedBranchHeader = currentUrl.searchParams.has(
        BRANCH_QUERY_PARAM
      )
        ? (currentUrl.searchParams.get(BRANCH_QUERY_PARAM) ?? 'invalid')
        : null;
      const next = await loadDashboardAuthBootstrap(
        supabase,
        userId,
        requestedBranchHeader
      );

      setProfile(next.profile);
      setAccount(next.account);
      setBranches(next.branches);
      setBranchAccessError(next.branchAccessError);
      setAccountStatusDetail(next.accountStatusDetail);
      if (!next.profile || (!next.account && !next.branchAccessError)) {
        lastFetchedUserIdRef.current = null;
      }
    } catch (err) {
      console.error('[AuthProvider] fetchProfile threw:', err);
      lastFetchedUserIdRef.current = null;
      setAccountStatusDetail(
        err instanceof Error ? err.message : 'profile fetch failed'
      );
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;

    const init = async () => {
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (error)
          console.error('[AuthProvider] getSession error:', error.message);

        if (!mounted) return;
        const currentUser = session?.user ?? null;
        setUser(currentUser);

        if (currentUser) {
          // Don't block session loading on profile fetch — chrome
          // (header, sidebar) can render from the user object alone,
          // profile enriches async. Callers that need to branch on
          // profile data gate on `profileLoading` instead.
          fetchProfile(currentUser.id);
        } else {
          // No user → no profile to load. Flip profileLoading off so
          // pages that gate on it don't wait forever on the logged-out
          // path (the route guard or redirect should fire instead).
          setProfileLoading(false);
        }
      } catch (err) {
        console.error('[AuthProvider] init threw:', err);
      } finally {
        if (mounted) setLoading(false);
        if (safetyTimer) clearTimeout(safetyTimer);
      }
    };

    // Dashboard cold loads already carry the validated server snapshot. Keep
    // getSession only as a fallback for isolated/tests or a future provider
    // mount that does not pass that snapshot.
    if (!hasServerBootstrap) {
      safetyTimer = setTimeout(() => {
        if (mounted) {
          console.warn('[AuthProvider] getSession() timed out after 3s');
          setLoading(false);
          setProfileLoading(false);
        }
      }, 3000);
      void init();
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      const currentUser = session?.user ?? null;
      setUser(currentUser);

      if (currentUser) {
        if (currentUser.id !== lastFetchedUserIdRef.current) {
          fetchProfile(currentUser.id);
        }
      } else {
        lastFetchedUserIdRef.current = null;
        setProfile(null);
        setAccount(null);
        setBranches([]);
        setBranchAccessError(null);
        setAccountStatusDetail(null);
        setProfileLoading(false);
      }

      setLoading(false);
    });

    return () => {
      mounted = false;
      if (safetyTimer) clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
  }, [fetchProfile, hasServerBootstrap]);

  const signOut = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setAccount(null);
    setBranches([]);
    setBranchAccessError(null);
    setAccountStatusDetail(null);
    // Tear down every authenticated client component after sign-out.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = '/login';
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user?.id) return;
    await fetchProfile(user.id);
  }, [user, fetchProfile]);

  const switchBranch = useCallback(async (accountId: string) => {
    if (!isBranchAccountId(accountId)) {
      throw new Error('This branch link is invalid.');
    }

    // The database is the authority for branch access. Do not preflight
    // against `branches`: a branch created or joined moments ago can be newer
    // than this provider snapshot even though its membership already exists.
    const supabase = createClient();
    const { error } = await supabase.rpc('record_branch_switch', {
      p_target_account_id: accountId,
    });
    if (error) throw error;

    const url = new URL(window.location.href);
    url.searchParams.set(BRANCH_QUERY_PARAM, accountId);
    // Branch selection changes tenant context used by proxy and server reads.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`${url.pathname}${url.search}${url.hash}`);
  }, []);

  // Derive the role booleans once per profile change rather than on
  // every consumer render. Cheap regardless, but the memo also gives
  // each derived value a stable identity for React.memo / useEffect
  // dependencies downstream.
  const derived = useMemo(() => {
    const role = profile?.account_role ?? null;
    return {
      accountRole: role,
      accountId: profile?.account_id ?? null,
      isOwner: role === 'owner',
      isAdmin: role === 'admin',
      isAgent: role === 'agent',
      isViewer: role === 'viewer',
      canManageMembers: role ? canManageMembersFor(role) : false,
      canEditSettings: role ? canEditSettingsFor(role) : false,
      canSendMessages: role ? canSendMessagesFor(role) : false,
    };
  }, [profile?.account_role, profile?.account_id]);

  // One resolved locale + formatter set for the whole tree. Recomputed
  // only when the account row identity changes (fetch / refreshProfile
  // after a Settings → Regional settings save).
  const localized = useMemo(() => {
    const cfg = account
      ? resolveAccountLocale(account)
      : DEFAULT_ACCOUNT_LOCALE;
    return { locale: cfg, fmt: buildFormatters(cfg) };
  }, [account]);

  const accountStatus = resolveAccountStatus({
    signedIn: Boolean(user),
    profileLoading,
    hasProfile: Boolean(profile),
    hasAccount: Boolean(account),
    accountId: derived.accountId,
    accountRole: derived.accountRole,
  });

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        profileLoading,
        signOut,
        refreshProfile,
        account,
        accountStatus,
        accountStatusDetail,
        branches,
        organizationId: account?.organization_id ?? null,
        isOrganizationOwner:
          branches.find((branch) => branch.account_id === derived.accountId)
            ?.is_organization_owner ?? false,
        branchAccessError,
        switchBranch,
        defaultCurrency: account?.default_currency ?? DEFAULT_CURRENCY,
        ...localized,
        ...derived,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/**
 * useAuth — read the shared auth state from context.
 * Must be used inside an <AuthProvider>.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // Fallback for components rendered outside the provider (shouldn't
    // happen in normal flow, but don't crash the page). Account state
    // collapses to least-privileged null — every `canX` boolean is
    // false so UI gates fail closed.
    return {
      user: null,
      profile: null,
      loading: false,
      profileLoading: false,
      signOut: async () => {
        // Fallback sign-out still needs to discard the current app tree.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = '/login';
      },
      refreshProfile: async () => {},
      account: null,
      accountStatus: 'loading',
      accountStatusDetail: null,
      branches: [],
      organizationId: null,
      isOrganizationOwner: false,
      branchAccessError: null,
      switchBranch: async () => {},
      defaultCurrency: DEFAULT_CURRENCY,
      locale: DEFAULT_ACCOUNT_LOCALE,
      fmt: DEFAULT_FORMATTERS,
      accountId: null,
      accountRole: null,
      isOwner: false,
      isAdmin: false,
      isAgent: false,
      isViewer: false,
      canManageMembers: false,
      canEditSettings: false,
      canSendMessages: false,
    };
  }
  return ctx;
}
