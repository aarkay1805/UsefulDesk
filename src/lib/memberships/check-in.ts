/**
 * Check-in limit orchestration shared by BOTH check-in surfaces (the
 * check-in page and the member sheet) — the query + warning recipe that
 * used to be copy-pasted between them. Pure math stays in
 * attendance-limits.ts; this module owns the Supabase reads.
 *
 * Policy: counting failures NEVER block the front desk — callers get
 * null and check the member in silently.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { dayStartInTz } from "@/lib/locale/format";
import {
  checkInWarning,
  membershipUsageWindowStart,
  type CheckInWarning,
} from "@/lib/memberships/attendance-limits";
import type { Membership } from "@/types";

interface LocaleWindow {
  timeZone: string;
  weekStart: number;
}

/** A membership's usage-window start as a UTC instant (ISO), or null
 *  when the plan tracks nothing. Epoch fallback mirrors the previous
 *  inline behavior for an unresolvable date. */
export function usageWindowInstant(
  m: Pick<Membership, "start_date" | "plan">,
  today: string,
  locale: LocaleWindow,
): string | null {
  const windowStart = membershipUsageWindowStart(m, today, locale.weekStart);
  if (!windowStart) return null;
  return (dayStartInTz(windowStart, locale.timeZone) ?? new Date(0)).toISOString();
}

/**
 * Fresh-count one membership's window usage and derive the
 * warn-with-override. Null = proceed silently (untracked plan, or the
 * count failed — never block the front desk).
 */
export async function fetchCheckInUsage(
  supabase: SupabaseClient,
  m: Pick<Membership, "id" | "start_date" | "plan">,
  today: string,
  locale: LocaleWindow,
): Promise<{ used: number; warning: CheckInWarning | null } | null> {
  if (!m.plan) return null;
  const startInstant = usageWindowInstant(m, today, locale);
  if (!startInstant) return null;
  try {
    const { count, error } = await supabase
      .from("attendance")
      .select("id", { count: "exact", head: true })
      .eq("membership_id", m.id)
      .gte("checked_in_at", startInstant);
    if (error) return null;
    const used = count ?? 0;
    return { used, warning: checkInWarning(m.plan, used) };
  } catch {
    return null;
  }
}

/**
 * Batched usage counts for a list of memberships, each against its OWN
 * window (migration 063 RPC — a server-side GROUP BY, so the result is
 * one small row per membership and can't be truncated by the PostgREST
 * max-rows cap the way a raw-rows fetch could). Returns an empty map on
 * failure (same never-block policy).
 */
export async function fetchUsageCounts(
  supabase: SupabaseClient,
  memberships: Pick<Membership, "id" | "start_date" | "plan">[],
  today: string,
  locale: LocaleWindow,
): Promise<Map<string, number>> {
  const tracked = memberships
    .map((m) => ({ id: m.id, instant: usageWindowInstant(m, today, locale) }))
    .filter((t): t is { id: string; instant: string } => t.instant !== null);
  if (tracked.length === 0) return new Map();
  const { data, error } = await supabase.rpc("attendance_usage_counts", {
    p_membership_ids: tracked.map((t) => t.id),
    p_window_starts: tracked.map((t) => t.instant),
  });
  if (error || !data) return new Map();
  return new Map(
    (data as { membership_id: string; used: number }[]).map((r) => [
      r.membership_id,
      Number(r.used) || 0,
    ]),
  );
}
