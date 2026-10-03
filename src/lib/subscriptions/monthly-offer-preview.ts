import type { MonthlyCatalogIdentity } from './monthly-contract';
import type { SubscriptionTier } from './plans';

export type MonthlyOfferChoice =
  | {
      available: true;
      offerId: string;
      identity: MonthlyCatalogIdentity;
      taxNote: string;
      termsNote: string;
      refundNote: string;
      documentTreatment: 'usefulmade_unregistered_invoice_receipt_v1';
    }
  | { available: false; tier: SubscriptionTier; reason: string };

/** Customer facts only. Private operator evidence never crosses this boundary. */
export type MonthlyOfferSetPreview = {
  offerSetId: string | null;
  organizationId: string;
  billingAccountId: string;
  contractVersion: 'monthly_first_v1';
  catalogVersion: 'monthly_inr_2026_10_v1';
  sourceSnapshot: string;
  activeBranches: { accountId: string; name: string }[];
  selectedOfferId: string | null;
  choices: MonthlyOfferChoice[];
  capabilitiesEnabled: boolean;
  openingEnabled: boolean;
};

import { isMonthlyCatalogIdentity } from './monthly-contract';
import { isSubscriptionTier } from './plans';

export function monthlyIdentityFromRow(
  value: unknown
): MonthlyCatalogIdentity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const identity = {
    contractVersion: row.offer_contract_version,
    catalogVersion: row.catalog_version,
    tier: row.tier,
    amountMinor: row.amount_minor,
    currency: row.currency,
    includedBranches: row.included_branches,
    paidExtraBranchSlots: row.paid_extra_branch_slots,
  };
  return isMonthlyCatalogIdentity(identity) &&
    typeof row.monthly_offer_id === 'string'
    ? identity
    : null;
}

export function isMonthlyOfferSetPreview(
  value: unknown,
  organizationId: string,
  accountId: string
): value is MonthlyOfferSetPreview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Partial<MonthlyOfferSetPreview>;
  return (
    row.organizationId === organizationId &&
    row.billingAccountId === accountId &&
    row.contractVersion === 'monthly_first_v1' &&
    row.catalogVersion === 'monthly_inr_2026_10_v1' &&
    (row.offerSetId === null || typeof row.offerSetId === 'string') &&
    typeof row.sourceSnapshot === 'string' &&
    (row.selectedOfferId === null || typeof row.selectedOfferId === 'string') &&
    typeof row.capabilitiesEnabled === 'boolean' &&
    typeof row.openingEnabled === 'boolean' &&
    Array.isArray(row.activeBranches) &&
    row.activeBranches.length > 0 &&
    row.activeBranches.every(
      (b) => typeof b.accountId === 'string' && typeof b.name === 'string'
    ) &&
    new Set(row.activeBranches.map((b) => b.accountId)).size ===
      row.activeBranches.length &&
    row.activeBranches.some((b) => b.accountId === accountId) &&
    Array.isArray(row.choices) &&
    row.choices.length <= 3 &&
    new Set(row.choices.map((c) => (c.available ? c.identity?.tier : c.tier)))
      .size === row.choices.length &&
    row.choices.every((c) =>
      c.available === true
        ? typeof c.offerId === 'string' &&
          isMonthlyCatalogIdentity(c.identity) &&
          typeof c.taxNote === 'string' &&
          typeof c.termsNote === 'string' &&
          typeof c.refundNote === 'string' &&
          c.documentTreatment === 'usefulmade_unregistered_invoice_receipt_v1'
        : c.available === false &&
          isSubscriptionTier(c.tier) &&
          typeof c.reason === 'string'
    ) &&
    (row.selectedOfferId === null ||
      row.choices.every((c) => !c.available) ||
      row.choices.some((c) => c.available && c.offerId === row.selectedOfferId))
  );
}
