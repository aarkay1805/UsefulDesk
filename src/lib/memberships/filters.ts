// Member-list filters — the single definition shared by the All-members
// table, its select-all-matching, and CSV export so they can't drift
// (mirrors the leads page's applyLeadFilters).

/**
 * The status facet filters on the DERIVED lifecycle state, not the raw
 * `memberships.status` column: "expired" is computed at read time from
 * `end_date < today` (IST) while the row still says 'active' (see
 * effectiveStatus in expiry.ts). Trials are their own bucket regardless
 * of the underlying status.
 */
export type MemberStatusFilter =
  | "active"
  | "expired"
  | "frozen"
  | "cancelled"
  | "trial";

export const MEMBER_STATUS_OPTIONS: {
  value: MemberStatusFilter;
  label: string;
}[] = [
  { value: "active", label: "Active" },
  { value: "expired", label: "Expired" },
  { value: "frozen", label: "Frozen" },
  { value: "cancelled", label: "Cancelled" },
  { value: "trial", label: "Trial" },
];

export interface MemberFilters {
  /** membership_plans ids. */
  plans: string[];
  statuses: MemberStatusFilter[];
  feeStatus: ("paid" | "due")[];
}

export const EMPTY_MEMBER_FILTERS: MemberFilters = {
  plans: [],
  statuses: [],
  feeStatus: [],
};

/** Number of active filter groups — drives the Filters button badge. */
export function activeMemberFilterCount(f: MemberFilters): number {
  return (
    (f.plans.length ? 1 : 0) +
    (f.statuses.length ? 1 : 0) +
    (f.feeStatus.length ? 1 : 0)
  );
}

// Each derived status as a PostgREST boolean expression on the
// memberships table. `today` = istToday() computed once per fetch — the
// expired/active boundary must be the IST day, never the server's UTC day.
function statusCondition(status: MemberStatusFilter, today: string): string {
  switch (status) {
    case "active":
      return `and(status.eq.active,is_trial.eq.false,end_date.gte.${today})`;
    case "expired":
      return `and(status.eq.active,is_trial.eq.false,end_date.lt.${today})`;
    case "frozen":
      return "status.eq.frozen";
    case "cancelled":
      return "status.eq.cancelled";
    case "trial":
      return "is_trial.eq.true";
  }
}

/**
 * The `.or(...)` clause for a set of derived statuses, or null when the
 * facet is inactive. Pure so the derived-status boundary logic is
 * unit-testable without a query builder.
 */
export function memberStatusOrClause(
  statuses: MemberStatusFilter[],
  today: string
): string | null {
  if (statuses.length === 0) return null;
  return statuses.map((s) => statusCondition(s, today)).join(",");
}

// Structural query surface — matches the supabase-js builder without
// importing it (same pattern as the leads page's FilterableQuery).
interface MemberFilterableQuery<Q> {
  in(column: string, values: readonly string[]): Q;
  or(filters: string): Q;
}

/** Apply the Filters panel selections to a memberships query. */
export function applyMemberFilters<Q extends MemberFilterableQuery<Q>>(
  query: Q,
  filters: MemberFilters,
  today: string
): Q {
  let q = query;
  if (filters.plans.length) q = q.in("plan_id", filters.plans);
  if (filters.feeStatus.length) q = q.in("fee_status", filters.feeStatus);
  const orClause = memberStatusOrClause(filters.statuses, today);
  if (orClause) q = q.or(orClause);
  return q;
}
