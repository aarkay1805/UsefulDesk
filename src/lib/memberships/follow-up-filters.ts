import type { FollowUpReason } from '@/types';

export type FollowUpBucket = 'overdue' | 'today' | 'upcoming';

export const FOLLOW_UP_BUCKET_OPTIONS: {
  value: FollowUpBucket;
  label: string;
}[] = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'upcoming', label: 'Upcoming' },
];

/** Sentinel used by the UI for follow-ups without a current owner. */
export const UNASSIGNED_FOLLOW_UP = '__unassigned__';

export interface FollowUpFilters {
  buckets: FollowUpBucket[];
  reasons: FollowUpReason[];
  /** Profile user ids plus UNASSIGNED_FOLLOW_UP. */
  assignees: string[];
}

export const EMPTY_FOLLOW_UP_FILTERS: FollowUpFilters = {
  buckets: [],
  reasons: [],
  assignees: [],
};

/** Number of active filter groups, used by the toolbar counter. */
export function activeFollowUpFilterCount(filters: FollowUpFilters): number {
  return (
    (filters.buckets.length ? 1 : 0) +
    (filters.reasons.length ? 1 : 0) +
    (filters.assignees.length ? 1 : 0)
  );
}

function dueCondition(bucket: FollowUpBucket, today: string): string {
  switch (bucket) {
    case 'overdue':
      return `due_date.lt.${today}`;
    case 'today':
      return `due_date.eq.${today}`;
    case 'upcoming':
      return `due_date.gt.${today}`;
  }
}

/** Pure PostgREST OR clause for the three mutually exhaustive due buckets. */
export function followUpDueOrClause(
  buckets: FollowUpBucket[],
  today: string
): string | null {
  if (buckets.length === 0) return null;
  return buckets.map((bucket) => dueCondition(bucket, today)).join(',');
}

interface FollowUpFilterableQuery {
  in(column: string, values: readonly string[]): unknown;
  is(column: string, value: null): unknown;
  or(filters: string): unknown;
}

/**
 * Apply the shared toolbar/header filters to any follow_ups query. Page
 * fetching and "all matching" selection both use this exact definition.
 */
export function applyFollowUpFilters<Q>(
  query: Q,
  filters: FollowUpFilters,
  today: string
): Q {
  // PostgREST builders mutate their URL and return themselves. Keeping this
  // surface non-recursive avoids TypeScript's instantiation-depth limit on
  // Supabase queries with embedded contact rows.
  const q = query as unknown as FollowUpFilterableQuery;

  if (filters.reasons.length) q.in('reason', filters.reasons);

  if (filters.assignees.length) {
    const includeUnassigned = filters.assignees.includes(UNASSIGNED_FOLLOW_UP);
    const userIds = filters.assignees.filter(
      (value) => value !== UNASSIGNED_FOLLOW_UP
    );
    if (includeUnassigned && userIds.length) {
      q.or(`assigned_to.is.null,assigned_to.in.(${userIds.join(',')})`);
    } else if (includeUnassigned) {
      q.is('assigned_to', null);
    } else {
      q.in('assigned_to', userIds);
    }
  }

  const dueClause = followUpDueOrClause(filters.buckets, today);
  if (dueClause) q.or(dueClause);

  return query;
}
