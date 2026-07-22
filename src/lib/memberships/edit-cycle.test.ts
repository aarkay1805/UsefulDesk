import { describe, expect, it } from 'vitest';

import type { PlanPricingOption } from '@/types';
import { editedMembershipEndDate } from './edit-cycle';

const monthlyOption: PlanPricingOption = {
  id: 'monthly',
  account_id: 'account',
  plan_id: 'fitness',
  duration_count: 1,
  duration_unit: 'month',
  price: 799,
  setup_fee: 0,
  is_active: true,
  sort_order: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const existing = {
  plan_id: 'fitness',
  pricing_option_id: 'monthly',
  start_date: '2026-06-15',
  // Deliberately differs from the current monthly option: imported/custom
  // current cycles are snapshots and must survive a routine profile edit.
  end_date: '2026-09-14',
};

describe('editedMembershipEndDate', () => {
  it('preserves an unchanged current-cycle snapshot', () => {
    expect(
      editedMembershipEndDate({
        member: existing,
        planId: 'fitness',
        optionId: 'monthly',
        startDate: '2026-06-15',
        selectedOption: monthlyOption,
      })
    ).toBe('2026-09-14');
  });

  it('preserves the current cycle length when correcting only its start', () => {
    expect(
      editedMembershipEndDate({
        member: existing,
        planId: 'fitness',
        optionId: 'monthly',
        startDate: '2026-06-20',
        selectedOption: monthlyOption,
      })
    ).toBe('2026-09-19');
  });

  it('uses the selected option after a real offering change', () => {
    expect(
      editedMembershipEndDate({
        member: existing,
        planId: 'competition',
        optionId: 'monthly',
        startDate: '2026-06-15',
        selectedOption: { ...monthlyOption, plan_id: 'competition' },
      })
    ).toBe('2026-07-15');
  });
});
