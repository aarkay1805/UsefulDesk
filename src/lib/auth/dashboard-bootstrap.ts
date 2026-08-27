import type { SupabaseClient } from '@supabase/supabase-js';

import { DEFAULT_CURRENCY } from '@/lib/currency';
import { isAccountRole, type AccountRole } from '@/lib/auth/roles';
import { isBranchAccountId } from '@/lib/auth/branch-context';
import { retryProfileLookup } from '@/lib/auth/account-recovery';
import { isMode, isThemeId, type Mode, type ThemeId } from '@/lib/themes';

export interface Profile {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  role: string | null;
  beta_features: string[];
  account_id: string | null;
  account_role: AccountRole | null;
  appearance_theme: ThemeId | null;
  appearance_mode: Mode | null;
}

export interface AccountSummary {
  id: string;
  name: string;
  created_at: string;
  default_currency: string;
  country_code: string | null;
  locale: string | null;
  timezone: string | null;
  date_order: string | null;
  time_format: string | null;
  week_start: number | null;
  phone_country_code: string | null;
  measurement_system: string | null;
  onboarding_dismissed_at: string | null;
  organization_id: string;
  legal_entity_id: string;
  branch_status: 'active' | 'read_only' | 'archived';
  readiness_state: 'setup' | 'ready' | 'attention';
  setup_reviewed_at: string | null;
  setup_reviewed_by: string | null;
}

export interface BranchAccount {
  account_id: string;
  account_name: string;
  organization_id: string;
  organization_name: string;
  legal_entity_id: string;
  legal_entity_name: string;
  role: AccountRole;
  branch_status: 'active' | 'read_only' | 'archived';
  readiness_state: 'setup' | 'ready' | 'attention';
  default_currency: string;
  timezone: string;
  is_organization_owner: boolean;
  setup_reviewed_at: string | null;
  setup_reviewed_by: string | null;
}

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

interface AppearanceRow {
  appearance_theme: unknown;
  appearance_mode: unknown;
}

export interface DashboardAuthBootstrap {
  profile: Profile | null;
  account: AccountSummary | null;
  branches: BranchAccount[];
  branchAccessError: string | null;
  accountStatusDetail: string | null;
}

const emptyBootstrap = (
  accountStatusDetail: string | null = null
): DashboardAuthBootstrap => ({
  profile: null,
  account: null,
  branches: [],
  branchAccessError: null,
  accountStatusDetail,
});

function baseProfile(
  row: ProfileRow,
  accountId: string | null,
  accountRole: AccountRole | null,
  appearance: AppearanceRow | null = null
): Profile {
  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    avatar_url: row.avatar_url,
    role: row.role,
    beta_features: row.beta_features ?? [],
    account_id: accountId,
    account_role: accountRole,
    appearance_theme: isThemeId(appearance?.appearance_theme)
      ? appearance.appearance_theme
      : null,
    appearance_mode: isMode(appearance?.appearance_mode)
      ? appearance.appearance_mode
      : null,
  };
}

function accountSummary(row: Record<string, unknown>): AccountSummary {
  return {
    id: String(row.id),
    name: String(row.name),
    created_at: String(row.created_at),
    default_currency:
      typeof row.default_currency === 'string'
        ? row.default_currency
        : DEFAULT_CURRENCY,
    country_code:
      typeof row.country_code === 'string' ? row.country_code : null,
    locale: typeof row.locale === 'string' ? row.locale : null,
    timezone: typeof row.timezone === 'string' ? row.timezone : null,
    date_order: typeof row.date_order === 'string' ? row.date_order : null,
    time_format: typeof row.time_format === 'string' ? row.time_format : null,
    week_start: typeof row.week_start === 'number' ? row.week_start : null,
    phone_country_code:
      typeof row.phone_country_code === 'string'
        ? row.phone_country_code
        : null,
    measurement_system:
      typeof row.measurement_system === 'string'
        ? row.measurement_system
        : null,
    onboarding_dismissed_at:
      typeof row.onboarding_dismissed_at === 'string'
        ? row.onboarding_dismissed_at
        : null,
    organization_id: String(row.organization_id),
    legal_entity_id: String(row.legal_entity_id),
    branch_status: row.branch_status as AccountSummary['branch_status'],
    readiness_state: row.readiness_state as AccountSummary['readiness_state'],
    setup_reviewed_at:
      typeof row.setup_reviewed_at === 'string' ? row.setup_reviewed_at : null,
    setup_reviewed_by:
      typeof row.setup_reviewed_by === 'string' ? row.setup_reviewed_by : null,
  };
}

