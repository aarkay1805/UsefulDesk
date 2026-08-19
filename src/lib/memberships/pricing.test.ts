import { describe, it, expect } from 'vitest';

import {
  activeOptions,
  defaultOption,
  durationLabel,
  firstCycleFee,
  isRenewalChaseable,
  monthlyPriceInsight,
  optionEndDate,
  pricingCadenceLabel,
  renewalFee,
} from './pricing';
import type { MembershipPlan, PlanPricingOption } from '@/types';

function opt(over: Partial<PlanPricingOption>): PlanPricingOption {
  return {
    id: 'o1',
    account_id: 'a1',
    plan_id: 'p1',
    duration_count: 1,
    duration_unit: 'month',
    price: 1000,
    setup_fee: 0,
    is_active: true,
    sort_order: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '',
    ...over,
  };
}

function plan(options: PlanPricingOption[]): MembershipPlan {
  return {
    id: 'p1',
    account_id: 'a1',
    name: 'Gold',
    price: 1000,
    duration_days: 30,
    plan_type: 'recurring',
    is_active: true,
    created_at: '',
    updated_at: '',
    pricing_options: options,
  };
}

describe('activeOptions / defaultOption', () => {
  it('filters archived options and sorts by sort_order then created_at', () => {
    const p = plan([
      opt({ id: 'late', sort_order: 1 }),
      opt({ id: 'archived', sort_order: 0, is_active: false }),
      opt({ id: 'tie-b', sort_order: 0, created_at: '2026-02-01T00:00:00Z' }),
      opt({ id: 'tie-a', sort_order: 0, created_at: '2026-01-01T00:00:00Z' }),
    ]);
    expect(activeOptions(p).map((o) => o.id)).toEqual([
      'tie-a',
      'tie-b',
      'late',
    ]);
    expect(defaultOption(p)?.id).toBe('tie-a');
  });

  it('handles a plan with no options', () => {
    expect(activeOptions(plan([]))).toEqual([]);
    expect(defaultOption(plan([]))).toBeNull();
    expect(
      defaultOption({ ...plan([]), pricing_options: undefined })
    ).toBeNull();
  });
});

describe('optionEndDate', () => {
  it("is calendar-accurate per the option's unit", () => {
    expect(
      optionEndDate(
        '2026-01-31',
        opt({ duration_count: 1, duration_unit: 'month' })
      )
    ).toBe('2026-02-28');
    expect(
      optionEndDate(
        '2026-07-11',
        opt({ duration_count: 90, duration_unit: 'day' })
      )
    ).toBe('2026-10-09');
  });
});

describe('fees', () => {
  it('first cycle includes the setup fee; renewals never do', () => {
    const o = opt({ price: 1000, setup_fee: 500 });
    expect(firstCycleFee(o)).toBe(1500);
    expect(renewalFee(o)).toBe(1000);
  });

  it('treats a missing/zero setup fee as zero', () => {
    expect(firstCycleFee(opt({ price: 1000, setup_fee: 0 }))).toBe(1000);
  });
});

describe('durationLabel', () => {
  it('pluralizes correctly', () => {
    expect(durationLabel(1, 'month')).toBe('1 month');
    expect(durationLabel(3, 'month')).toBe('3 months');
    expect(durationLabel(90, 'day')).toBe('90 days');
    expect(durationLabel(1, 'year')).toBe('1 year');
  });
});

