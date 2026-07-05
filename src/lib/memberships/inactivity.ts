/**
 * Retention signals (migration 037's member_activity view).
 *
 * Splits active members into the two lists the owner acts on:
 *   - inactive:     visited before, but not in INACTIVE_DAYS+ days
 *   - neverVisited: joined but never checked in (onboarding risk)
 *
 * Day math converts the last check-in instant to its IST calendar day
 * first (see ./expiry) — an 11:30pm visit yesterday is "1 day ago" for
 * a UTC+5:30 owner, not a fraction of a day.
 */
import { istToday, daysBetween } from "./expiry";
import { INACTIVE_DAYS } from "./stats";
import type { MemberActivity } from "@/types";

export interface InactivityBuckets {
  /** Stalest first (longest since last visit). */
  inactive: MemberActivity[];
  /** Longest-waiting first (earliest start date). */
  neverVisited: MemberActivity[];
}

/** IST calendar day of a check-in instant, 'YYYY-MM-DD'. */
export function istDayOf(instant: string): string {
  return istToday(new Date(instant));
}

/** Whole IST days since the member's last visit; null if never visited. */
export function daysSinceVisit(
  row: MemberActivity,
  today: string = istToday(),
): number | null {
  if (!row.last_visit_at) return null;
  return daysBetween(istDayOf(row.last_visit_at), today);
}

/**
 * Partition members into the retention buckets. Rows are expected to
 * be pre-filtered to active, non-trial, unexpired memberships (the
 * query's job); anyone with a visit inside the window is dropped.
 */
export function partitionInactivity(
  rows: MemberActivity[],
  today: string = istToday(),
  inactiveDays: number = INACTIVE_DAYS,
): InactivityBuckets {
  const inactive: MemberActivity[] = [];
  const neverVisited: MemberActivity[] = [];

  for (const row of rows) {
    const days = daysSinceVisit(row, today);
    if (days === null) neverVisited.push(row);
    else if (days >= inactiveDays) inactive.push(row);
  }

  inactive.sort((a, b) =>
    (a.last_visit_at ?? "").localeCompare(b.last_visit_at ?? ""),
  );
  neverVisited.sort((a, b) => a.start_date.localeCompare(b.start_date));

  return { inactive, neverVisited };
}
