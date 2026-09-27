import { describe, expect, it } from 'vitest';
import { reviewSubscriptionConversion } from './conversion';
import type { BranchSlotPurchase } from './branch-slots';

const branches = [
  ...Array.from({ length: 5 }, (_, index) => ({
    account_id: `active-${index + 1}`,
    organization_id: 'org-1',
    branch_status: 'active' as const,
  })),
  {
    account_id: 'archived-1',
    organization_id: 'org-1',
    branch_status: 'archived' as const,
  },
  {
    account_id: 'other-org',
    organization_id: 'org-2',
    branch_status: 'active' as const,
  },
];
const pending: BranchSlotPurchase = {
  purchaseId: 'purchase-1',
  organizationId: 'org-1',
  tier: 'growth',
  quantity: 1,
  state: 'pending',
  verifiedProviderPaymentId: null,
};
const verified: BranchSlotPurchase = {
  ...pending,
  state: 'verified',
  verifiedProviderPaymentId: 'pay-1',
};
function review(
  tier: 'starter' | 'growth' | 'ultimate',
  archiveAccountIds: string[],
  purchases: BranchSlotPurchase[] = []
) {
  return reviewSubscriptionConversion({
    organizationId: 'org-1',
    tier,
    branches,
    purchases,
    archiveAccountIds,
  });
}

describe('subscription conversion preflight', () => {
  it('requires the owner to explicitly select four active branches for Starter', () => {
    const before = structuredClone(branches);
    expect(review('starter', [])).toMatchObject({
      ready: false,
      blocker: 'too_many_active_branches',
      minimumBranchesToArchive: 4,
      availableSlots: 1,
    });
    expect(
      review('starter', ['active-1', 'active-2', 'active-3'])
    ).toMatchObject({ ready: false, remainingActiveBranches: 2 });
    expect(
      review('starter', ['active-1', 'active-2', 'active-3', 'active-4'])
    ).toMatchObject({ ready: true, remainingActiveBranches: 1 });
    expect(
      branches.filter(
        (branch) =>
          branch.branch_status === 'active' &&
          branch.organization_id === 'org-1'
      )
    ).toHaveLength(5);
    expect(branches).toEqual(before);
  });

  it('accepts a plan with enough capacity and never treats pending payment as a slot', () => {
    expect(review('ultimate', [])).toMatchObject({
      ready: true,
      availableSlots: 5,
      selectedForArchive: 0,
    });
    expect(
      review('growth', ['active-1', 'active-2', 'active-3'], [pending])
    ).toMatchObject({ ready: false, availableSlots: 1 });
    expect(
      review('growth', ['active-1', 'active-2', 'active-3'], [verified])
    ).toMatchObject({ ready: true, availableSlots: 2 });
  });

  it('rejects archived, cross-organization, duplicate, and all-branch selections', () => {
    for (const ids of [
      ['archived-1'],
      ['other-org'],
      ['active-1', 'active-1'],
    ]) {
      expect(review('starter', ids)).toMatchObject({
        ready: false,
        blocker: 'invalid_branch_selection',
      });
    }
    expect(
      review('ultimate', [
        'active-1',
        'active-2',
        'active-3',
        'active-4',
        'active-5',
      ])
    ).toMatchObject({ ready: false, blocker: 'no_active_branch' });
  });

  it('fails closed on malformed verified purchase evidence', () => {
    expect(
      review(
        'growth',
        ['active-1', 'active-2', 'active-3'],
        [{ ...verified, verifiedProviderPaymentId: null }]
      )
    ).toMatchObject({ ready: false, blocker: 'invalid_purchase_evidence' });
  });
});
