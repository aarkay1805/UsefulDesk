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

export type ChurnRiskFilter = "yes" | "no";

export type FollowUpFilter = "open";

export const CHURN_RISK_OPTIONS: {
  value: ChurnRiskFilter;
  label: string;
}[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

export interface MemberFilters {
  /** membership_plans ids. */
  plans: string[];
  statuses: MemberStatusFilter[];
  feeStatus: ("paid" | "due")[];
  churnRisk: ChurnRiskFilter[];
  followUps: FollowUpFilter[];
}

export const EMPTY_MEMBER_FILTERS: MemberFilters = {
  plans: [],
  statuses: [],
  feeStatus: [],
  churnRisk: [],
  followUps: [],
};

/** Number of active filter groups — drives the Filters button badge. */
export function activeMemberFilterCount(f: MemberFilters): number {
  return (
    (f.plans.length ? 1 : 0) +
    (f.statuses.length ? 1 : 0) +
    (f.feeStatus.length ? 1 : 0) +
    (f.churnRisk.length ? 1 : 0) +
    (f.followUps.length ? 1 : 0)
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
  eq(column: string, value: string | boolean): Q;
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
  // `contact` is the !inner alias embedded by every member-list query.
  // Selecting both values intentionally leaves the boolean facet open,
  // matching the other multi-select facets when all options are checked.
  if (filters.churnRisk.length === 1) {
    q = q.eq("contact.churn_risk", filters.churnRisk[0] === "yes");
  }
  // The caller conditionally embeds this relation with `!inner` whenever
  // the facet is active, so the related-row filter also constrains the
  // top-level membership rows.
  if (filters.followUps.includes("open")) {
    q = q.eq("open_follow_ups.status", "open");
  }
  const orClause = memberStatusOrClause(filters.statuses, today);
  if (orClause) q = q.or(orClause);
  return q;
}
