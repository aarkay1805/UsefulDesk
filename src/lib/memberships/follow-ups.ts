/**
 * Follow-up task helpers (migration 036).
 *
 * Pure date/label logic for the staff accountability loop — buckets a
 * pending list into overdue / due today / upcoming against IST "today"
 * (see ./expiry), and derives a sensible default reason from the
 * member's membership state so the assign dialog opens pre-filled.
 */
import { istToday, daysUntil } from "./expiry";
import type {
  FollowUp,
  FollowUpOutcome,
  FollowUpReason,
  Membership,
} from "@/types";

export const REASON_LABEL: Record<FollowUpReason, string> = {
  renewal: "Renewal",
  payment: "Payment",
  trial: "Trial",
  inactive: "Inactive",
  other: "Other",
};

export const OUTCOME_LABEL: Record<FollowUpOutcome, string> = {
  renewed: "Renewed",
  paid: "Paid",
  promised: "Promised to pay",
  contacted: "Contacted",
  trial_booked: "Trial booked",
  no_answer: "No answer",
  not_interested: "Not interested",
  other: "Other",
};

export interface FollowUpBuckets {
  overdue: FollowUp[];
  dueToday: FollowUp[];
  upcoming: FollowUp[];
}

/** Split open tasks by due date vs IST today. Preserves input order. */
export function bucketFollowUps(
  rows: FollowUp[],
  today: string = istToday(),
): FollowUpBuckets {
  const buckets: FollowUpBuckets = { overdue: [], dueToday: [], upcoming: [] };
  for (const f of rows) {
    if (f.due_date < today) buckets.overdue.push(f);
    else if (f.due_date === today) buckets.dueToday.push(f);
    else buckets.upcoming.push(f);
  }
  return buckets;
}

/**
 * Best-guess reason for a new follow-up on this member, in the same
 * priority order the action lists use: an unconverted trial is a trial
 * chase; an expired/expiring membership is a renewal chase; an unpaid
 * fee is a payment chase; anything else is "other".
 */
export function defaultReason(
  m: Membership,
  today: string = istToday(),
): FollowUpReason {
  if (m.is_trial) return "trial";
  const days = daysUntil(m.end_date, today);
  if (days <= 7) return "renewal";
  if (m.fee_status === "due") return "payment";
  return "other";
}
