import type { BranchAccount } from './branch-types';
import { resolveSelectedBranch } from './resolve-branch';

const BRANCH_A = 'd3648c54-a4aa-4dd8-8566-1e3b38c1f497';
const BRANCH_B = 'f8b2a93d-bfa4-485a-8ab1-1b37862d6d72';
const BRANCH_C = 'd5031b79-402d-4bb2-848f-43b3acfe64e1';

function branch(
  accountId: string,
  branchStatus: BranchAccount['branch_status'] = 'active'
): BranchAccount {
  return {
    account_id: accountId,
    account_name: `Branch ${accountId}`,
    organization_id: '405ea376-0d27-4898-b198-0edb2a87ff38',
    organization_name: 'Useful Fitness',
    legal_entity_id: '895fd4ad-7219-4982-b8e4-a0c84f83e8d4',
    legal_entity_name: 'Useful Fitness Private Limited',
    role: 'admin',
    branch_status: branchStatus,
    readiness_state: 'ready',
    default_currency: 'INR',
    timezone: 'Asia/Kolkata',
    is_organization_owner: false,
    setup_reviewed_at: '2026-08-30T10:00:00.000Z',
    setup_reviewed_by: '53f7dd9e-e2fd-4824-a773-a0ce541048ec',
  };
}

describe('resolveSelectedBranch', () => {
  it('uses a valid requested active branch', () => {
    const requested = branch(BRANCH_B);

    expect(
      resolveSelectedBranch({
        branches: [branch(BRANCH_A), requested],
        profileBranchId: BRANCH_A,
        requestedBranchId: BRANCH_B,
      })
    ).toEqual({ status: 'ready', branch: requested });
  });

  it('blocks a malformed requested branch instead of falling back', () => {
    const branches = [branch(BRANCH_A)];

    expect(
      resolveSelectedBranch({
        branches,
        profileBranchId: BRANCH_A,
        requestedBranchId: 'not-a-uuid',
      })
    ).toEqual({ status: 'blocked', reason: 'invalid_branch', branches });
  });

  it('blocks a requested branch outside the memberships', () => {
    const branches = [branch(BRANCH_A)];

    expect(
      resolveSelectedBranch({
        branches,
        profileBranchId: BRANCH_A,
        requestedBranchId: BRANCH_B,
      })
    ).toEqual({
      status: 'blocked',
      reason: 'branch_access_denied',
      branches,
    });
  });

  it('blocks an archived requested branch', () => {
    const branches = [branch(BRANCH_A), branch(BRANCH_B, 'archived')];

    expect(
      resolveSelectedBranch({
        branches,
        profileBranchId: BRANCH_A,
        requestedBranchId: BRANCH_B,
      })
    ).toEqual({
      status: 'blocked',
      reason: 'branch_archived',
      branches,
    });
  });

  it('uses the non-archived profile branch when no branch was requested', () => {
    const profileBranch = branch(BRANCH_A);

    expect(
      resolveSelectedBranch({
        branches: [profileBranch],
        profileBranchId: BRANCH_A,
        requestedBranchId: null,
      })
    ).toEqual({ status: 'ready', branch: profileBranch });
  });

  it('asks for a choice when multiple non-archived branches lack a usable default', () => {
    const branches = [
      branch(BRANCH_A),
      branch(BRANCH_B),
      branch(BRANCH_C, 'read_only'),
    ];

    expect(
      resolveSelectedBranch({
        branches,
        profileBranchId: null,
        requestedBranchId: null,
      })
    ).toEqual({ status: 'choose', branches });
  });

  it('blocks when no non-archived branch is available', () => {
    const branches = [branch(BRANCH_A, 'archived')];

    expect(
      resolveSelectedBranch({
        branches,
        profileBranchId: BRANCH_A,
        requestedBranchId: null,
      })
    ).toEqual({
      status: 'blocked',
      reason: 'no_active_branch',
      branches,
    });
  });
});
