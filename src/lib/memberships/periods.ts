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
 *     create path), but renew/edit/unfreeze/convert/cancel are done
 *     explicitly here — a trigger can't tell a renewal (new cycle) from
 *     an edit or an unfreeze (same cycle, shifted dates).
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

// ---- lifecycle writes -----------------------------------------

/** The membership's current cycle = the latest period by start. */
async function latestPeriodId(
  supabase: SupabaseClient,
  membershipId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("membership_periods")
    .select("id")
    .eq("membership_id", membershipId)
    .order("period_start", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Open a NEW period for a renewed cycle. The prior period stays as-is,
 * so an unpaid past cycle becomes a real arrears row. Unique
 * (membership_id, period_end) is safe — renewal always extends the end.
 */
export async function insertRenewalPeriod(
  supabase: SupabaseClient,
  membership: Pick<Membership, "id" | "account_id" | "contact_id">,
  cycle: { plan_id: string | null; start: string; end: string; fee: number },
) {
  return supabase.from("membership_periods").insert({
    account_id: membership.account_id,
    membership_id: membership.id,
    contact_id: membership.contact_id,
    plan_id: cycle.plan_id,
    period_start: cycle.start,
    period_end: cycle.end,
    fee_amount: cycle.fee,
    state: "open",
  });
}

/**
 * Keep the current period's mirror in step with the membership after an
 * edit / unfreeze / trial-convert (same cycle, changed dates/fee/plan).
 * No-op if the membership somehow has no period yet.
 *
 * CRITICAL: payments reconcile to a period ONLY by matching `period_end`
 * (the view + dues both key on it). So when this shifts the cycle's
 * `period_end` (unfreeze pushes it forward; an edit can move it), the
 * already-recorded payments MUST be re-stamped to the new key — else they
 * orphan and a fully-paid cycle reads back as Unpaid.
 */
export async function syncCurrentPeriod(
  supabase: SupabaseClient,
  membershipId: string,
  fields: {
    plan_id: string | null;
    period_start: string;
    period_end: string;
    fee_amount: number;
  },
) {
  const { data } = await supabase
    .from("membership_periods")
    .select("id, period_end")
    .eq("membership_id", membershipId)
    .order("period_start", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const cur = data as { id: string; period_end: string } | null;
  if (!cur) return;

  // Re-stamp this cycle's payments before moving the period key, so they
  // keep reconciling to it.
  if (fields.period_end !== cur.period_end) {
    await supabase
      .from("payments")
      .update({
        period_start: fields.period_start,
        period_end: fields.period_end,
      })
      .eq("membership_id", membershipId)
      .eq("period_end", cur.period_end);
  }

  return supabase
    .from("membership_periods")
    .update(fields)
    .eq("id", cur.id)
    .select("id");
}

/**
 * Void (cancel) or re-open the current cycle's invoice. Past paid cycles
 * are left untouched — cancelling doesn't rewrite settled history.
 */
export async function setCurrentPeriodState(
  supabase: SupabaseClient,
  membershipId: string,
  state: "open" | "void",
) {
  const id = await latestPeriodId(supabase, membershipId);
  if (!id) return;
  return supabase
    .from("membership_periods")
    .update({ state })
    .eq("id", id)
    .select("id");
}
