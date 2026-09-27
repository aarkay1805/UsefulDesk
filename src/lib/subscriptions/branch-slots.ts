import {
  branchChangeFitsVerifiedSlots,
  projectActiveBranchCount,
  SUBSCRIPTION_PLANS,
  trialBranchChangeAllowed,
  type SubscriptionBranch,
  type SubscriptionGrant,
  type SubscriptionTier,
} from './plans';
import type { AccessStatus } from '@/lib/platform-access/model';

export type BranchSlotTier = Exclude<SubscriptionTier, 'starter'>;
export type BranchSlotPurchaseState = 'pending' | 'failed' | 'verified';

/** A purchase order is separate from active branches; archiving never edits it. */
export interface BranchSlotPurchase {
  purchaseId: string;
  organizationId: string;
  tier: BranchSlotTier;
  quantity: number;
  state: BranchSlotPurchaseState;
  verifiedProviderPaymentId: string | null;
}

export type BranchSlotPurchaseEvent =
  | { kind: 'payment_failed'; purchaseId: string }
  | {
      /** Only a trusted server verifier may produce this fact after provider checks. */
      kind: 'server_verified_payment';
      purchaseId: string;
      providerPaymentId: string;
    };

/** Pure state transition. It does not contact or authenticate a payment provider. */
export function applyBranchSlotPurchaseEvent(
  purchase: BranchSlotPurchase,
  event: BranchSlotPurchaseEvent
): BranchSlotPurchase {
  if (event.purchaseId !== purchase.purchaseId) {
    throw new Error('Purchase confirmation does not match this order');
  }
  if (event.kind === 'payment_failed') {
    // A delayed failed attempt must not undo a previously verified payment.
    return purchase.state === 'verified'
      ? purchase
      : { ...purchase, state: 'failed' };
  }
  const paymentId = event.providerPaymentId.trim();
  if (!paymentId) throw new Error('Verified payment ID is required');
  if (purchase.state === 'verified') {
    if (purchase.verifiedProviderPaymentId === paymentId) return purchase;
    throw new Error('Purchase was already verified with another payment');
  }
  return {
    ...purchase,
    state: 'verified',
    verifiedProviderPaymentId: paymentId,
  };
}

/** Pending/failed rows grant zero slots. Invalid or duplicate verified rows fail closed. */
export function verifiedExtraBranchSlots(
  organizationId: string,
  tier: SubscriptionTier,
  purchases: readonly BranchSlotPurchase[]
): number {
  if (tier === 'starter') return 0;
  let total = 0;
  const purchaseIds = new Set<string>();
  const paymentIds = new Set<string>();
  for (const purchase of purchases) {
    if (purchase.organizationId !== organizationId || purchase.tier !== tier)
      continue;
    if (purchase.state !== 'verified') continue;
    const paymentId = purchase.verifiedProviderPaymentId?.trim();
    if (
      !purchase.purchaseId.trim() ||
      !paymentId ||
      !Number.isSafeInteger(purchase.quantity) ||
      purchase.quantity < 1 ||
      purchaseIds.has(purchase.purchaseId) ||
      paymentIds.has(paymentId)
    ) {
      throw new Error('Invalid verified branch purchase');
    }
    purchaseIds.add(purchase.purchaseId);
    paymentIds.add(paymentId);
    total += purchase.quantity;
    if (
      !Number.isSafeInteger(total) ||
      (SUBSCRIPTION_PLANS[tier].maxPaidExtraBranches !== null &&
        total > SUBSCRIPTION_PLANS[tier].maxPaidExtraBranches!)
    ) {
      throw new Error('Verified branch purchases exceed the tier allowance');
    }
  }
  return total;
}

/** Paid-plan preflight only. The database must repeat this under an organization lock. */
export function paidBranchChangeAllowed(
  organizationId: string,
  tier: SubscriptionTier,
  branches: readonly SubscriptionBranch[],
  purchases: readonly BranchSlotPurchase[],
  change: { kind: 'create' } | { kind: 'restore'; accountId: string }
): boolean {
  const activeAfter = projectActiveBranchCount(
    branches,
    organizationId,
    change
  );
  const verifiedSlots = verifiedExtraBranchSlots(
    organizationId,
    tier,
    purchases
  );
  return branchChangeFitsVerifiedSlots(tier, verifiedSlots, activeAfter);
}

/** Pure access decision for future server/database enforcement; no runtime caller yet. */
export function subscriptionBranchChangeAllowed(
  organizationId: string,
  access: { status: AccessStatus; grant: SubscriptionGrant },
  branches: readonly SubscriptionBranch[],
  purchases: readonly BranchSlotPurchase[],
  change: { kind: 'create' } | { kind: 'restore'; accountId: string }
): boolean {
  if (access.status === 'trial') {
    return trialBranchChangeAllowed(branches, organizationId, change);
  }
  // Existing complimentary and manual organizations retain their current access.
  if (
    access.status === 'complimentary' ||
    (access.status === 'active' && access.grant?.kind === 'legacy_manual')
  ) {
    projectActiveBranchCount(branches, organizationId, change);
    return true;
  }
  if (
    access.status === 'active' &&
    access.grant?.kind === 'paid' &&
    access.grant.tier !== null
  ) {
    return paidBranchChangeAllowed(
      organizationId,
      access.grant.tier,
      branches,
      purchases,
      change
    );
  }
  return false;
}
