import type { PlanPricingOption } from '@/types';
import { daysBetween, istAddDays } from './expiry';
import { optionEndDate } from './pricing';

interface ExistingCycle {
  plan_id: string | null;
  pricing_option_id?: string | null;
  start_date: string;
  end_date: string;
}

/**
 * Resolve the period end date for the corrective Edit membership flow.
 *
 * An existing cycle is an invoice snapshot, so merely opening and saving the
 * editor must never rebuild it from the plan's current billing option. When
 * the plan + option stay unchanged, preserve the exact cycle (or preserve its
 * length if staff correct the start date). A genuinely new plan/option uses
 * that option's calendar duration.
 */
export function editedMembershipEndDate({
  member,
  planId,
  optionId,
  startDate,
  selectedOption,
}: {
  member: ExistingCycle | null;
  planId: string;
  optionId: string | null;
  startDate: string;
  selectedOption: PlanPricingOption | null;
}): string | null {
  const sameOffering =
    !!member &&
    planId === member.plan_id &&
    optionId === (member.pricing_option_id ?? null);

  if (member && sameOffering) {
    if (startDate === member.start_date) return member.end_date;
    const cycleDays = daysBetween(member.start_date, member.end_date);
    if (Number.isFinite(cycleDays) && cycleDays > 0) {
      return istAddDays(startDate, cycleDays);
    }
  }

  return selectedOption ? optionEndDate(startDate, selectedOption) : null;
}
