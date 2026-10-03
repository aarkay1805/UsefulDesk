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
