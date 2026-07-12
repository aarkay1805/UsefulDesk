/**
 * Membership date math — timezone-correct, pure, and unit-tested.
 *
 * Gym renewals hinge on "is this membership expired *today*". That
 * "today" is the calendar day in the ACCOUNT's time zone (migration
 * 055), not the server's UTC day — otherwise a membership ending
 * 2026-07-04 would read as expired hours early or late depending on
 * where the gym is. Callers pass `today` from the account zone —
 * `useLocale().fmt.today()` client-side, `todayInTz(cfg.timeZone)` in
 * server code. The `today` DEFAULTS below remain IST (`istToday()`)
 * purely as a home-market fallback for legacy call paths; new code
 * should always pass the account's today explicitly.
 *
 * All dates are 'YYYY-MM-DD' strings (matching the DATE columns on
 * `memberships`); arithmetic is done on UTC-midnight anchors so it's
 * DST- and locale-independent.
 */

import { todayInTz } from "@/lib/locale/format";
import type { DurationUnit, Membership, MembershipStatus } from "@/types";

const MS_PER_DAY = 86_400_000;

/** Today's date in Asia/Kolkata as 'YYYY-MM-DD' — the India-default
 *  fallback. Account-aware code uses `todayInTz` / `fmt.today()`. */
export function istToday(now: Date = new Date()): string {
  return todayInTz("Asia/Kolkata", now);
}

/** Parse 'YYYY-MM-DD' to a UTC-midnight epoch (ms). NaN on malformed input. */
function toUtcMs(dateStr: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Format a UTC-midnight epoch (ms) back to 'YYYY-MM-DD'. */
function fromUtcMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/** Add (or subtract, with a negative) whole days to a 'YYYY-MM-DD' date. */
export function istAddDays(dateStr: string, days: number): string {
  const base = toUtcMs(dateStr);
  if (Number.isNaN(base)) return dateStr;
  return fromUtcMs(base + days * MS_PER_DAY);
}

/**
 * Add a calendar-accurate duration to a 'YYYY-MM-DD' date (migration 062).
 * day/week are exact day counts; month/year move the calendar parts and
 * clamp the day-of-month to the target month's length, matching Postgres
 * `date + INTERVAL` (Jan 31 + 1 month = Feb 28; 2028-02-29 + 1 year =
 * 2029-02-28). Malformed input is returned unchanged, like istAddDays.
 */
export function addDuration(
  dateStr: string,
  count: number,
  unit: DurationUnit,
): string {
  if (unit === "day") return istAddDays(dateStr, count);
  if (unit === "week") return istAddDays(dateStr, count * 7);

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return dateStr;
  const year = Number(m[1]);
  const month = Number(m[2]); // 1-based
  const day = Number(m[3]);

  const monthsToAdd = unit === "month" ? count : count * 12;
  const totalMonths = year * 12 + (month - 1) + monthsToAdd;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = totalMonths - targetYear * 12; // 0-based
  // Day 0 of the NEXT month = last day of the target month (UTC-anchored).
  const daysInTarget = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, daysInTarget);

  const mo = String(targetMonth + 1).padStart(2, "0");
  const da = String(targetDay).padStart(2, "0");
  return `${targetYear}-${mo}-${da}`;
}

/** Whole days from `from` to `to` (to − from). Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const a = toUtcMs(from);
  const b = toUtcMs(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * Days until `endDate` from IST today. 0 = expires today, negative =
 * already past (that many days ago).
 */
export function daysUntil(endDate: string, today: string = istToday()): number {
  return daysBetween(today, endDate);
}

/**
 * The status a member effectively has *today*. Stored status is only
 * ever active | frozen | cancelled; an `active` membership whose
 * `end_date` is in the past reads as `expired`. Frozen and cancelled
 * pass through unchanged (a frozen membership doesn't expire).
 */
export function effectiveStatus(
  m: Pick<Membership, "status" | "end_date">,
  today: string = istToday(),
): MembershipStatus {
  if (m.status === "active" && daysBetween(today, m.end_date) < 0) {
    return "expired";
  }
  return m.status;
}

/**
 * New expiry after a renewal of `durationDays`. Extends from the later
 * of the current expiry or today, so a member who renews early doesn't
 * lose their unexpired days, while an already-expired member restarts
 * from today. A null/absent current expiry starts from today.
 */
export function computeRenewalEndDate(
  currentEnd: string | null | undefined,
  durationDays: number,
  today: string = istToday(),
): string {
  let base = today;
  if (currentEnd && daysBetween(today, currentEnd) > 0) {
    base = currentEnd;
  }
  return istAddDays(base, durationDays);
}

/**
 * Option-aware sibling of `computeRenewalEndDate` (migration 062): same
 * later-of-expiry-or-today base, but the extension is a calendar-accurate
 * pricing-option duration instead of raw days.
 */
export function computeRenewalEndDateFor(
  currentEnd: string | null | undefined,
  count: number,
  unit: DurationUnit,
  today: string = istToday(),
): string {
  let base = today;
  if (currentEnd && daysBetween(today, currentEnd) > 0) {
    base = currentEnd;
  }
  return addDuration(base, count, unit);
}

/**
 * New expiry after unfreezing. Pushes `endDate` forward by the number
 * of days the membership sat frozen (today − frozenAt), so a member
 * gets back exactly the time they lost. If `frozenAt` is missing or in
 * the future, the expiry is unchanged.
 */
export function unfreezeEndDate(
  endDate: string,
  frozenAt: string | null | undefined,
  today: string = istToday(),
): string {
  if (!frozenAt) return endDate;
  const frozenDays = daysBetween(frozenAt, today);
  if (!Number.isFinite(frozenDays) || frozenDays <= 0) return endDate;
  return istAddDays(endDate, frozenDays);
}
