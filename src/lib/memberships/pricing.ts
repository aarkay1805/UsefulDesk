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

export interface MonthlyPriceInsight {
  effectiveMonthlyPrice: number;
  savingsPercent: number | null;
}

/** Customer-facing cadence copy without changing the option's semantics. */
export function pricingCadenceLabel(
  plan: Pick<MembershipPlan, "plan_type">,
  option: Pick<PlanPricingOption, "duration_count" | "duration_unit">,
): string {
  const { duration_count: count, duration_unit: unit } = option;
  const duration = durationLabel(count, unit);

  if (plan.plan_type === "session_pack") return `Valid for ${duration}`;
  if (plan.plan_type === "non_recurring") return `${count}-${unit} term`;
  if (unit === "month" && count === 1) return "Billed monthly";
  if (unit === "month" && count === 3) return "Billed quarterly";
  if ((unit === "month" && count === 12) || (unit === "year" && count === 1)) {
    return "Billed annually";
  }
  return `Billed every ${duration}`;
}

/**
 * Customer-facing monthly comparison for a multi-month pricing option.
 *
 * Only calendar-exact month/year terms qualify. Day/week options are not
 * silently approximated, and a session pack's duration is a validity window
 * rather than months of equivalent service. Savings additionally requires
 * exactly one active 1-month option on this same plan; comparing unrelated
 * plans (or choosing between ambiguous monthly rows) would overstate the
 * offer. Setup fees stay out because the displayed option price and future
 * renewal price both exclude that one-time charge.
 */
export function monthlyPriceInsight(
  plan: MembershipPlan,
  option: PlanPricingOption,
): MonthlyPriceInsight | null {
  if (plan.plan_type === "session_pack") return null;

  const months =
    option.duration_unit === "month"
      ? option.duration_count
      : option.duration_unit === "year"
        ? option.duration_count * 12
        : null;
  if (months === null || months <= 1) return null;

  const price = Number(option.price);
  const effectiveMonthlyPrice = price / months;
  const monthlyOptions = activeOptions(plan).filter(
    (candidate) =>
      candidate.duration_unit === "month" && candidate.duration_count === 1,
  );

  let savingsPercent: number | null = null;
  if (monthlyOptions.length === 1) {
    const monthlyBaseline = Number(monthlyOptions[0].price) * months;
    if (monthlyBaseline > 0) {
      const roundedSavings = Math.round(
        ((monthlyBaseline - price) / monthlyBaseline) * 100,
      );
      if (roundedSavings > 0) savingsPercent = roundedSavings;
    }
  }

  return { effectiveMonthlyPrice, savingsPercent };
}

/**
 * Whether a membership participates in the renewal chase (cron
 * reminders, Renewals action lists, auto-pay eligibility). Only
 * RECURRING plans renew; fixed-term plans expire quietly and session
 * packs surface via session counts. A NULL plan = a legacy row that
 * keeps its reminders (pre-062 behavior) — that `!plan ||` branch is
 * load-bearing, which is why this is a named predicate and not an
 * inline comparison at each surface (same rule as roles.ts).
 */
export function isRenewalChaseable(
  plan: { plan_type: MembershipPlan["plan_type"] | string | null } | null | undefined,
): boolean {
  return !plan || plan.plan_type === "recurring";
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
