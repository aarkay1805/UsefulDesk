// Member-list filters — one value shape shared by All-members, its explicit
// select/export actions, and membership-backed queues so their controls cannot
// drift. Each database path owns the matching query representation.

import { ATTENDANCE_ARRIVAL_BUCKETS } from './attendance-snapshot';

/**
 * The status facet filters on the DERIVED lifecycle state, not the raw
 * `memberships.status` column: "expired" is computed at read time from
 * `end_date < today` (IST) while the row still says 'active' (see
 * effectiveStatus in expiry.ts). Trials are their own bucket regardless
 * of the underlying status.
 */
export type MemberStatusFilter =
  'active' | 'expired' | 'frozen' | 'cancelled' | 'trial' | 'service_customer';

export const MEMBER_STATUS_OPTIONS: {
  value: MemberStatusFilter;
  label: string;
}[] = [
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'frozen', label: 'Frozen' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'trial', label: 'Trial' },
  { value: 'service_customer', label: 'Service customers' },
];

export type ChurnRiskFilter = 'yes' | 'no';

export type FollowUpFilter = 'open';
export type ExpiryFilter =
  'today' | 'next7' | 'next30' | 'expired' | 'custom' | 'no_expiry';

export const EXPIRY_OPTIONS: { value: ExpiryFilter; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'next7', label: 'Next 7 days' },
  { value: 'next30', label: 'Next 30 days' },
  { value: 'expired', label: 'Already expired' },
  { value: 'custom', label: 'Custom range' },
  { value: 'no_expiry', label: 'No expiry' },
];

export const USUAL_TIME_GROUPS = ATTENDANCE_ARRIVAL_BUCKETS.flatMap((bucket) =>
  'range' in bucket
    ? [{ value: bucket.value, label: bucket.label, range: bucket.range }]
    : []
);
export const USUAL_TIME_UNASSIGNED = {
  value: 'unassigned',
  label: 'Not assigned',
};

export type UsualTimeGroup = (typeof USUAL_TIME_GROUPS)[number];
export type UsualTimeOption = { value: string; label: string };

export function usualTimeGroupOptions(
  group: UsualTimeGroup,
  options: UsualTimeOption[]
): UsualTimeOption[] {
  return options.filter((option) => {
    const time = option.value.slice(5);
    return (
      option.value.startsWith('time:') &&
      time >= group.range[0] &&
      time <= group.range[1]
    );
  });
}

export function usualTimeGroupSelection(
  selected: string[],
  group: UsualTimeGroup,
  options: UsualTimeOption[]
): { checked: boolean; indeterminate: boolean; count: number } {
  const times = usualTimeGroupOptions(group, options);
  const count = times.filter((option) =>
    selected.includes(option.value)
  ).length;
  return {
    checked: times.length > 0 && count === times.length,
    indeterminate: count > 0 && count < times.length,
    count,
  };
}

export function clearUsualTimeGroup(
  selected: string[],
  group: UsualTimeGroup,
  options: UsualTimeOption[]
): string[] {
  const values = new Set(
    usualTimeGroupOptions(group, options).map((o) => o.value)
  );
  return selected.filter((value) => !values.has(value));
}

export function toggleUsualTimeGroup(
  selected: string[],
  group: UsualTimeGroup,
  options: UsualTimeOption[]
): string[] {
  const times = usualTimeGroupOptions(group, options);
  if (times.length === 0) return selected;
  if (times.every((option) => selected.includes(option.value))) {
    return clearUsualTimeGroup(selected, group, options);
  }
  const values = new Set(selected);
  times.forEach((option) => values.add(option.value));
  return [...values];
}

/** Nullable contact ownership buckets used by both member filter surfaces. */
export const UNASSIGNED_MEMBER_FILTER = '__unassigned__';
export const NO_TRAINER_MEMBER_FILTER = '__no_trainer__';

