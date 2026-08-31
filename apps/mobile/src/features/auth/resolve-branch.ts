import type { BranchAccount, BranchResolution } from './branch-types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ResolveBranchInput {
  branches: BranchAccount[];
  profileBranchId: string | null;
  requestedBranchId: string | null;
}

function isBranchAccountId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function resolveSelectedBranch({
  branches,
  profileBranchId,
  requestedBranchId,
}: ResolveBranchInput): BranchResolution {
  const available = branches.filter(
    (branch) => branch.branch_status !== 'archived'
  );

  if (requestedBranchId !== null) {
    if (!isBranchAccountId(requestedBranchId)) {
      return { status: 'blocked', reason: 'Invalid branch.', branches };
    }

    const requested = branches.find(
      (branch) => branch.account_id === requestedBranchId
    );
    if (!requested) {
      return {
        status: 'blocked',
        reason: 'You do not have access to this branch.',
        branches,
      };
    }
    if (requested.branch_status === 'archived') {
      return {
        status: 'blocked',
        reason: 'This branch is archived.',
        branches,
      };
    }
    return { status: 'ready', branch: requested };
  }

  const profileBranch = available.find(
    (branch) => branch.account_id === profileBranchId
  );
  if (profileBranch) return { status: 'ready', branch: profileBranch };
  if (available.length === 1) {
    return { status: 'ready', branch: available[0] };
  }
  if (available.length > 1) {
    return { status: 'choose', branches: available };
  }
  return {
    status: 'blocked',
    reason: 'No active branch access.',
    branches,
  };
}
