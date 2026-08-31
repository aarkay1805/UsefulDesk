import * as SecureStore from 'expo-secure-store';

import { selectedBranchRef } from '../../data/supabase';
import { branchPreference } from './branch-preference';
import type {
  AccountSummary,
  BranchAccount,
  MobileProfile,
} from './branch-types';
import {
  loadMobileBootstrap,
  type BootstrapSource,
} from './bootstrap-repository';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

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

const secureStore = jest.mocked(SecureStore);

describe('branchPreference', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the dedicated selected-branch SecureStore key', async () => {
    secureStore.getItemAsync.mockResolvedValue(BRANCH_A);

    await expect(branchPreference.get()).resolves.toBe(BRANCH_A);
    await branchPreference.set(BRANCH_B);
    await branchPreference.clear();

    expect(secureStore.getItemAsync).toHaveBeenCalledWith(
      'usefuldesk.mobile.selected-branch'
    );
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      'usefuldesk.mobile.selected-branch',
      BRANCH_B
    );
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(
      'usefuldesk.mobile.selected-branch'
    );
  });
});

describe('loadMobileBootstrap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    selectedBranchRef.set(null);
  });

  it('loads profile and memberships together, then scopes and persists the exact account read', async () => {
    const profileRead = deferred<MobileProfile | null>();
    const branchRead = deferred<BranchAccount[]>();
    let profileStarted = false;
    let branchesStarted = false;
    const accountReads: string[] = [];
    const source: BootstrapSource = {
      getProfile: async (userId) => {
        expect(userId).toBe(USER_ID);
        expect(selectedBranchRef.get()).toBeNull();
        profileStarted = true;
        return profileRead.promise;
      },
      getBranches: async () => {
        expect(selectedBranchRef.get()).toBeNull();
        branchesStarted = true;
        return branchRead.promise;
      },
      getAccount: async (accountId) => {
        accountReads.push(accountId);
        expect(selectedBranchRef.get()).toBe(BRANCH_B);
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
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      'usefuldesk.mobile.selected-branch',
      BRANCH_B
    );
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
      reason: 'You do not have access to this branch.',
    });

    expect(accountRead).toBe(false);
    expect(selectedBranchRef.get()).toBeNull();
    expect(secureStore.setItemAsync).not.toHaveBeenCalled();
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(
      'usefuldesk.mobile.selected-branch'
    );
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
    expect(secureStore.setItemAsync).not.toHaveBeenCalled();
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
      reason: 'Invalid profile data.',
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
      reason: 'You do not have access to this branch.',
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
      reason: 'Selected branch account response is invalid.',
    });
    expect(selectedBranchRef.get()).toBeNull();
    expect(secureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('surfaces a saved-branch clear failure instead of returning choose', async () => {
    const branches = [branch(BRANCH_A), branch(BRANCH_B)];
    const source: BootstrapSource = {
      getProfile: async () => ({ ...profile, account_id: null }),
      getBranches: async () => branches,
      getAccount: async () => account(BRANCH_A),
    };
    secureStore.deleteItemAsync.mockRejectedValueOnce(
      new Error('secure storage locked')
    );

    await expect(loadMobileBootstrap(source, USER_ID, null)).resolves.toEqual({
      status: 'blocked',
      profile: { ...profile, account_id: null },
      branches,
      reason: 'Saved branch state could not be cleared: secure storage locked',
    });
    expect(selectedBranchRef.get()).toBeNull();
    expect(secureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('resets branch scope and preference when the exact account read fails', async () => {
    const source: BootstrapSource = {
      getProfile: async () => profile,
      getBranches: async () => [branch(BRANCH_A)],
      getAccount: async () => {
        expect(selectedBranchRef.get()).toBe(BRANCH_A);
        throw new Error('account unavailable');
      },
    };

    await expect(loadMobileBootstrap(source, USER_ID, null)).resolves.toEqual({
      status: 'blocked',
      profile,
      branches: [branch(BRANCH_A)],
      reason: 'account unavailable',
    });
    expect(selectedBranchRef.get()).toBeNull();
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(
      'usefuldesk.mobile.selected-branch'
    );
  });
});