describe('monthlyPriceInsight', () => {
  it('shows the effective monthly price and same-plan monthly savings', () => {
    const monthly = opt({ id: 'monthly', price: 2500 });
    const annual = opt({
      id: 'annual',
      duration_count: 1,
      duration_unit: 'year',
      price: 24000,
      sort_order: 1,
    });

    expect(monthlyPriceInsight(plan([monthly, annual]), annual)).toEqual({
      effectiveMonthlyPrice: 2000,
      savingsPercent: 20,
    });
  });

  it('keeps the effective price but omits unreliable savings', () => {
    const annual = opt({
      id: 'annual',
      duration_count: 12,
      duration_unit: 'month',
      price: 24000,
    });
    const archivedMonthly = opt({
      id: 'monthly',
      price: 2500,
      is_active: false,
    });

    expect(
      monthlyPriceInsight(plan([archivedMonthly, annual]), annual)
    ).toEqual({
      effectiveMonthlyPrice: 2000,
      savingsPercent: null,
    });

    const duplicateMonthly = opt({
      id: 'monthly-2',
      price: 2200,
      sort_order: 2,
    });
    expect(
      monthlyPriceInsight(
        plan([
          { ...archivedMonthly, is_active: true },
          duplicateMonthly,
          annual,
        ]),
        annual
      )?.savingsPercent
    ).toBeNull();
  });

  it('does not call equal or higher multi-cycle pricing a saving', () => {
    const monthly = opt({ id: 'monthly', price: 2000 });
    const samePrice = opt({
      id: 'annual',
      duration_count: 1,
      duration_unit: 'year',
      price: 24000,
      sort_order: 1,
    });
    const higherPrice = { ...samePrice, id: 'higher', price: 25000 };

    expect(
      monthlyPriceInsight(plan([monthly, samePrice]), samePrice)?.savingsPercent
    ).toBeNull();
    expect(
      monthlyPriceInsight(plan([monthly, higherPrice]), higherPrice)
        ?.savingsPercent
    ).toBeNull();
  });

  it('excludes non-equivalent durations and session-pack validity windows', () => {
    const weekly = opt({
      duration_count: 12,
      duration_unit: 'week',
      price: 6000,
    });
    expect(monthlyPriceInsight(plan([weekly]), weekly)).toBeNull();

    const annual = opt({
      duration_count: 1,
      duration_unit: 'year',
      price: 12000,
    });
    expect(
      monthlyPriceInsight(
        { ...plan([annual]), plan_type: 'session_pack' },
        annual
      )
    ).toBeNull();
  });
});

describe('pricingCadenceLabel', () => {
  it('uses natural recurring billing cadence labels', () => {
    const recurring = plan([]);
    expect(pricingCadenceLabel(recurring, opt({}))).toBe('Billed monthly');
    expect(
      pricingCadenceLabel(
        recurring,
        opt({ duration_count: 3, duration_unit: 'month' })
      )
    ).toBe('Billed quarterly');
    expect(
      pricingCadenceLabel(
        recurring,
        opt({ duration_count: 1, duration_unit: 'year' })
      )
    ).toBe('Billed annually');
    expect(
      pricingCadenceLabel(
        recurring,
        opt({ duration_count: 6, duration_unit: 'month' })
      )
    ).toBe('Billed every 6 months');
  });

  it('does not describe fixed terms or session validity as recurring billing', () => {
    expect(
      pricingCadenceLabel(
        { plan_type: 'non_recurring' },
        opt({ duration_count: 3, duration_unit: 'month' })
      )
    ).toBe('3-month term');
    expect(
      pricingCadenceLabel(
        { plan_type: 'session_pack' },
        opt({ duration_count: 8, duration_unit: 'week' })
      )
    ).toBe('Valid for 8 weeks');
  });
});

describe('isRenewalChaseable', () => {
  it('chases recurring plans and legacy NULL-plan rows only', () => {
    expect(isRenewalChaseable({ plan_type: 'recurring' })).toBe(true);
    // Load-bearing: pre-062 rows without a plan keep their reminders.
    expect(isRenewalChaseable(null)).toBe(true);
    expect(isRenewalChaseable(undefined)).toBe(true);
    expect(isRenewalChaseable({ plan_type: 'non_recurring' })).toBe(false);
    expect(isRenewalChaseable({ plan_type: 'session_pack' })).toBe(false);
  });
});
