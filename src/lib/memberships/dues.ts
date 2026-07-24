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

import { daysBetween, istToday } from './expiry';

export type DueBucket = 'due_today' | 'overdue';

/**
 * Whole days a fee is overdue: today − `dueSince`. 0 = due today,
 * negative = not owed yet (a future period start), positive = late.
 */
export function daysOverdue(
  dueSince: string,
  today: string = istToday()
): number {
  return daysBetween(dueSince, today);
}

/**
 * Which urgency bucket an outstanding fee falls into. Future-dated
 * balances stay in the unfiltered queue but are not urgency filters.
 */
export function bucketForDue(
  dueSince: string,
  today: string = istToday()
): DueBucket | null {
  const d = daysOverdue(dueSince, today);
  if (d === 0) return 'due_today';
  if (d > 0) return 'overdue';
  return null;
}

/** Fixed display order + label for the two actionable urgency filters. */
export const DUE_BUCKETS: { key: DueBucket; label: string }[] = [
  { key: 'due_today', label: 'Due today' },
  { key: 'overdue', label: 'Overdue' },
];
