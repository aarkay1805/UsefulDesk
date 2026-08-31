import { mobileSupabase } from '../../data/supabase';
import type {
  AccountRole,
  AccountSummary,
  BranchAccount,
  BranchBlockReason,
  MobileBootstrap,
  MobileProfile,
} from './branch-types';
import { resolveSelectedBranch } from './resolve-branch';

const PROFILE_COLUMNS =
  'id, full_name, email, avatar_url, role, beta_features, account_id, account_role';
const ACCOUNT_COLUMNS =
  'id, name, created_at, default_currency, country_code, locale, timezone, date_order, time_format, week_start, phone_country_code, measurement_system, onboarding_dismissed_at, organization_id, legal_entity_id, branch_status, readiness_state, setup_reviewed_at, setup_reviewed_by';

export interface BootstrapSource {
  getProfile(userId: string): Promise<unknown>;
  getBranches(): Promise<unknown>;
  getAccount(accountId: string): Promise<unknown>;
}

export interface BootstrapDiagnostic {
  stage:
    | 'profile_and_branches'
    | 'profile_data'
    | 'branch_data'
    | 'selected_account';
  category: 'exception' | 'unknown';
}

export type BootstrapDiagnosticReporter = (
  diagnostic: BootstrapDiagnostic
) => void;

