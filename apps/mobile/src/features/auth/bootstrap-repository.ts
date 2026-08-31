import { mobileSupabase, selectedBranchRef } from '../../data/supabase';
import { branchPreference } from './branch-preference';
import type {
  AccountRole,
  AccountSummary,
  BranchAccount,
  MobileBootstrap,
  MobileProfile,
} from './branch-types';
import { resolveSelectedBranch } from './resolve-branch';

const PROFILE_COLUMNS =
  'id, full_name, email, avatar_url, role, beta_features, account_id, account_role';
const ACCOUNT_COLUMNS =
  'id, name, created_at, default_currency, country_code, locale, timezone, date_order, time_format, week_start, phone_country_code, measurement_system, onboarding_dismissed_at, organization_id, legal_entity_id, branch_status, readiness_state, setup_reviewed_at, setup_reviewed_by';

interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  role: string | null;
  beta_features: string[] | null;
  account_id: string | null;
  account_role: string | null;
}

export interface BootstrapSource {
  getProfile(userId: string): Promise<MobileProfile | null>;
  getBranches(): Promise<BranchAccount[]>;
  getAccount(accountId: string): Promise<AccountSummary | null>;
}

function isAccountRole(value: unknown): value is AccountRole {
  return (
    value === 'owner' ||
    value === 'admin' ||
    value === 'agent' ||
    value === 'viewer'
  );
}

function toMobileProfile(row: ProfileRow): MobileProfile {
  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    avatar_url: row.avatar_url,
    role: row.role,
    beta_features: row.beta_features ?? [],
    account_id: row.account_id,
    account_role: isAccountRole(row.account_role) ? row.account_role : null,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Could not load branch access.';
}

async function clearSelection(): Promise<void> {
  selectedBranchRef.set(null);
  try {
    await branchPreference.clear();
  } catch {
    // The in-memory branch context is the security boundary. A stale stored
    // value is revalidated on every startup and never scopes membership reads.
  }
}

export const mobileBootstrapSource: BootstrapSource = {
  async getProfile(userId) {
    const { data, error } = await mobileSupabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data ? toMobileProfile(data as ProfileRow) : null;
  },

  async getBranches() {
    const { data, error } = await mobileSupabase.rpc('my_branch_accounts');
    if (error) throw error;
    return (data ?? []) as BranchAccount[];
  },

  async getAccount(accountId) {
    const { data, error } = await mobileSupabase
      .from('accounts')
      .select(ACCOUNT_COLUMNS)
      .eq('id', accountId)
      .maybeSingle();
    if (error) throw error;
    return data as AccountSummary | null;
  },
};

export async function loadMobileBootstrap(
  source: BootstrapSource,
  userId: string,
  requestedBranchId: string | null
): Promise<MobileBootstrap> {
  selectedBranchRef.set(null);

  let profile: MobileProfile | null;
  let branches: BranchAccount[];
  try {
    [profile, branches] = await Promise.all([
      source.getProfile(userId),
      source.getBranches(),
    ]);
  } catch (error) {
    await clearSelection();
    return {
      status: 'blocked',
      profile: null,
      branches: [],
      reason: errorMessage(error),
    };
  }

  if (!profile) {
    await clearSelection();
    return {
      status: 'blocked',
      profile: null,
      branches,
      reason: 'No profile found for this user.',
    };
  }

  const resolution = resolveSelectedBranch({
    branches,
    profileBranchId: profile.account_id,
    requestedBranchId,
  });
  if (resolution.status === 'choose') {
    await clearSelection();
    return { status: 'choose', profile, branches: resolution.branches };
  }
  if (resolution.status === 'blocked') {
    await clearSelection();
    return {
      status: 'blocked',
      profile,
      branches: resolution.branches,
      reason: resolution.reason,
    };
  }

  selectedBranchRef.set(resolution.branch.account_id);
  try {
    const account = await source.getAccount(resolution.branch.account_id);
    if (!account) throw new Error('Selected branch account is unavailable.');
    await branchPreference.set(resolution.branch.account_id);

    return {
      status: 'ready',
      profile: {
        ...profile,
        account_id: resolution.branch.account_id,
        account_role: resolution.branch.role,
      },
      branches,
      branch: resolution.branch,
      account,
    };
  } catch (error) {
    await clearSelection();
    return {
      status: 'blocked',
      profile,
      branches,
      reason: errorMessage(error),
    };
  }
}
