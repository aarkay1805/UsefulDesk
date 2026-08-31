import { selectedBranchRef } from '../../data/supabase';
import type {
  AccountSummary,
  BranchAccount,
  MobileProfile,
} from './branch-types';
import { branchBlockMessage } from './branch-types';
import {
  loadMobileBootstrap,
  type BootstrapSource,
} from './bootstrap-repository';

const BRANCH_A = 'd3648c54-a4aa-4dd8-8566-1e3b38c1f497';
const BRANCH_B = 'f8b2a93d-bfa4-485a-8ab1-1b37862d6d72';
const USER_ID = '53f7dd9e-e2fd-4824-a773-a0ce541048ec';

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

describe('loadMobileBootstrap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    selectedBranchRef.set(null);
  });

  it('validates the candidate account without changing the published branch header', async () => {
    const profileRead = deferred<MobileProfile | null>();
    const branchRead = deferred<BranchAccount[]>();
    let profileStarted = false;
    let branchesStarted = false;
    const accountReads: string[] = [];
    const source: BootstrapSource = {
      getProfile: async (userId) => {
        expect(userId).toBe(USER_ID);
        expect(selectedBranchRef.get()).toBe(BRANCH_A);
        profileStarted = true;
        return profileRead.promise;
      },
      getBranches: async () => {
        expect(selectedBranchRef.get()).toBe(BRANCH_A);
        branchesStarted = true;
        return branchRead.promise;
      },
      getAccount: async (accountId) => {
        accountReads.push(accountId);
        expect(selectedBranchRef.get()).toBe(BRANCH_A);
        return account(accountId);
      },
    };

    selectedBranchRef.set(BRANCH_A);
    const pending = loadMobileBootstrap(source, USER_ID, BRANCH_B);
    await Promise.resolve();

    expect(profileStarted).toBe(true);
    expect(branchesStarted).toBe(true);
    expect(accountReads).toEqual([]);

    profileRead.resolve(profile);
    branchRead.resolve([branch(BRANCH_A), branch(BRANCH_B)]);
    await expect(pending).resolves.toEqual({
      status: 'ready',
      profile: { ...profile, account_id: BRANCH_B, account_role: 'admin' },
      branches: [branch(BRANCH_A), branch(BRANCH_B)],
      branch: branch(BRANCH_B),
      account: account(BRANCH_B),
    });
    expect(accountReads).toEqual([BRANCH_B]);
    expect(selectedBranchRef.get()).toBe(BRANCH_A);
  });

  it('fails closed without loading another account after an explicit unauthorized request', async () => {
    let accountRead = false;
    const branches = [branch(BRANCH_A)];
    const source: BootstrapSource = {
      getProfile: async () => profile,
      getBranches: async () => branches,
      getAccount: async () => {
        accountRead = true;
        return account(BRANCH_A);
      },
    };

    selectedBranchRef.set(BRANCH_A);
    await expect(
      loadMobileBootstrap(source, USER_ID, BRANCH_B)
    ).resolves.toEqual({
      status: 'blocked',
      profile,
      branches,
      reason: 'branch_access_denied',
    });

    expect(accountRead).toBe(false);
    expect(selectedBranchRef.get()).toBe(BRANCH_A);
  });

  it('returns a choice without loading or persisting an account', async () => {
    let accountRead = false;
    const branches = [branch(BRANCH_A), branch(BRANCH_B)];
    const source: BootstrapSource = {
      getProfile: async () => ({ ...profile, account_id: null }),
      getBranches: async () => branches,
      getAccount: async () => {
        accountRead = true;
        return account(BRANCH_A);
      },
    };

    await expect(loadMobileBootstrap(source, USER_ID, null)).resolves.toEqual({
      status: 'choose',
      profile: { ...profile, account_id: null },
      branches,
    });

    expect(accountRead).toBe(false);
    expect(selectedBranchRef.get()).toBeNull();
  });

  it('blocks a malformed profile before resolving a branch', async () => {
    let accountRead = false;
    const source: BootstrapSource = {
      getProfile: async () =>
        ({ ...profile, account_id: 'not-a-uuid' }) as MobileProfile,
      getBranches: async () => [branch(BRANCH_A)],
      getAccount: async () => {
        accountRead = true;
        return account(BRANCH_A);
      },
    };

    await expect(loadMobileBootstrap(source, USER_ID, null)).resolves.toEqual({
      status: 'blocked',
      profile: null,
      branches: [branch(BRANCH_A)],
      reason: 'profile_unavailable',
    });
    expect(accountRead).toBe(false);
    expect(selectedBranchRef.get()).toBeNull();
  });

  it('filters a malformed membership row so it cannot authorize an explicit target', async () => {
    let accountRead = false;
    const malformedMembership = {
      ...branch(BRANCH_B),
      role: 'manager',
    } as unknown as BranchAccount;
    const source: BootstrapSource = {
      getProfile: async () => profile,
      getBranches: async () => [branch(BRANCH_A), malformedMembership],
      getAccount: async () => {
        accountRead = true;
        return account(BRANCH_B);
      },
    };

    await expect(
      loadMobileBootstrap(source, USER_ID, BRANCH_B)
    ).resolves.toEqual({
      status: 'blocked',
      profile,
      branches: [branch(BRANCH_A)],
      reason: 'branch_access_denied',
    });
    expect(accountRead).toBe(false);
    expect(selectedBranchRef.get()).toBeNull();
  });

  it.each([
    ['mismatched identity', account(BRANCH_B)],
    [
      'malformed numeric field',
      { ...account(BRANCH_A), week_start: '1' } as unknown as AccountSummary,
    ],
  ])('blocks an account response with %s', async (_case, accountResponse) => {
    const source: BootstrapSource = {
      getProfile: async () => profile,
      getBranches: async () => [branch(BRANCH_A)],
      getAccount: async () => accountResponse,
    };

    await expect(loadMobileBootstrap(source, USER_ID, null)).resolves.toEqual({
      status: 'blocked',
      profile,
      branches: [branch(BRANCH_A)],
      reason: 'selected_branch_unavailable',
    });
    expect(selectedBranchRef.get()).toBeNull();
  });

  it('keeps the published branch unchanged when the candidate account read fails', async () => {
    const source: BootstrapSource = {
      getProfile: async () => profile,
      getBranches: async () => [branch(BRANCH_A)],
      getAccount: async () => {
        expect(selectedBranchRef.get()).toBe(BRANCH_A);
        throw new Error('postgres://user:secret@internal/policy details');
      },
    };

    selectedBranchRef.set(BRANCH_A);
    await expect(loadMobileBootstrap(source, USER_ID, null)).resolves.toEqual({
      status: 'blocked',
      profile,
      branches: [branch(BRANCH_A)],
      reason: 'selected_branch_unavailable',
    });
    expect(selectedBranchRef.get()).toBe(BRANCH_A);
  });

  it('returns only safe UI copy and a sanitized diagnostic for sensitive failures', async () => {
    const diagnostic = jest.fn();
    const source: BootstrapSource = {
      getProfile: async () => {
        throw new Error(
          'postgres://admin:password@internal row-level policy violation'
        );
      },
      getBranches: async () => [branch(BRANCH_A)],
      getAccount: async () => account(BRANCH_A),
    };

    const result = await loadMobileBootstrap(source, USER_ID, null, diagnostic);

    expect(result).toEqual({
      status: 'blocked',
      profile: null,
      branches: [],
      reason: 'branch_access_unavailable',
    });
    if (result.status !== 'blocked') throw new Error('Invalid test result.');
    expect(branchBlockMessage(result.reason)).toBe(
      'Could not load your branch access. Check your connection and try again.'
    );
    expect(JSON.stringify(result)).not.toContain('password');
    expect(diagnostic).toHaveBeenCalledWith({
      stage: 'profile_and_branches',
      category: 'exception',
    });
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('password');
  });
});