type UnknownRow = Record<string, unknown>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRow(value: unknown): value is UnknownRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isUuidOrNull(value: unknown): value is string | null {
  return value === null || isUuid(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNumberOrNull(value: unknown): value is number | null {
  return (
    value === null || (typeof value === 'number' && Number.isFinite(value))
  );
}

function isAccountRole(value: unknown): value is AccountRole {
  return (
    value === 'owner' ||
    value === 'admin' ||
    value === 'agent' ||
    value === 'viewer'
  );
}

function isBranchStatus(
  value: unknown
): value is BranchAccount['branch_status'] {
  return value === 'active' || value === 'read_only' || value === 'archived';
}

function isReadinessState(
  value: unknown
): value is BranchAccount['readiness_state'] {
  return value === 'setup' || value === 'ready' || value === 'attention';
}

function parseProfile(value: unknown): MobileProfile | null {
  if (value === null) return null;
  if (
    !isRow(value) ||
    !isUuid(value.id) ||
    !isStringOrNull(value.full_name) ||
    typeof value.email !== 'string' ||
    !isStringOrNull(value.avatar_url) ||
    !isStringOrNull(value.role) ||
    (value.beta_features !== null &&
      (!Array.isArray(value.beta_features) ||
        !value.beta_features.every(
          (feature) => typeof feature === 'string'
        ))) ||
    !isUuidOrNull(value.account_id) ||
    (value.account_role !== null && !isAccountRole(value.account_role))
  ) {
    throw new Error('Invalid profile data.');
  }

  return {
    id: value.id,
    full_name: value.full_name,
    email: value.email,
    avatar_url: value.avatar_url,
    role: value.role,
    beta_features: value.beta_features ?? [],
    account_id: value.account_id,
    account_role: value.account_role,
  };
}

function parseBranch(value: unknown): BranchAccount | null {
  if (
    !isRow(value) ||
    !isUuid(value.account_id) ||
    typeof value.account_name !== 'string' ||
    !isUuid(value.organization_id) ||
    typeof value.organization_name !== 'string' ||
    !isUuid(value.legal_entity_id) ||
    typeof value.legal_entity_name !== 'string' ||
    !isAccountRole(value.role) ||
    !isBranchStatus(value.branch_status) ||
    !isReadinessState(value.readiness_state) ||
    typeof value.default_currency !== 'string' ||
    typeof value.timezone !== 'string' ||
    typeof value.is_organization_owner !== 'boolean' ||
    !isStringOrNull(value.setup_reviewed_at) ||
    !isUuidOrNull(value.setup_reviewed_by)
  ) {
    return null;
  }

  return {
    account_id: value.account_id,
    account_name: value.account_name,
    organization_id: value.organization_id,
    organization_name: value.organization_name,
    legal_entity_id: value.legal_entity_id,
    legal_entity_name: value.legal_entity_name,
    role: value.role,
    branch_status: value.branch_status,
    readiness_state: value.readiness_state,
    default_currency: value.default_currency,
    timezone: value.timezone,
    is_organization_owner: value.is_organization_owner,
    setup_reviewed_at: value.setup_reviewed_at,
    setup_reviewed_by: value.setup_reviewed_by,
  };
}

function parseBranches(value: unknown): BranchAccount[] {
  if (!Array.isArray(value)) throw new Error('Invalid branch access data.');
  return value.flatMap((row) => {
    const parsed = parseBranch(row);
    return parsed ? [parsed] : [];
  });
}

function parseAccount(
  value: unknown,
  selectedBranchId: string
): AccountSummary | null {
  if (value === null) return null;
  if (
    !isRow(value) ||
    !isUuid(value.id) ||
    value.id !== selectedBranchId ||
    typeof value.name !== 'string' ||
    typeof value.created_at !== 'string' ||
    typeof value.default_currency !== 'string' ||
    !isStringOrNull(value.country_code) ||
    !isStringOrNull(value.locale) ||
    !isStringOrNull(value.timezone) ||
    !isStringOrNull(value.date_order) ||
    !isStringOrNull(value.time_format) ||
    !isNumberOrNull(value.week_start) ||
    !isStringOrNull(value.phone_country_code) ||
    !isStringOrNull(value.measurement_system) ||
    !isStringOrNull(value.onboarding_dismissed_at) ||
    !isUuid(value.organization_id) ||
    !isUuid(value.legal_entity_id) ||
    !isBranchStatus(value.branch_status) ||
    value.branch_status === 'archived' ||
    !isReadinessState(value.readiness_state) ||
    !isStringOrNull(value.setup_reviewed_at) ||
    !isUuidOrNull(value.setup_reviewed_by)
  ) {
    throw new Error('Selected branch account response is invalid.');
  }

  return {
    id: value.id,
    name: value.name,
    created_at: value.created_at,
    default_currency: value.default_currency,
    country_code: value.country_code,
    locale: value.locale,
    timezone: value.timezone,
    date_order: value.date_order,
    time_format: value.time_format,
    week_start: value.week_start,
    phone_country_code: value.phone_country_code,
    measurement_system: value.measurement_system,
    onboarding_dismissed_at: value.onboarding_dismissed_at,
    organization_id: value.organization_id,
    legal_entity_id: value.legal_entity_id,
    branch_status: value.branch_status,
    readiness_state: value.readiness_state,
    setup_reviewed_at: value.setup_reviewed_at,
    setup_reviewed_by: value.setup_reviewed_by,
  };
}

function blocked(
  profile: MobileProfile | null,
  branches: BranchAccount[],
  reason: BranchBlockReason
): Extract<MobileBootstrap, { status: 'blocked' }> {
  return { status: 'blocked', profile, branches, reason };
}

function defaultDiagnosticReporter(diagnostic: BootstrapDiagnostic): void {
  if (process.env.NODE_ENV === 'development') {
    console.warn('Mobile branch bootstrap diagnostic', diagnostic);
  }
}

function reportDiagnostic(
  reporter: BootstrapDiagnosticReporter,
  stage: BootstrapDiagnostic['stage'],
  cause: unknown
): void {
  reporter({
    stage,
    category: cause instanceof Error ? 'exception' : 'unknown',
  });
}

export const mobileBootstrapSource: BootstrapSource = {
  async getProfile(userId) {
    const { data, error } = await mobileSupabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async getBranches() {
    const { data, error } = await mobileSupabase.rpc('my_branch_accounts');
    if (error) throw error;
    return data ?? [];
  },

  async getAccount(accountId) {
    const { data, error } = await mobileSupabase
      .from('accounts')
      .select(ACCOUNT_COLUMNS)
      .eq('id', accountId)
      .setHeader('x-usefuldesk-account-id', accountId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
};

export async function loadMobileBootstrap(
  source: BootstrapSource,
  userId: string,
  requestedBranchId: string | null,
  report: BootstrapDiagnosticReporter = defaultDiagnosticReporter
): Promise<MobileBootstrap> {
  let rawProfile: unknown;
  let rawBranches: unknown;
  try {
    [rawProfile, rawBranches] = await Promise.all([
      source.getProfile(userId),
      source.getBranches(),
    ]);
  } catch (error) {
    reportDiagnostic(report, 'profile_and_branches', error);
    return blocked(null, [], 'branch_access_unavailable');
  }

  let branches: BranchAccount[];
  try {
    branches = parseBranches(rawBranches);
  } catch (error) {
    reportDiagnostic(report, 'branch_data', error);
    return blocked(null, [], 'branch_access_unavailable');
  }

  let profile: MobileProfile | null;
  try {
    profile = parseProfile(rawProfile);
  } catch (error) {
    reportDiagnostic(report, 'profile_data', error);
    return blocked(null, branches, 'profile_unavailable');
  }

  if (!profile) {
    reportDiagnostic(report, 'profile_data', null);
    return blocked(null, branches, 'profile_unavailable');
  }

  const resolution = resolveSelectedBranch({
    branches,
    profileBranchId: profile.account_id,
    requestedBranchId,
  });
  if (resolution.status === 'choose') {
    return { status: 'choose', profile, branches: resolution.branches };
  }
  if (resolution.status === 'blocked') {
    return blocked(profile, resolution.branches, resolution.reason);
  }

  try {
    const account = parseAccount(
      await source.getAccount(resolution.branch.account_id),
      resolution.branch.account_id
    );
    if (!account) throw new Error('Selected branch account is unavailable.');

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
    reportDiagnostic(report, 'selected_account', error);
    return blocked(profile, branches, 'selected_branch_unavailable');
  }
}
