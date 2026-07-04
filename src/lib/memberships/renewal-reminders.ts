/**
 * Auto renewal-reminder logic — pure, IST-first, unit-tested.
 *
 * The scheduled job (`/api/renewals/cron`) turns the manual "Remind"
 * button into a self-driving loop. Its date math lives here, split out
 * from the route so it can be tested without a database or Meta:
 *
 *   settings.days_before  ──┐
 *   IST today            ───┼──► targetEndDates() ──► [{ daysBefore, endDate }]
 *                           │
 *   for each target endDate, the route queries active memberships whose
 *   end_date == endDate, then dedupes each against renewal_reminders_sent
 *   on (membership_id, end_date, days_before).
 *
 * Keeping the offset → exact-date mapping here means the DB query is a
 * cheap equality on the indexed `end_date` column, and the tricky part
 * (IST day boundaries, offset sanitising) is covered by tests.
 */

import { istAddDays, istToday } from "./expiry";
import type { MembershipStatus } from "@/types";

/**
 * The Utility template a gym creates + submits in Settings → Templates.
 * Lives here (server-safe) rather than in the client button so both the
 * manual send and the cron can import it without pulling client code.
 */
export const RENEWAL_TEMPLATE_NAME = "gym_renewal_reminder";

/** Hard ceiling on configured offsets — guards the settings UI + cron
 *  against a pathological array blowing up the per-run query count. */
export const MAX_REMINDER_OFFSETS = 6;
/** Furthest out a reminder may be scheduled (a year). */
export const MAX_DAYS_BEFORE = 365;

/** The offsets a fresh account gets until it customises them. */
export const DEFAULT_DAYS_BEFORE = [7, 3, 1];

/**
 * Sanitise a raw `days_before` array (from settings input or a DB row)
 * into a clean, ordered, de-duplicated list of whole-day offsets in
 * [0, MAX_DAYS_BEFORE], capped at MAX_REMINDER_OFFSETS. 0 = "expires
 * today"; negatives (already expired) are dropped — grace-period
 * chasing is a separate feature, not a reminder.
 */
export function normalizeDaysBefore(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const cleaned = input
    .map((n) => (typeof n === "number" ? Math.trunc(n) : Number.NaN))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= MAX_DAYS_BEFORE);
  // Sorted ascending (soonest reminders first) + unique.
  const unique = Array.from(new Set(cleaned)).sort((a, b) => a - b);
  return unique.slice(0, MAX_REMINDER_OFFSETS);
}

/**
 * Membership statuses a reminder may target. Only `active` — frozen
 * memberships are paused (their clock isn't running) and cancelled ones
 * are gone. `expired` is never stored (derived), and a future end_date
 * wouldn't be expired anyway.
 */
export function isRemindableStatus(status: MembershipStatus): boolean {
  return status === "active";
}

export interface ReminderTarget {
  /** The offset that produced this date, carried through for dedupe + logging. */
  daysBefore: number;
  /** 'YYYY-MM-DD' — the exact end_date to match memberships against. */
  endDate: string;
}

/**
 * Map configured offsets to the exact expiry dates that should fire
 * today. For today=2026-07-04 and daysBefore=[7,3,1] you get end_dates
 * 2026-07-11, 2026-07-07, 2026-07-05 — i.e. "remind members expiring
 * 7 / 3 / 1 days from now". Input is normalised first, so callers can
 * pass a raw DB array.
 */
export function targetEndDates(
  daysBefore: unknown,
  today: string = istToday(),
): ReminderTarget[] {
  return normalizeDaysBefore(daysBefore).map((d) => ({
    daysBefore: d,
    endDate: istAddDays(today, d),
  }));
}
