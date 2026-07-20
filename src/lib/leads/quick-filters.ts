export type LeadQuickFilter =
  'all' | 'no_followup' | 'unassigned' | 'mine' | 'new_today';

export const LEAD_QUICK_FILTERS: LeadQuickFilter[] = [
  'no_followup',
  'unassigned',
  'mine',
  'new_today',
];

const QUICK_FILTER_URL: Record<Exclude<LeadQuickFilter, 'all'>, string> = {
  no_followup: 'no-follow-up',
  unassigned: 'unassigned',
  mine: 'mine',
  new_today: 'new-today',
};

const NO_MATCH_ID = '00000000-0000-0000-0000-000000000000';

interface QuickFilterQuery<Q> {
  eq(column: string, value: string): Q;
  gte(column: string, value: string): Q;
  is(column: string, value: null): Q;
  lt(column: string, value: string): Q;
  or(filters: string): Q;
}

export interface LeadQuickFilterContext {
  userId: string | null;
  todayStart: string;
  tomorrowStart: string;
}

/**
 * The no-follow-up view uses a filtered PostgREST anti-join: only open
 * follow-ups participate, then `open_follow_ups IS NULL` keeps contacts for
 * which no such row exists. The alias must be present in every select using
 * that filter, including head-count and id-only queries.
 */
export function selectForLeadQuickFilter(
  select: string,
  filter: LeadQuickFilter
): string {
  if (filter !== 'no_followup') return select;
  return `${select}, open_follow_ups:follow_ups!left(id)`;
}

export function applyLeadQuickFilter<Q extends QuickFilterQuery<Q>>(
  query: Q,
  filter: LeadQuickFilter,
  context: LeadQuickFilterContext
): Q {
  let q = query;
  switch (filter) {
    case 'all':
      return q;
    case 'no_followup':
      q = q.is('lead_status', null);
      q = q.eq('open_follow_ups.status', 'open');
      return q.is('open_follow_ups', null);
    case 'unassigned':
      q = q.or('lead_status.is.null,lead_status.neq.lost');
      q = q.is('assigned_to', null);
      return q.is('pending_invitation_id', null);
    case 'mine':
      q = q.or('lead_status.is.null,lead_status.neq.lost');
      return q.eq('assigned_to', context.userId ?? NO_MATCH_ID);
    case 'new_today':
      q = q.is('lead_status', null);
      q = q.gte('created_at', context.todayStart);
      return q.lt('created_at', context.tomorrowStart);
  }
}

export function leadQuickFilterFromUrl(value: string | null): LeadQuickFilter {
  if (!value) return 'all';
  const match = Object.entries(QUICK_FILTER_URL).find(
    ([, urlValue]) => urlValue === value
  );
  return (match?.[0] as LeadQuickFilter | undefined) ?? 'all';
}

export function leadQuickFilterToUrl(filter: LeadQuickFilter): string | null {
  return filter === 'all' ? null : QUICK_FILTER_URL[filter];
}
