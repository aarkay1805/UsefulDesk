import { describe, expect, it } from 'vitest';
import {
  branchExpansionForCount,
  branchChangeFitsVerifiedSlots,
  countActiveBranches,
  isSubscriptionTier,
  projectActiveBranchCount,
  subscriptionCapabilityAllowed,
  tierIncludesCapability,
  trialBranchChangeAllowed,
  TRIAL_ACTIVE_BRANCH_LIMIT,
} from './plans';

describe('subscription packaging', () => {
  it('keeps the approved branch allowances and software subtotals', () => {
    expect(branchExpansionForCount('starter', 1)).toMatchObject({
      kind: 'included',
      monthlySoftwareInr: 799,
    });
    expect(branchExpansionForCount('starter', 2).kind).toBe('upgrade_required');
    expect(branchExpansionForCount('growth', 1).monthlySoftwareInr).toBe(1499);
    expect(branchExpansionForCount('growth', 2)).toMatchObject({
      kind: 'paid_extra',
      additionalBranches: 1,
      monthlySoftwareInr: 1998,
    });
    expect(branchExpansionForCount('growth', 3).kind).toBe('upgrade_required');
    expect(branchExpansionForCount('ultimate', 5).monthlySoftwareInr).toBe(
      3999
    );
    expect(branchExpansionForCount('ultimate', 6)).toMatchObject({
      kind: 'paid_extra',
      additionalBranches: 1,
      monthlySoftwareInr: 4498,
    });
    expect(() => branchExpansionForCount('growth', 0)).toThrow(RangeError);
  });

  it('counts only active branches for creates and restores', () => {
    const branches = [
      {
        account_id: 'active-1',
        organization_id: 'org-1',
        branch_status: 'active' as const,
      },
      {
        account_id: 'archived-1',
        organization_id: 'org-1',
        branch_status: 'archived' as const,
      },
      {
        account_id: 'read-only-1',
        organization_id: 'org-1',
        branch_status: 'read_only' as const,
      },
      {
        account_id: 'other-active',
        organization_id: 'org-2',
        branch_status: 'active' as const,
      },
    ];
    expect(countActiveBranches(branches, 'org-1')).toBe(1);
    const afterCreate = projectActiveBranchCount(branches, 'org-1', {
      kind: 'create',
    });
    const afterRestore = projectActiveBranchCount(branches, 'org-1', {
      kind: 'restore',
      accountId: 'archived-1',
    });
    expect(afterCreate).toBe(2);
    expect(afterRestore).toBe(2);
    expect(
      branchExpansionForCount('growth', afterCreate).monthlySoftwareInr
    ).toBe(1998);
    expect(branchChangeFitsVerifiedSlots('growth', 0, afterCreate)).toBe(false);
    expect(branchChangeFitsVerifiedSlots('growth', 1, afterCreate)).toBe(true);
    expect(branchChangeFitsVerifiedSlots('starter', 0, afterRestore)).toBe(
      false
    );
    expect(branchChangeFitsVerifiedSlots('ultimate', 0, afterRestore)).toBe(
      true
    );
    expect(() =>
      projectActiveBranchCount(branches, 'org-1', {
        kind: 'restore',
        accountId: 'active-1',
      })
    ).toThrow('Only an archived branch');
    expect(() =>
      projectActiveBranchCount(branches, 'org-2', {
        kind: 'restore',
        accountId: 'archived-1',
      })
    ).toThrow('Only an archived branch');
  });

  it('allows a trial create or restore into its fifth active slot, then stops at five', () => {
    expect(TRIAL_ACTIVE_BRANCH_LIMIT).toBe(5);
    const fourActive = [
      ...Array.from({ length: 4 }, (_, index) => ({
        account_id: `active-${index}`,
        organization_id: 'org-1',
        branch_status: 'active' as const,
      })),
      {
        account_id: 'archived',
        organization_id: 'org-1',
        branch_status: 'archived' as const,
      },
      {
        account_id: 'other-org',
        organization_id: 'org-2',
        branch_status: 'active' as const,
      },
    ];
    const fifthActive = {
      account_id: 'active-4',
      organization_id: 'org-1',
      branch_status: 'active' as const,
    };
    expect(
      trialBranchChangeAllowed(fourActive, 'org-1', { kind: 'create' })
    ).toBe(true);
    expect(
      trialBranchChangeAllowed(fourActive, 'org-1', {
        kind: 'restore',
        accountId: 'archived',
      })
    ).toBe(true);
    const fiveActive = [...fourActive, fifthActive];
    expect(
      trialBranchChangeAllowed(fiveActive, 'org-1', { kind: 'create' })
    ).toBe(false);
    expect(
      trialBranchChangeAllowed(fiveActive, 'org-1', {
        kind: 'restore',
        accountId: 'archived',
      })
    ).toBe(false);
    expect(countActiveBranches(fiveActive, 'org-1')).toBe(5);
    const existingOverCap = [
      ...fiveActive,
      {
        account_id: 'preexisting-sixth',
        organization_id: 'org-1',
        branch_status: 'active' as const,
      },
    ];
    expect(
      trialBranchChangeAllowed(existingOverCap, 'org-1', { kind: 'create' })
    ).toBe(false);
    expect(countActiveBranches(existingOverCap, 'org-1')).toBe(6);
  });

  it('requires verified branch slots and respects Growth’s two-branch ceiling', () => {
    expect(branchChangeFitsVerifiedSlots('growth', 2, 2)).toBe(false);
    expect(branchChangeFitsVerifiedSlots('growth', 1, 3)).toBe(false);
    expect(branchChangeFitsVerifiedSlots('ultimate', 0, 6)).toBe(false);
    expect(branchChangeFitsVerifiedSlots('ultimate', 1, 6)).toBe(true);
    expect(branchChangeFitsVerifiedSlots('starter', 1, 1)).toBe(false);
  });

  it('separates approved capabilities by tier and preserves full trial/legacy access', () => {
    expect(
      tierIncludesCapability('starter', 'standard_renewal_reminders')
    ).toBe(true);
    expect(tierIncludesCapability('starter', 'gym_autopay')).toBe(false);
    expect(tierIncludesCapability('growth', 'gym_payment_links')).toBe(true);
    expect(tierIncludesCapability('ultimate', 'configurable_automations')).toBe(
      true
    );
    expect(
      subscriptionCapabilityAllowed(
        { status: 'trial', grant: null },
        'gym_autopay'
      )
    ).toBe(true);
    expect(
      subscriptionCapabilityAllowed(
        { status: 'complimentary', grant: null },
        'bulk_campaigns'
      )
    ).toBe(true);
    expect(
      subscriptionCapabilityAllowed(
        { status: 'active', grant: { kind: 'legacy_manual' } },
        'bulk_campaigns'
      )
    ).toBe(true);
    expect(
      subscriptionCapabilityAllowed(
        { status: 'active', grant: { kind: 'paid', tier: 'starter' } },
        'bulk_campaigns'
      )
    ).toBe(false);
    expect(
      subscriptionCapabilityAllowed(
        { status: 'expired', grant: { kind: 'paid', tier: 'ultimate' } },
        'gym_autopay'
      )
    ).toBe(false);
    expect(
      subscriptionCapabilityAllowed(
        { status: 'active', grant: { kind: 'paid', tier: null } },
        'standard_renewal_reminders'
      )
    ).toBe(false);
    expect(
      subscriptionCapabilityAllowed(
        { status: 'active', grant: null },
        'standard_renewal_reminders'
      )
    ).toBe(false);
    expect(isSubscriptionTier('autopilot')).toBe(false);
  });
});
