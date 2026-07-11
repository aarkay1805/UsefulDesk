/**
 * Billing-period (invoice) helpers — migration 057.
 *
 * A `membership_periods` row is one billing cycle = one invoice. The
 * membership row stays the current-cycle pointer; periods accumulate the
 * history so recurring members get a real Paid/Unpaid/Upcoming trail.
 *
 * Two halves:
 *   - PURE: `periodStatus()` derives the invoice badge from balance +
 *     dates (needs the account's "today", so it's TS not SQL);
 *     `projectNextInvoice()` synthesises the single next cycle for
 *     display (an Upcoming invoice can't be "real" until it happens).
 *   - WRITES: the birth of a period is a DB trigger (covers every
 *     create path); renew/convert go through renew_membership_transaction
 *     (harden migration), and edit/unfreeze/cancel/reactivate through the
 *     058 lifecycle RPCs wrapped below — each one transaction, so the
 *     membership, its current period, and that period's payments can
 *     never diverge.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  InvoiceStatus,
  Membership,
  MembershipPeriodInvoice,
} from "@/types";
import { istAddDays, istToday } from "./expiry";

/** Derive the invoice badge for a period. Void wins; then a covered
 *  balance is Paid; a cycle that hasn't started yet is Upcoming; the
 *  rest is Unpaid (current-or-past with money owed). ISO 'YYYY-MM-DD'
 *  compares lexically == chronologically. */
export function periodStatus(
  p: Pick<MembershipPeriodInvoice, "state" | "balance" | "period_start">,
  today: string = istToday(),
): InvoiceStatus {
  if (p.state === "void") return "void";
  if (Number(p.balance) <= 0) return "paid";
  if (p.period_start > today) return "upcoming";
  return "unpaid";
}

/** Whether an operational payment may be added to a persisted period. */
export function isCollectiblePeriod(
  p: Pick<MembershipPeriodInvoice, "state" | "balance"> | null,
  membershipStatus: Membership["status"],
): boolean {
  return (
    !!p &&
    p.state === "open" &&
    membershipStatus !== "cancelled" &&
    Number(p.balance) > 0
  );
}

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  paid: "Paid",
  unpaid: "Unpaid",
  upcoming: "Upcoming",
  void: "Void",
};

/**
 * The synthetic id prefix marking a projected (not-yet-persisted)
 * upcoming invoice, so the UI offers "Renew" instead of "Record" on it.
 */
export const PROJECTED_INVOICE_PREFIX = "upcoming:";

export function isProjectedInvoice(id: string): boolean {
  return id.startsWith(PROJECTED_INVOICE_PREFIX);
}

/**
 * Build the NEXT cycle as a display-only invoice (not written). The next
 * cycle begins when the current one ends; its fee is the plan price
 * (fallback: the current fee). Returns null when there's nothing to
 * project — trials, cancelled memberships, a planless/duration-less
 * membership, OR an already-lapsed one (end_date on/before today). The
 * last guard is load-bearing: without it an EXPIRED member projects a
 * past-dated cycle that periodStatus() reads as a phantom "Unpaid"
 * invoice for a cycle that never happened. A lapsed member's next cycle
 * only becomes real on renewal.
 */
export function projectNextInvoice(
  membership: Pick<
    Membership,
    | "id"
    | "account_id"
    | "contact_id"
    | "plan_id"
    | "start_date"
    | "end_date"
    | "fee_amount"
    | "status"
    | "is_trial"
    | "plan"
  >,
  today: string = istToday(),
): MembershipPeriodInvoice | null {
  if (membership.is_trial) return null;
  if (membership.status === "cancelled") return null;
  // An early renewal moves the membership pointer to a persisted future
  // cycle. That future period is already the one upcoming invoice; do not
  // fabricate another cycle after it.
  if (membership.start_date > today) return null;
  // Only project while the current cycle is still live (ends strictly
  // after today), so the projected row is always genuinely Upcoming.
  if (membership.end_date <= today) return null;
  const duration = membership.plan?.duration_days;
  if (!duration) return null;
  const start = membership.end_date;
  const end = istAddDays(start, duration);
  const fee = Number(membership.plan?.price ?? membership.fee_amount);
  return {
    id: `${PROJECTED_INVOICE_PREFIX}${membership.id}`,
    account_id: membership.account_id,
    membership_id: membership.id,
    contact_id: membership.contact_id,
    plan_id: membership.plan_id,
    period_start: start,
    period_end: end,
    fee_amount: fee,
    state: "open",
    created_at: "",
    amount_paid: 0,
    balance: fee,
  };
}

// ---- lifecycle writes (migration 058: single-transaction RPCs) --
//
// Payments reconcile to a period ONLY by matching `period_end`, so any
// move of the cycle key must re-stamp that cycle's payments in the SAME
// transaction — and the period columns on `payments` are protected
// financial fields (agents can't re-stamp them via direct table
// updates). Both constraints live inside these DB functions; the old
// multi-write client-side sync (`syncCurrentPeriod`) is gone.

/**
 * Edit the membership's current cycle (plan/dates/fee/trial/notes) —
 * membership row, its current period, and the period's payments move
 * together atomically.
 */
export async function editMembershipCycle(
  supabase: SupabaseClient,
  membershipId: string,
  fields: {
    plan_id: string | null;
    period_start: string;
    period_end: string;
    fee_amount: number;
    is_trial: boolean;
    notes: string | null;
  },
) {
  return supabase.rpc("edit_membership_cycle", {
    p_membership_id: membershipId,
    p_plan_id: fields.plan_id,
    p_period_start: fields.period_start,
    p_period_end: fields.period_end,
    p_fee_amount: fields.fee_amount,
    p_is_trial: fields.is_trial,
    p_notes: fields.notes,
  });
}

/**
 * Resume a frozen membership: end date shifts forward by the paused
 * days (computed in TS — `unfreezeEndDate` — geography stays out of
 * SQL), the current period follows, its payments are re-stamped.
 */
export async function unfreezeMembership(
  supabase: SupabaseClient,
  membershipId: string,
  newEndDate: string,
) {
  return supabase.rpc("unfreeze_membership", {
    p_membership_id: membershipId,
    p_new_end_date: newEndDate,
  });
}

/**
 * Cancel or reactivate a membership; the current cycle's invoice flips
 * void/open in the same transaction. Settled past cycles are untouched.
 */
export async function setMembershipCancellation(
  supabase: SupabaseClient,
  membershipId: string,
  cancelled: boolean,
) {
  return supabase.rpc("set_membership_cancellation", {
    p_membership_id: membershipId,
    p_cancelled: cancelled,
  });
}
