import { describe, expect, it } from 'vitest';

import type { CheckoutSelection, PlanPricingOption } from '@/types';

import {
  createMembershipCheckoutDraft,
  quoteMembershipCheckout,
} from './checkout';

const option: PlanPricingOption = {
  id: 'option',
  account_id: 'account',
  plan_id: 'plan',
  duration_count: 1,
  duration_unit: 'month',
  price: 1_000,
  setup_fee: 200,
  is_active: true,
  sort_order: 0,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
};

function quote(
  overrides: Partial<Parameters<typeof quoteMembershipCheckout>[0]> = {}
) {
  return quoteMembershipCheckout({
    mode: 'join',
    option,
    startDate: '2026-08-16',
    discountKind: null,
    discountValue: '',
    bonusMonthsEnabled: false,
    bonusMonths: '',
    selections: [],
    availableCredit: 0,
    ...overrides,
  });
}

describe('createMembershipCheckoutDraft', () => {
  it('starts optional offers and catalogue selection disabled while collection is enabled', () => {
    expect(
      createMembershipCheckoutDraft({
        planId: 'plan',
        optionId: 'option',
        startDate: '2026-08-16',
      })
    ).toEqual({
      planId: 'plan',
      optionId: 'option',
      startDate: '2026-08-16',
      discountKind: null,
      discountValue: '',
      bonusMonthsEnabled: false,
      bonusMonths: '',
      includeProductsServices: false,
      selections: [],
      collectNow: true,
      collectionTiming: 'full',
      paymentMethod: 'cash',
    });
  });
});

describe('quoteMembershipCheckout', () => {
  it('uses first-cycle pricing for join and convert, but renewal pricing for renewal', () => {
    expect(quote({ mode: 'join' }).listPrice).toBe(1_200);
    expect(quote({ mode: 'convert' }).listPrice).toBe(1_200);
    expect(quote({ mode: 'membership_renewal' }).listPrice).toBe(1_000);
  });

  it('keeps offers on membership while installments use combined post-credit cash due', () => {
    const selections: CheckoutSelection[] = [
      {
        item_id: 'item',
        option_id: 'catalogue-option',
        quantity: 2,
        unit_amount: 250,
      },
    ];

    const offered = quote({
      mode: 'membership_renewal',
      discountKind: 'percentage',
      discountValue: '10',
      bonusMonthsEnabled: true,
      bonusMonths: '1',
      selections,
      availableCredit: 200,
    });

    expect(offered).toMatchObject({
      listPrice: 1_000,
      discountAmount: 100,
      membershipFee: 900,
      standardEndDate: '2026-09-16',
      periodEnd: '2026-10-16',
      bonusMonths: 1,
      addOnTotal: 500,
      invoiceTotal: 1_400,
      creditApplied: 200,
      cashDue: 1_200,
      installmentNow: 720,
      installmentLater: 480,
    });
    expect(offered.installmentNow + offered.installmentLater).toBe(1_200);
  });

  it('caps applied credit at the invoice total', () => {
    expect(quote({ availableCredit: 2_000 })).toMatchObject({
      invoiceTotal: 1_200,
      creditApplied: 1_200,
      cashDue: 0,
      installmentNow: 0,
      installmentLater: 0,
    });
  });

  it.each([
    ['invalid date', { startDate: '16/08/2026' }, 'Enter a valid start date'],
    [
      'invalid discount',
      { discountKind: 'percentage' as const, discountValue: '101' },
      'Percentage discount cannot exceed 100%',
    ],
    [
      'invalid bonus months',
      { bonusMonthsEnabled: true, bonusMonths: '1.5' },
      'Bonus months must be a whole number',
    ],
    [
      'negative catalogue amount',
      {
        selections: [
          { item_id: 'item', option_id: 'catalogue-option', unit_amount: -1 },
        ],
      },
      'Catalogue amounts must be valid non-negative numbers',
    ],
    [
      'non-finite catalogue amount',
      {
        selections: [
          {
            item_id: 'item',
            option_id: 'catalogue-option',
            unit_amount: Number.POSITIVE_INFINITY,
          },
        ],
      },
      'Catalogue amounts must be valid non-negative numbers',
    ],
  ])('rejects %s', (_case, overrides, message) => {
    expect(() => quote(overrides)).toThrow(message);
  });

  it('rejects a cash balance too small to produce two positive installments', () => {
    expect(() =>
      quote({
        mode: 'membership_renewal',
        discountKind: 'amount',
        discountValue: '999.99',
      })
    ).toThrow('Cash due cannot be split into two positive installments');
  });
});
