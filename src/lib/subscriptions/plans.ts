/** Approved pilot packaging. Prices are listed software amounts, not payable quotes. */
export const SUBSCRIPTION_TIERS = ['starter', 'growth', 'ultimate'] as const;
export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[number];

export const SUBSCRIPTION_CAPABILITIES = [
  'standard_renewal_reminders',
  'custom_renewal_schedules',
  'bulk_campaigns',
  'configurable_automations',
  'gym_payment_links',
  'gym_autopay',
] as const;
export type SubscriptionCapability = (typeof SUBSCRIPTION_CAPABILITIES)[number];

export interface SubscriptionPlan {
  tier: SubscriptionTier;
  label: string;
  monthlySoftwareInr: number;
  includedBranches: number;
  /** null means the paid extra-branch ceiling has not been decided. */
  maxPaidExtraBranches: number | null;
  capabilities: readonly SubscriptionCapability[];
}

const STANDARD = ['standard_renewal_reminders'] as const;
const GROWTH = [
  ...STANDARD,
  'custom_renewal_schedules',
  'bulk_campaigns',
  'configurable_automations',
  'gym_payment_links',
  'gym_autopay',
] as const;

export const SUBSCRIPTION_PLANS: Readonly<
  Record<SubscriptionTier, SubscriptionPlan>
> = {
  starter: {
    tier: 'starter',
    label: 'Starter',
    monthlySoftwareInr: 799,
    includedBranches: 1,
    maxPaidExtraBranches: 0,
    capabilities: STANDARD,
  },
  growth: {
    tier: 'growth',
    label: 'Growth',
    monthlySoftwareInr: 1499,
    includedBranches: 1,
    maxPaidExtraBranches: 1,
    capabilities: GROWTH,
  },
  ultimate: {
    tier: 'ultimate',
    label: 'Ultimate',
    monthlySoftwareInr: 3999,
    includedBranches: 5,
    maxPaidExtraBranches: null,
    capabilities: GROWTH,
  },
};

export const EXTRA_BRANCH_MONTHLY_SOFTWARE_INR = 499;
/** One organization-wide 14-day trial allows at most five active branches. */
export const TRIAL_ACTIVE_BRANCH_LIMIT =
  SUBSCRIPTION_PLANS.ultimate.includedBranches;

export function isSubscriptionTier(value: unknown): value is SubscriptionTier {
  return (
    typeof value === 'string' &&
    (SUBSCRIPTION_TIERS as readonly string[]).includes(value)
  );
}

export function tierIncludesCapability(
  tier: SubscriptionTier,
  capability: SubscriptionCapability
): boolean {
  return SUBSCRIPTION_PLANS[tier].capabilities.includes(capability);
}

export type SubscriptionGrant =
  | { kind: 'legacy_manual' }
  | { kind: 'paid'; tier: SubscriptionTier | null }
  | null;

/** Trial and grandfathered terms keep full access; a missing paid tier fails closed. No caller is gated yet. */
export function subscriptionCapabilityAllowed(
  access: {
    status:
      | 'trial'
      | 'active'
      | 'complimentary'
      | 'expired'
      | 'suspended'
      | 'pending';
    grant: SubscriptionGrant;
  },
  capability: SubscriptionCapability
): boolean {
  if (access.status === 'trial' || access.status === 'complimentary')
    return true;
  if (access.status !== 'active') return false;
  if (access.grant?.kind === 'legacy_manual') return true;
  if (access.grant?.kind !== 'paid' || access.grant.tier === null) return false;
  return tierIncludesCapability(access.grant.tier, capability);
}

export type BranchExpansion =
  | { kind: 'included'; additionalBranches: 0; monthlySoftwareInr: number }
  | {
      kind: 'paid_extra';
      additionalBranches: number;
      monthlySoftwareInr: number;
    }
  | {
      kind: 'upgrade_required';
      additionalBranches: number;
      monthlySoftwareInr: null;
    };

/** Branch allowances count only active branches. Archived and read-only branches use no slot. */
export function branchExpansionForCount(
  tier: SubscriptionTier,
  requestedActiveBranchCount: number
): BranchExpansion {
  if (
    !Number.isSafeInteger(requestedActiveBranchCount) ||
    requestedActiveBranchCount < 1
  ) {
    throw new RangeError('Active branch count must be a positive integer');
  }
  const plan = SUBSCRIPTION_PLANS[tier];
  const additionalBranches = Math.max(
    0,
    requestedActiveBranchCount - plan.includedBranches
  );
  if (additionalBranches === 0) {
    return {
      kind: 'included',
      additionalBranches: 0,
      monthlySoftwareInr: plan.monthlySoftwareInr,
    };
  }
  if (
    plan.maxPaidExtraBranches !== null &&
    additionalBranches > plan.maxPaidExtraBranches
  ) {
    return {
      kind: 'upgrade_required',
      additionalBranches,
      monthlySoftwareInr: null,
    };
  }
  return {
    kind: 'paid_extra',
    additionalBranches,
    monthlySoftwareInr:
      plan.monthlySoftwareInr +
      additionalBranches * EXTRA_BRANCH_MONTHLY_SOFTWARE_INR,
  };
}

export interface SubscriptionBranch {
  account_id: string;
  organization_id: string;
  branch_status: 'active' | 'read_only' | 'archived';
}

export function countActiveBranches(
  branches: readonly SubscriptionBranch[],
  organizationId: string
): number {
  return branches.filter(
    (branch) =>
      branch.organization_id === organizationId &&
      branch.branch_status === 'active'
  ).length;
}

/** Create adds one active branch; restore reactivates one existing archived branch. */
export function projectActiveBranchCount(
  branches: readonly SubscriptionBranch[],
  organizationId: string,
  change: { kind: 'create' } | { kind: 'restore'; accountId: string }
): number {
  if (change.kind === 'restore') {
    const target = branches.find(
      (branch) => branch.account_id === change.accountId
    );
    if (
      !target ||
      target.organization_id !== organizationId ||
      target.branch_status !== 'archived'
    ) {
      throw new RangeError('Only an archived branch can be restored');
    }
  }
  return countActiveBranches(branches, organizationId) + 1;
}

/** A trial create or restore uses one active slot; archived branches use none. */
export function trialBranchChangeAllowed(
  branches: readonly SubscriptionBranch[],
  organizationId: string,
  change: { kind: 'create' } | { kind: 'restore'; accountId: string }
): boolean {
  return (
    projectActiveBranchCount(branches, organizationId, change) <=
    TRIAL_ACTIVE_BRANCH_LIMIT
  );
}

/** A paid grant must supply verified extra slots; a listed price is never a grant. */
export function branchChangeFitsVerifiedSlots(
  tier: SubscriptionTier,
  verifiedExtraBranchSlots: number,
  projectedActiveBranchCount: number
): boolean {
  const plan = SUBSCRIPTION_PLANS[tier];
  if (
    !Number.isSafeInteger(verifiedExtraBranchSlots) ||
    verifiedExtraBranchSlots < 0 ||
    (plan.maxPaidExtraBranches !== null &&
      verifiedExtraBranchSlots > plan.maxPaidExtraBranches) ||
    !Number.isSafeInteger(projectedActiveBranchCount) ||
    projectedActiveBranchCount < 1
  ) {
    return false;
  }
  return (
    projectedActiveBranchCount <=
    plan.includedBranches + verifiedExtraBranchSlots
  );
}