/**
 * Build the dashboard's complete initial auth/account snapshot from the same
 * server client whose getUser() result guarded the layout. Profile and branch
 * access resolve together; once they identify an authorized branch, the
 * selected account and optional appearance reads resolve together. This keeps
 * the dependency graph at two database phases without letting the cosmetic
 * preference lookup add a third phase.
 */
export async function loadDashboardAuthBootstrap(
  db: SupabaseClient,
  userId: string,
  requestedBranchHeader: string | null
): Promise<DashboardAuthBootstrap> {
  const profilePromise = retryProfileLookup<ProfileRow, Error>(async () => {
    const result = await db
      .from('profiles')
      .select(
        'id, full_name, email, avatar_url, role, beta_features, account_id, account_role'
      )
      .eq('user_id', userId)
      .maybeSingle();
    return { data: result.data as ProfileRow | null, error: result.error };
  });
  const branchesPromise = db.rpc('my_branch_accounts');
  const [profileResult, branchesResult] = await Promise.all([
    profilePromise,
    branchesPromise,
  ]);

  if (profileResult.error) {
    console.error(
      '[dashboard bootstrap] profile lookup failed:',
      profileResult.error
    );
    return emptyBootstrap(profileResult.error.message);
  }
  if (!profileResult.data) {
    return emptyBootstrap('no profiles row for the signed-in user');
  }
  if (branchesResult.error) {
    console.error(
      '[dashboard bootstrap] branch lookup failed:',
      branchesResult.error
    );
    return {
      ...emptyBootstrap(branchesResult.error.message),
      branchAccessError: 'Could not load your branch access.',
    };
  }

  const branches = ((branchesResult.data ?? []) as BranchAccount[]).filter(
    (branch) =>
      isBranchAccountId(branch.account_id) && isAccountRole(branch.role)
  );
  const hasExplicitBranch = requestedBranchHeader !== null;
  const requestedBranch = isBranchAccountId(requestedBranchHeader)
    ? requestedBranchHeader
    : null;
  const selectedBranchId = hasExplicitBranch
    ? requestedBranch
    : profileResult.data.account_id;
  const selectedBranch = branches.find(
    (branch) => branch.account_id === selectedBranchId
  );

  if (hasExplicitBranch && (!requestedBranch || !selectedBranch)) {
    return {
      profile: baseProfile(profileResult.data, null, null),
      account: null,
      branches,
      accountStatusDetail: requestedBranch
        ? "the requested branch is not in this login's memberships"
        : 'the branch link does not contain a valid branch id',
      branchAccessError: requestedBranch
        ? 'You do not have access to this branch.'
        : 'This branch link is invalid.',
    };
  }
  if (selectedBranch?.branch_status === 'archived') {
    return {
      ...emptyBootstrap('the selected branch is archived'),
      branches,
      branchAccessError:
        'This branch is archived. Its retained history is available in organization reporting.',
    };
  }
  if (!selectedBranch) {
    return {
      ...emptyBootstrap(
        'no available branch membership for the signed-in user'
      ),
      branches,
      branchAccessError: 'Your login is not linked to an available branch.',
    };
  }

  const appearancePromise = db
    .from('profiles')
    .select('appearance_theme, appearance_mode')
    .eq('user_id', userId)
    .maybeSingle();
  const accountPromise = db
    .from('accounts')
    .select(
      'id, name, created_at, default_currency, country_code, locale, timezone, date_order, time_format, week_start, phone_country_code, measurement_system, onboarding_dismissed_at, organization_id, legal_entity_id, branch_status, readiness_state, setup_reviewed_at, setup_reviewed_by'
    )
    .eq('id', selectedBranch.account_id)
    .maybeSingle();
  const [appearanceResult, { data: accountRow, error: accountError }] =
    await Promise.all([appearancePromise, accountPromise]);

  let appearance: AppearanceRow | null = null;
  if (appearanceResult.error) {
    console.warn('[dashboard bootstrap] appearance unavailable:', {
      message: appearanceResult.error.message,
      code: appearanceResult.error.code,
    });
  } else {
    appearance = appearanceResult.data as AppearanceRow | null;
  }

  if (accountError) {
    console.error('[dashboard bootstrap] account lookup failed:', accountError);
    return {
      ...emptyBootstrap(`account lookup failed: ${accountError.message}`),
      branches,
    };
  }
  if (!accountRow) {
    return {
      ...emptyBootstrap('the selected account row is missing or unreadable'),
      branches,
    };
  }

  return {
    profile: baseProfile(
      profileResult.data,
      selectedBranch.account_id,
      selectedBranch.role,
      appearance
    ),
    account: accountSummary(accountRow as Record<string, unknown>),
    branches,
    branchAccessError: null,
    accountStatusDetail: null,
  };
}
