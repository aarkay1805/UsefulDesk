import { describe, expect, it } from 'vitest';
import {
  isMonthlyCatalogIdentity,
  monthlyCatalogOffer,
} from './monthly-contract';
import { SUBSCRIPTION_TIERS, type SubscriptionTier } from './plans';

describe('monthly first-purchase catalog', () => {
  it('derives the exact three monthly prices and branch allowances', () => {
    expect(
      SUBSCRIPTION_TIERS.map((t) => monthlyCatalogOffer(t).amountMinor)
    ).toEqual([79900, 149900, 399900]);
    expect(
      SUBSCRIPTION_TIERS.map((t) => monthlyCatalogOffer(t).includedBranches)
    ).toEqual([1, 1, 5]);
    for (const tier of SUBSCRIPTION_TIERS) {
      const offer = monthlyCatalogOffer(tier);
      expect(offer).toMatchObject({
        contractVersion: 'monthly_first_v1',
        catalogVersion: 'monthly_inr_2026_10_v1',
        tier,
        currency: 'INR',
        paidExtraBranchSlots: 0,
      });
      expect(isMonthlyCatalogIdentity(offer)).toBe(true);
      expect(Object.isFrozen(offer)).toBe(true);
    }
  });
  it.each([
    ['growth', { amountMinor: 79900 }],
    ['ultimate', { paidExtraBranchSlots: 1 }],
    ['starter', { catalogVersion: 'future' }],
    ['starter', { contractVersion: 'starter_v1' }],
    ['ultimate', { includedBranches: 1 }],
    ['starter', { currency: 'USD' }],
    ['growth', { amountMinor: '149900' }],
    ['starter', { tier: 'future' }],
  ] as const)('rejects mismatched %s identity %j', (tier, changed) => {
    expect(
      isMonthlyCatalogIdentity({ ...monthlyCatalogOffer(tier), ...changed })
    ).toBe(false);
  });
  it.each([null, undefined, [], {}, 'starter', 79900])(
    'rejects malformed identity %j',
    (value) => {
      expect(isMonthlyCatalogIdentity(value)).toBe(false);
    }
  );
  it('refuses an unknown tier instead of defaulting to the current catalog', () => {
    expect(() => monthlyCatalogOffer('future' as SubscriptionTier)).toThrow(
      RangeError
    );
  });
});
