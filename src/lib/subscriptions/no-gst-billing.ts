import { branchExpansionForCount, type SubscriptionTier } from './plans';
import type { UpgradeIntent } from './billing-transitions';

export interface NoGstSaasDraft {
  merchantTaxMode: 'unregistered_no_gst';
  listedSoftwareMinor: number;
  gstMinor: 0;
  draftTotalMinor: number;
}

/** Pure review amount only. Eligibility and commercial readiness must be checked before a real quote or charge. */
function noGstDraft(listedSoftwareMinor: number): NoGstSaasDraft {
  if (!Number.isSafeInteger(listedSoftwareMinor) || listedSoftwareMinor < 0) {
    throw new RangeError('Listed software amount must be valid INR paise');
  }
  return {
    merchantTaxMode: 'unregistered_no_gst',
    listedSoftwareMinor,
    gstMinor: 0,
    draftTotalMinor: listedSoftwareMinor,
  };
}

/** One month's listed base tier and eligible branch add-ons, with no GST added. */
export function draftNoGstMonthlySaasAmount(
  tier: SubscriptionTier,
  requestedActiveBranchCount: number
): NoGstSaasDraft {
  const expansion = branchExpansionForCount(tier, requestedActiveBranchCount);
  if (expansion.monthlySoftwareInr === null) {
    throw new RangeError('The tier cannot cover that active branch count');
  }
  return noGstDraft(expansion.monthlySoftwareInr * 100);
}

/** The already-prorated base-tier difference; add-on changes need separate terms. */
export function draftNoGstBaseUpgradeAmount(
  intent: UpgradeIntent
): NoGstSaasDraft {
  return noGstDraft(intent.chargeMinor);
}
