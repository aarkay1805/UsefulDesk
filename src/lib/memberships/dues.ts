/**
 * Payment-due aging — IST-first, pure, unit-tested.
 *
 * A member owes money when their membership row carries an unpaid
 * balance (fee_amount − collected-this-period > 0; see the
 * `membership_dues` view, migration 034). The owner's question is
 * "who do I chase first?" — so an outstanding balance is aged against
 * the date the fee became owed: the current period's `start_date`
 * (the fee is due from the day the period begins). Aging uses the
 * same Asia/Kolkata "today" as every other membership date so a fee
 * is never a day early or late for a UTC+5:30 owner.
 */

import { daysBetween, istToday } from "./expiry";

export type DueBucket =
  | "due_soon"
  | "overdue_1_7"
  | "overdue_8_30"
  | "overdue_30_plus";

/**
 * Whole days a fee is overdue: today − `dueSince`. 0 = due today,
 * negative = not owed yet (a future period start), positive = late.
 */
export function daysOverdue(dueSince: string, today: string = istToday()): number {
  return daysBetween(dueSince, today);
}

/**
 * Which aged bucket an outstanding fee falls into. `due_soon` covers
 * due-today and not-yet-owed; the rest split lateness at 7 and 30 days
 * so the owner sees fresh dues apart from the hard-to-collect tail.
 */
export function bucketForDue(dueSince: string, today: string = istToday()): DueBucket {
  const d = daysOverdue(dueSince, today);
  if (d <= 0) return "due_soon";
  if (d <= 7) return "overdue_1_7";
  if (d <= 30) return "overdue_8_30";
  return "overdue_30_plus";
}

/** Fixed display order + label for the four due buckets. */
export const DUE_BUCKETS: { key: DueBucket; label: string }[] = [
  { key: "due_soon", label: "Due now" },
  { key: "overdue_1_7", label: "Overdue 1–7 days" },
  { key: "overdue_8_30", label: "Overdue 8–30 days" },
  { key: "overdue_30_plus", label: "Overdue 30+ days" },
];
