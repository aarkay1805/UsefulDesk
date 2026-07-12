/**
 * Mid-cycle plan change ("swap / upgrade") credit math — pure and tested.
 *
 * When a member switches plans before their current cycle ends, the money
 * they already paid buys back the UNUSED days as a credit against the new
 * plan's first invoice:
 *
 *   usedValue = old fee × usedDays / totalDays   (what the used days cost)
 *   credit    = max(0, amountPaid − usedValue)   (surplus carried forward)
 *   netFee    = max(0, newPlanPrice − credit)    (the new cycle's invoice)
 *
 * The truncated old cycle is re-invoiced at `oldCycleFee = usedValue`, so
 * its ledger stays honest: a fully-paid cycle reads as over-paid by exactly
 * the credit that moved forward, and an unpaid one keeps arrears only for
 * the days actually used. All day math is 'YYYY-MM-DD' string based (same
 * convention as expiry.ts) — callers pass the account-tz switch date.
 *
 * The transactional write lives in the `change_membership_plan` RPC
 * (migration 061); this module only quotes the numbers for it.
 */

import { daysBetween } from "./expiry";

export interface PlanChangeQuote {
  /** Length of the current cycle in days. */
  totalDays: number;
  /** Days consumed up to (not including) the switch date, clamped to the cycle. */
  usedDays: number;
  /** Days of the current cycle the member gives up by switching. */
  remainingDays: number;
  /** Money value of the used days (old fee, pro-rata). */
  usedValue: number;
  /** Surplus from what was paid, carried to the new plan's invoice. */
  credit: number;
  /** What the truncated old cycle should be re-invoiced at (= usedValue). */
  oldCycleFee: number;
  /** New plan price minus the credit, floored at zero. */
  netFee: number;
  /** Credit beyond the new plan's price (netFee already floored at 0). */
  carryover: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

/**
 * Quote a mid-cycle plan change. Degenerate inputs (zero-length cycle,
 * malformed dates) quote as fully used — zero credit, full new price —
 * which is always the safe direction (never invents money).
 */
export function planChangeQuote(args: {
  /** Current cycle bounds ('YYYY-MM-DD'). */
  periodStart: string;
  periodEnd: string;
  /** Current cycle's invoiced fee. */
  feeAmount: number;
  /** Sum already collected against the current cycle. */
  amountPaid: number;
  /** First day on the new plan; the old cycle ends here. */
  switchDate: string;
  newPlanPrice: number;
}): PlanChangeQuote {
  const fee = Math.max(Number(args.feeAmount) || 0, 0);
  const paid = Math.max(Number(args.amountPaid) || 0, 0);
  const price = Math.max(Number(args.newPlanPrice) || 0, 0);

  const totalDays = daysBetween(args.periodStart, args.periodEnd);
  const rawUsed = daysBetween(args.periodStart, args.switchDate);

  if (!Number.isFinite(totalDays) || totalDays <= 0 || !Number.isFinite(rawUsed)) {
    return {
      totalDays: 0,
      usedDays: 0,
      remainingDays: 0,
      usedValue: fee,
      credit: 0,
      oldCycleFee: fee,
      netFee: round2(price),
      carryover: 0,
    };
  }

  const usedDays = clamp(rawUsed, 0, totalDays);
  const usedValue = round2((fee * usedDays) / totalDays);
  const credit = clamp(round2(paid - usedValue), 0, paid);
  return {
    totalDays,
    usedDays,
    remainingDays: totalDays - usedDays,
    usedValue,
    credit,
    oldCycleFee: usedValue,
    netFee: Math.max(round2(price - credit), 0),
    carryover: Math.max(round2(credit - price), 0),
  };
}
