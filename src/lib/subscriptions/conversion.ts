import {
  verifiedExtraBranchSlots,
  type BranchSlotPurchase,
} from './branch-slots';
import {
  countActiveBranches,
  SUBSCRIPTION_PLANS,
  type SubscriptionBranch,
  type SubscriptionTier,
} from './plans';

export type ConversionBlocker =
  | 'invalid_branch_selection'
  | 'invalid_purchase_evidence'
  | 'no_active_branch'
  | 'too_many_active_branches';

export interface ConversionPreflight {
  ready: boolean;
  blocker: ConversionBlocker | null;
  activeBranches: number;
  selectedForArchive: number;
  remainingActiveBranches: number;
  availableSlots: number;
  minimumBranchesToArchive: number;
}

/**
 * Read-only conversion preview. It never archives data or activates a plan.
 * A future server transaction must re-read the roster and verified grants under
 * the organization's lock before applying the owner's exact archive selection.
 */
export function reviewSubscriptionConversion({
  organizationId,
  tier,
  branches,
  purchases,
  archiveAccountIds,
}: {
  organizationId: string;
  tier: SubscriptionTier;
  branches: readonly SubscriptionBranch[];
  purchases: readonly BranchSlotPurchase[];
  archiveAccountIds: readonly string[];
}): ConversionPreflight {
  const active = branches.filter(
    (branch) =>
      branch.organization_id === organizationId &&
      branch.branch_status === 'active'
  );
  const activeIds = new Set(active.map((branch) => branch.account_id));
  const selection = new Set(archiveAccountIds);
  const invalidSelection =
    activeIds.size !== active.length ||
    selection.size !== archiveAccountIds.length ||
    [...selection].some((id) => !activeIds.has(id));
  const activeBranches = countActiveBranches(branches, organizationId);
  const selectedForArchive = selection.size;
  const remainingActiveBranches = activeBranches - selectedForArchive;
  let verifiedSlots = 0;
  let invalidPurchaseEvidence = false;
  try {
    verifiedSlots = verifiedExtraBranchSlots(organizationId, tier, purchases);
  } catch {
    invalidPurchaseEvidence = true;
  }
  const availableSlots =
    SUBSCRIPTION_PLANS[tier].includedBranches + verifiedSlots;
  const minimumBranchesToArchive = Math.max(0, activeBranches - availableSlots);
  const blocker: ConversionBlocker | null = invalidSelection
    ? 'invalid_branch_selection'
    : invalidPurchaseEvidence
      ? 'invalid_purchase_evidence'
      : remainingActiveBranches < 1
        ? 'no_active_branch'
        : remainingActiveBranches > availableSlots
          ? 'too_many_active_branches'
          : null;
  return {
    ready: blocker === null,
    blocker,
    activeBranches,
    selectedForArchive,
    remainingActiveBranches,
    availableSlots,
    minimumBranchesToArchive,
  };
}
