/**
 * Trial / lead action-list bucketing — IST-first, pure, unit-tested.
 *
 * A trial is a `memberships` row with `is_trial=true` (see migration
 * 035). The owner's question is "which trials do I convert before they
 * walk?" — so a trial is bucketed by how its `end_date` sits against
 * Asia/Kolkata "today", the same day boundary every other membership
 * date uses (see ./expiry) so a trial is never a day early or late.
 *
 * A trial that has already lapsed WITHOUT converting (`converted_at`
 * null) is the win-back list — the lead you nearly lost.
 */

import { daysUntil, istToday } from "./expiry";
import type { Membership } from "@/types";

/** How many days out a trial counts as "ending this week". */
export const TRIAL_SOON_DAYS = 7;

export type TrialBucket = "ending_today" | "ending_soon" | "expired_unconverted";

/** Fixed display order + label for the three trial buckets. */
export const TRIAL_BUCKETS: { key: TrialBucket; label: string }[] = [
  { key: "ending_today", label: "Ending today" },
  { key: "ending_soon", label: "Ending this week" },
  { key: "expired_unconverted", label: "Expired — not converted" },
];

/**
 * Which action-list bucket a trial's expiry falls into, or `null` when
 * the trial still has more than TRIAL_SOON_DAYS left (not yet worth
 * surfacing). Callers pass only trials that haven't converted.
 *
 *   d < 0            → expired_unconverted  (lapsed lead → win-back)
 *   d === 0          → ending_today
 *   1..SOON_DAYS     → ending_soon
 *   d > SOON_DAYS    → null                 (still early)
 */
export function trialBucket(
  endDate: string,
  today: string = istToday(),
): TrialBucket | null {
  const d = daysUntil(endDate, today);
  if (Number.isNaN(d)) return null;
  if (d < 0) return "expired_unconverted";
  if (d === 0) return "ending_today";
  if (d <= TRIAL_SOON_DAYS) return "ending_soon";
  return null;
}

export interface PartitionedTrials {
  ending_today: Membership[];
  ending_soon: Membership[];
  expired_unconverted: Membership[];
}

/**
 * Split a list of trial memberships into the three action-list buckets.
 * Already-converted trials (`converted_at` set) and cancelled rows are
 * dropped — they're no longer actionable leads. Trials with more than a
 * week left fall through (null bucket) and appear in none of the lists.
 * Each bucket keeps ascending end_date order (soonest first) when the
 * input is pre-sorted by end_date.
 */
export function partitionTrials(
  memberships: Membership[],
  today: string = istToday(),
): PartitionedTrials {
  const out: PartitionedTrials = {
    ending_today: [],
    ending_soon: [],
    expired_unconverted: [],
  };
  for (const m of memberships) {
    if (!m.is_trial) continue;
    if (m.converted_at) continue;
    if (m.status === "cancelled") continue;
    const bucket = trialBucket(m.end_date, today);
    if (bucket) out[bucket].push(m);
  }
  return out;
}
