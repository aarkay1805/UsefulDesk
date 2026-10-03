import {
  isSubscriptionTier,
  SUBSCRIPTION_PLANS,
  type SubscriptionTier,
} from './plans';

export interface MonthlyCatalogIdentity {
  contractVersion: 'monthly_first_v1';
  catalogVersion: 'monthly_inr_2026_10_v1';
  tier: SubscriptionTier;
  amountMinor: number;
  currency: 'INR';
  includedBranches: number;
  paidExtraBranchSlots: 0;
}

/** Listed economics only. A catalog identity is never opening or payment authority. */
export function monthlyCatalogOffer(
  tier: SubscriptionTier
): Readonly<MonthlyCatalogIdentity> {
  if (!isSubscriptionTier(tier))
    throw new RangeError('Unknown monthly catalog tier');
  const plan = SUBSCRIPTION_PLANS[tier];
  return Object.freeze({
    contractVersion: 'monthly_first_v1',
    catalogVersion: 'monthly_inr_2026_10_v1',
    tier,
    amountMinor: plan.monthlySoftwareInr * 100,
    currency: 'INR',
    includedBranches: plan.includedBranches,
    paidExtraBranchSlots: 0,
  });
}

/** Accept only the exact versioned catalog; never infer a version for legacy data. */
export function isMonthlyCatalogIdentity(
  value: unknown
): value is MonthlyCatalogIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!isSubscriptionTier(candidate.tier)) return false;
  const expected = monthlyCatalogOffer(candidate.tier);
  return (Object.keys(expected) as (keyof MonthlyCatalogIdentity)[]).every(
    (key) => candidate[key] === expected[key]
  );
}
