import type { SupabaseClient } from "@supabase/supabase-js";
import { istToday, istAddDays } from "./expiry";

/**
 * Owner-view gym KPIs for the dashboard. Every figure is an *action
 * list* count/total ("who to chase today"), not a vanity metric — the
 * PRD's "action lists over dashboards" principle. Membership status is
 * evaluated against IST "today" (see ./expiry) so a UTC+5:30 owner sees
 * the same day boundaries their members do.
 */
/** A member counts as inactive after this many days with no check-in. */
export const INACTIVE_DAYS = 10;

export interface GymStats {
  /** status='active' and not past expiry. */
  activeMembers: number;
  /** active memberships expiring within the next 7 days (inclusive). */
  expiring7: number;
  /** active memberships already past expiry (derived, not stored). */
  expired: number;
  /** memberships with an unpaid fee (excluding cancelled). */
  feesDueCount: number;
  /** total unpaid fee amount across those memberships. */
  feesDueAmount: number;
  /** sum of payments recorded since the start of the current IST month. */
  collectedThisMonth: number;
  /** active members with no check-in in the last INACTIVE_DAYS days. */
  inactive: number;
}

export async function loadGymStats(db: SupabaseClient): Promise<GymStats> {
  const today = istToday();
  const in7 = istAddDays(today, 7);
  // Start of the current IST month as a tz-aware instant.
  const monthStartInstant = `${today.slice(0, 7)}-01T00:00:00+05:30`;
  // Cutoff for the inactive signal (start of the day INACTIVE_DAYS ago).
  const recentStartInstant = `${istAddDays(today, -INACTIVE_DAYS)}T00:00:00+05:30`;

  const head = { count: "exact" as const, head: true };

  const [
    activeRes,
    expiringRes,
    expiredRes,
    dueRes,
    paidRes,
    attRes,
  ] = await Promise.all([
    // Active members: fetch ids (not just a count) so we can diff them
    // against recent check-ins for the inactive figure.
    db
      .from("memberships")
      .select("contact_id")
      .eq("is_trial", false)
      .eq("status", "active")
      .gte("end_date", today),
    db
      .from("memberships")
      .select("id", head)
      .eq("is_trial", false)
      .eq("status", "active")
      .gte("end_date", today)
      .lte("end_date", in7),
    db
      .from("memberships")
      .select("id", head)
      .eq("is_trial", false)
      .eq("status", "active")
      .lt("end_date", today),
    // Fee amounts for due memberships — one query yields both the count
    // and the total (summed client-side; the set is small).
    db
      .from("memberships")
      .select("fee_amount")
      .eq("fee_status", "due")
      .neq("status", "cancelled"),
    db.from("payments").select("amount").gte("paid_at", monthStartInstant),
    db
      .from("attendance")
      .select("contact_id")
      .gte("checked_in_at", recentStartInstant),
  ]);

  const activeRows = (activeRes.data as { contact_id: string }[] | null) ?? [];
  const dueRows = (dueRes.data as { fee_amount: number }[] | null) ?? [];
  const paidRows = (paidRes.data as { amount: number }[] | null) ?? [];
  const attRows = (attRes.data as { contact_id: string }[] | null) ?? [];

  const recentlySeen = new Set(attRows.map((r) => r.contact_id));
  const inactive = activeRows.filter((r) => !recentlySeen.has(r.contact_id)).length;

  return {
    activeMembers: activeRows.length,
    expiring7: expiringRes.count ?? 0,
    expired: expiredRes.count ?? 0,
    feesDueCount: dueRows.length,
    feesDueAmount: dueRows.reduce((s, r) => s + Number(r.fee_amount || 0), 0),
    collectedThisMonth: paidRows.reduce((s, r) => s + Number(r.amount || 0), 0),
    inactive,
  };
}
