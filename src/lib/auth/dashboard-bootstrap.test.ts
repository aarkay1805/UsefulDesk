import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDashboardAuthBootstrap } from './dashboard-bootstrap';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_ACCOUNT_ID = '00000000-0000-4000-8000-000000000002';

const profile = {
  id: 'profile-1',
  full_name: 'Gym Owner',
  email: 'owner@example.com',
  avatar_url: null,
  role: null,
  beta_features: [],
  account_id: ACCOUNT_ID,
  account_role: 'owner',
};

const branch = {
  account_id: ACCOUNT_ID,
  account_name: 'Useful Gym',
  organization_id: 'org-1',
  organization_name: 'Useful Fitness',
  legal_entity_id: 'legal-1',
  legal_entity_name: 'Useful Fitness Pvt Ltd',
  role: 'owner',
  branch_status: 'active',
  readiness_state: 'ready',
  default_currency: 'INR',
  timezone: 'Asia/Kolkata',
  is_organization_owner: true,
  setup_reviewed_at: null,
  setup_reviewed_by: null,
};

const account = {
  id: ACCOUNT_ID,
  name: 'Useful Gym',
  created_at: '2026-01-01T00:00:00.000Z',
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
  organization_id: 'org-1',
  legal_entity_id: 'legal-1',
  branch_status: 'active',
  readiness_state: 'ready',
  setup_reviewed_at: null,
  setup_reviewed_by: null,
};

function createDb(options?: {
  accountError?: { message: string } | null;
  branchError?: { message: string } | null;
  branches?: unknown[];
}) {
  const events: string[] = [];
  const from = vi.fn((table: string) => {
    let columns = '';
    const builder = {
      select(next: string) {
        columns = next;
        return builder;
      },
      eq() {
        return builder;
      },
      maybeSingle() {
        if (table === 'profiles' && columns.includes('appearance_theme')) {
          events.push('appearance');
          return Promise.resolve({
            data: { appearance_theme: 'cobalt', appearance_mode: 'dark' },
            error: null,
          });
        }
        if (table === 'profiles') {
          events.push('profile');
          return Promise.resolve({ data: profile, error: null });
        }
        if (table === 'accounts') {
          events.push('account');
          return Promise.resolve({
            data: options?.accountError ? null : account,
            error: options?.accountError ?? null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
    return builder;
  });
  const rpc = vi.fn(() => {
    events.push('branches');
    return Promise.resolve({
      data: options?.branches ?? [branch],
      error: options?.branchError ?? null,
    });
  });
  return { db: { from, rpc } as never, events, from };
}

describe('dashboard auth bootstrap', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads the bootstrap in two parallel phases and publishes a complete tenant snapshot', async () => {
    const { db, events } = createDb();

    const result = await loadDashboardAuthBootstrap(db, 'user-1', null);

    expect(events.slice(0, 2).sort()).toEqual(['branches', 'profile'].sort());
    expect(events.slice(2).sort()).toEqual(['account', 'appearance'].sort());
    expect(result).toMatchObject({
      profile: {
        account_id: ACCOUNT_ID,
        account_role: 'owner',
        appearance_theme: 'cobalt',
        appearance_mode: 'dark',
      },
      account: { id: ACCOUNT_ID, timezone: 'Asia/Kolkata' },
      branches: [{ account_id: ACCOUNT_ID }],
      branchAccessError: null,
      accountStatusDetail: null,
    });
  });

  it('fails closed before the account read for an unauthorized explicit branch', async () => {
    const { db, from } = createDb();

    const result = await loadDashboardAuthBootstrap(
      db,
      'user-1',
      OTHER_ACCOUNT_ID
    );

    expect(result.profile?.account_id).toBeNull();
    expect(result.account).toBeNull();
    expect(result.branchAccessError).toBe(
      'You do not have access to this branch.'
    );
    expect(from.mock.calls.filter(([table]) => table === 'accounts')).toEqual(
      []
    );
  });

  it('does not publish profile authority when the selected account is unreadable', async () => {
    const { db } = createDb({
      accountError: { message: 'network unavailable' },
    });

    const result = await loadDashboardAuthBootstrap(db, 'user-1', null);

    expect(result.profile).toBeNull();
    expect(result.account).toBeNull();
    expect(result.accountStatusDetail).toBe(
      'account lookup failed: network unavailable'
    );
  });

  it('fails closed before the account read when branch access cannot be verified', async () => {
    const { db, from } = createDb({
      branchError: { message: 'branch RPC unavailable' },
    });

    const result = await loadDashboardAuthBootstrap(db, 'user-1', null);

    expect(result.profile).toBeNull();
    expect(result.account).toBeNull();
    expect(result.branchAccessError).toBe('Could not load your branch access.');
    expect(from.mock.calls.filter(([table]) => table === 'accounts')).toEqual(
      []
    );
  });

  it('fails closed before the account read for an archived selected branch', async () => {
    const { db, from } = createDb({
      branches: [{ ...branch, branch_status: 'archived' }],
    });

    const result = await loadDashboardAuthBootstrap(db, 'user-1', null);

    expect(result.profile).toBeNull();
    expect(result.account).toBeNull();
    expect(result.branchAccessError).toMatch(/archived/i);
    expect(from.mock.calls.filter(([table]) => table === 'accounts')).toEqual(
      []
    );
  });
});