export const CHURN_RISK_OPTIONS: {
  value: ChurnRiskFilter;
  label: string;
}[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

export interface MemberFilters {
  /** membership_plans ids. */
  plans: string[];
  statuses: MemberStatusFilter[];
  /** profiles.user_id values plus UNASSIGNED_MEMBER_FILTER. */
  assignees: string[];
  /** trainers.id values plus NO_TRAINER_MEMBER_FILTER. */
  trainers: string[];
  feeStatus: ('paid' | 'due')[];
  expiry: ExpiryFilter[];
  expiryFrom: string;
  expiryTo: string;
  usualTimes: string[];
  churnRisk: ChurnRiskFilter[];
  followUps: FollowUpFilter[];
}

export const EMPTY_MEMBER_FILTERS: MemberFilters = {
  plans: [],
  statuses: [],
  assignees: [],
  trainers: [],
  feeStatus: [],
  expiry: [],
  expiryFrom: '',
  expiryTo: '',
  usualTimes: [],
  churnRisk: [],
  followUps: [],
};

/** Number of active filter groups — drives the Filters button badge. */
export function activeMemberFilterCount(f: MemberFilters): number {
  return (
    (f.plans.length ? 1 : 0) +
    (f.statuses.length ? 1 : 0) +
    (f.assignees.length ? 1 : 0) +
    (f.trainers.length ? 1 : 0) +
    (f.feeStatus.length ? 1 : 0) +
    (f.expiry.length ? 1 : 0) +
    (f.usualTimes.length ? 1 : 0) +
    (f.churnRisk.length ? 1 : 0) +
    (f.followUps.length ? 1 : 0)
  );
}

// Each derived status as a PostgREST boolean expression on the
// memberships table. `today` = istToday() computed once per fetch — the
// expired/active boundary must be the IST day, never the server's UTC day.
function statusCondition(status: MemberStatusFilter, today: string): string {
  switch (status) {
    case 'active':
      return `and(status.eq.active,is_trial.eq.false,end_date.gte.${today})`;
    case 'expired':
      return `and(status.eq.active,is_trial.eq.false,end_date.lt.${today})`;
    case 'frozen':
      return 'status.eq.frozen';
    case 'cancelled':
      return 'status.eq.cancelled';
    case 'trial':
      return 'is_trial.eq.true';
    case 'service_customer':
      // Membership-backed queues cannot contain service-only customers.
      return 'id.eq.00000000-0000-0000-0000-000000000000';
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
  return statuses.map((s) => statusCondition(s, today)).join(',');
}

// Structural query surface — matches the supabase-js builder without
// importing it (same pattern as the leads page's FilterableQuery).
interface MemberFilterableQuery<Q> {
  in(column: string, values: readonly string[]): Q;
  eq(column: string, value: string | boolean): Q;
  is(column: string, value: null): Q;
  or(filters: string, options?: { referencedTable: string }): Q;
}

export function splitNullableMemberFilterValues(
  values: string[],
  nullSentinel: string
): { ids: string[]; includeNull: boolean } {
  return {
    ids: values.filter((value) => value !== nullSentinel),
    includeNull: values.includes(nullSentinel),
  };
}

function applyNullableContactFilter<Q extends MemberFilterableQuery<Q>>(
  query: Q,
  column: 'assigned_to' | 'trainer_id',
  values: string[],
  nullSentinel: string
): Q {
  const { ids, includeNull } = splitNullableMemberFilterValues(
    values,
    nullSentinel
  );
  if (ids.length && includeNull) {
    return query.or(`${column}.in.(${ids.join(',')}),${column}.is.null`, {
      referencedTable: 'contact',
    });
  }
  if (ids.length) return query.in(`contact.${column}`, ids);
  if (includeNull) return query.is(`contact.${column}`, null);
  return query;
}

/** Apply the Filters panel selections to a memberships query. */
export function applyMemberFilters<Q extends MemberFilterableQuery<Q>>(
  query: Q,
  filters: MemberFilters,
  today: string
): Q {
  let q = query;
  if (filters.plans.length) q = q.in('plan_id', filters.plans);
  if (filters.feeStatus.length) q = q.in('fee_status', filters.feeStatus);
  q = applyNullableContactFilter(
    q,
    'assigned_to',
    filters.assignees,
    UNASSIGNED_MEMBER_FILTER
  );
  q = applyNullableContactFilter(
    q,
    'trainer_id',
    filters.trainers,
    NO_TRAINER_MEMBER_FILTER
  );
  // `contact` is the !inner alias embedded by every member-list query.
  // Selecting both values intentionally leaves the boolean facet open,
  // matching the other multi-select facets when all options are checked.
  if (filters.churnRisk.length === 1) {
    q = q.eq('contact.churn_risk', filters.churnRisk[0] === 'yes');
  }
  // The caller conditionally embeds this relation with `!inner` whenever
  // the facet is active, so the related-row filter also constrains the
  // top-level membership rows.
  if (filters.followUps.includes('open')) {
    q = q.eq('open_follow_ups.status', 'open');
  }
  const orClause = memberStatusOrClause(filters.statuses, today);
  if (orClause) q = q.or(orClause);
  return q;
}
