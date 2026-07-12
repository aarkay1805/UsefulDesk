/**
 * Pricing-option helpers (migration 062) — the single place TS turns a
 * plan's billing options into dates, fees and labels.
 *
 * Conventions (established in 062, mirrored by the RPC layer):
 *   - setup_fee is billed on the FIRST cycle only, folded into that
 *     cycle's fee_amount (`firstCycleFee`); renewals and plan changes
 *     bill `price` alone (`renewalFee`).
 *   - Durations are calendar-accurate (`addDuration` in expiry.ts).
 *   - `defaultOption` (first active by sort) is the documented rule for
 *     flows that can't ask — CSV import, single-option auto-select.
 */

import { addDuration } from "@/lib/memberships/expiry";
import type { DurationUnit, MembershipPlan, PlanPricingOption } from "@/types";

/** A plan's active options, ordered as the settings UI arranged them. */
export function activeOptions(plan: MembershipPlan): PlanPricingOption[] {
  return (plan.pricing_options ?? [])
    .filter((o) => o.is_active)
    .sort(
      (a, b) =>
        a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at),
    );
}

/** The option flows without a picker fall back to: first active by sort. */
export function defaultOption(plan: MembershipPlan): PlanPricingOption | null {
  return activeOptions(plan)[0] ?? null;
}

/** Expiry for a cycle starting `startDate` on this option. */
export function optionEndDate(
  startDate: string,
  option: Pick<PlanPricingOption, "duration_count" | "duration_unit">,
): string {
  return addDuration(startDate, option.duration_count, option.duration_unit);
}

/** First cycle's fee: price + one-time joining fee. */
export function firstCycleFee(
  option: Pick<PlanPricingOption, "price" | "setup_fee">,
): number {
  return Number(option.price) + Number(option.setup_fee || 0);
}

/** Every later cycle's fee: price alone — never the setup fee again. */
export function renewalFee(option: Pick<PlanPricingOption, "price">): number {
  return Number(option.price);
}

const UNIT_LABEL: Record<DurationUnit, string> = {
  day: "day",
  week: "week",
  month: "month",
  year: "year",
};

/** "1 month", "90 days", "2 weeks" — money is the caller's job (fmt.money). */
export function durationLabel(count: number, unit: DurationUnit): string {
  const noun = UNIT_LABEL[unit];
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
