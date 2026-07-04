/**
 * Membership date math — IST-first, pure, and unit-tested.
 *
 * Gym renewals hinge on "is this membership expired *today*". For an
 * Indian gym that "today" is the Asia/Kolkata (UTC+5:30) calendar day,
 * not the server's UTC day — otherwise a membership ending 2026-07-04
 * would read as expired from 18:30 UTC the day before, or still-valid
 * for the first 5.5h of the next IST day. Every comparison below keys
 * off `istToday()` so members never expire a day early or late.
 *
 * All dates are 'YYYY-MM-DD' strings (matching the DATE columns on
 * `memberships`); arithmetic is done on UTC-midnight anchors so it's
 * DST- and locale-independent.
 */

import type { Membership, MembershipStatus } from "@/types";

const MS_PER_DAY = 86_400_000;

/** Today's date in Asia/Kolkata as 'YYYY-MM-DD'. */
export function istToday(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD; the timeZone shifts the calendar day
  // into IST before formatting.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
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
