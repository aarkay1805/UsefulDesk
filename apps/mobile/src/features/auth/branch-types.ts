export type AccountRole = 'owner' | 'admin' | 'agent' | 'viewer';

export interface MobileProfile {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  role: string | null;
  beta_features: string[];
  account_id: string | null;
  account_role: AccountRole | null;
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

export type BranchResolution =
  | { status: 'ready'; branch: BranchAccount }
  | { status: 'choose'; branches: BranchAccount[] }
  | { status: 'blocked'; reason: string; branches: BranchAccount[] };

export type MobileBootstrap =
  | {
      status: 'ready';
      profile: MobileProfile;
      branches: BranchAccount[];
      branch: BranchAccount;
      account: AccountSummary;
    }
  | {
      status: 'choose';
      profile: MobileProfile;
      branches: BranchAccount[];
    }
  | {
      status: 'blocked';
      profile: MobileProfile | null;
      branches: BranchAccount[];
      reason: string;
    };
