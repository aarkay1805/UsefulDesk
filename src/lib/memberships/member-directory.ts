import type { SupabaseClient } from '@supabase/supabase-js';

import {
  NO_TRAINER_MEMBER_FILTER,
  splitNullableMemberFilterValues,
  UNASSIGNED_MEMBER_FILTER,
  type MemberFilters,
} from './filters';
import {
  normalizeCustomerDirectoryRow,
  type MemberCustomerDirectoryRow,
  type NormalizedMemberCustomerDirectoryRow,
} from './customer-directory';

export type MemberDirectoryQuickFilterCounts = {
  churnRisk: number;
  feesDue: number;
  followUps: number;
};

export interface MemberDirectoryPage {
  rows: NormalizedMemberCustomerDirectoryRow[];
  totalCount: number;
  quickFilterCounts: MemberDirectoryQuickFilterCounts;
}

export interface MemberDirectoryQuery {
  today: string;
  search: string;
  filters: MemberFilters;
  sort: { key: string; dir: 'asc' | 'desc' } | null;
  page: number;
  /** NULL is reserved for explicit select-all and export actions. */
  pageSize: number | null;
}

export const EMPTY_MEMBER_DIRECTORY_QUICK_FILTER_COUNTS: MemberDirectoryQuickFilterCounts =
  {
    churnRisk: 0,
    feesDue: 0,
    followUps: 0,
  };

export function memberDirectorySortKey(key: string): string {
  switch (key) {
    case 'name':
    case 'contact_name':
      return 'contact_name';
    case 'end_date':
    case 'display_expiry':
      return 'display_expiry';
    case 'fee_amount':
      return 'membership_fee_amount';
    case 'fee_status':
      return 'membership_fee_status';
    case 'start_date':
      return 'membership_start_date';
    default:
      return key;
  }
}

export function memberDirectoryRpcArgs(query: MemberDirectoryQuery) {
  const assignees = splitNullableMemberFilterValues(
    query.filters.assignees,
    UNASSIGNED_MEMBER_FILTER
  );
  const trainers = splitNullableMemberFilterValues(
    query.filters.trainers,
    NO_TRAINER_MEMBER_FILTER
  );
  return {
    p_today: query.today,
    p_search: query.search,
    p_plan_ids: query.filters.plans,
    p_statuses: query.filters.statuses,
    p_fee_statuses: query.filters.feeStatus,
    p_assignee_ids: assignees.ids,
    p_include_unassigned: assignees.includeNull,
    p_trainer_ids: trainers.ids,
    p_include_no_trainer: trainers.includeNull,
    p_churn_risk: query.filters.churnRisk,
    p_follow_ups: query.filters.followUps,
    p_sort_key: query.sort ? memberDirectorySortKey(query.sort.key) : null,
    p_sort_direction: query.sort?.dir ?? null,
    p_page: query.page,
    p_page_size: query.pageSize,
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid member directory ${label}`);
  }
  return value as Record<string, unknown>;
}

function count(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid member directory ${label}`);
  }
  return parsed;
}

export function parseMemberDirectoryPage(value: unknown): MemberDirectoryPage {
  const payload = object(value, 'response');
  if (!Array.isArray(payload.rows)) {
    throw new Error('Invalid member directory rows');
  }
  const quickFilters = object(payload.quickFilterCounts, 'quick-filter counts');

  return {
    rows: (payload.rows as MemberCustomerDirectoryRow[]).map(
      normalizeCustomerDirectoryRow
    ),
    totalCount: count(payload.totalCount, 'total count'),
    quickFilterCounts: {
      churnRisk: count(quickFilters.churnRisk, 'churn-risk count'),
      feesDue: count(quickFilters.feesDue, 'fees-due count'),
      followUps: count(quickFilters.followUps, 'follow-up count'),
    },
  };
}

/** One database boundary for All-members rows, total, facets, and search. */
export async function loadMemberDirectory(
  supabase: SupabaseClient,
  query: MemberDirectoryQuery
): Promise<MemberDirectoryPage> {
  const { data, error } = await supabase.rpc(
    'member_customer_directory_page',
    memberDirectoryRpcArgs(query)
  );
  if (error) throw error;
  return parseMemberDirectoryPage(data);
}
