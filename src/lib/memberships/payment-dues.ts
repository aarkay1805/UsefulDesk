import type { SupabaseClient } from '@supabase/supabase-js';

import type { SortState } from '@/components/leads/leads-sort';
import type { PaymentDueFilterState } from '@/components/members/payment-table-filters';
import type { Membership } from '@/types';

export interface MemberPaymentTotals {
  today: number;
  week: number;
  month: number;
  outstanding: number;
}

export type MemberPaymentDueRow = Membership & { balance: number };

export interface MemberPaymentDuesPage {
  rows: MemberPaymentDueRow[];
  page: number;
  totalCount: number;
  outstandingCount: number;
  bucketCounts: { due_today: number; overdue: number };
  planOptions: { id: string; name: string }[];
  summary: MemberPaymentTotals;
}

export interface MemberPaymentDuesQuery {
  today: string;
  search: string;
  filters: PaymentDueFilterState;
  sort: SortState;
  page: number;
  pageSize: number;
}

export const EMPTY_MEMBER_PAYMENT_DUES_PAGE: MemberPaymentDuesPage = {
  rows: [],
  page: 0,
  totalCount: 0,
  outstandingCount: 0,
  bucketCounts: { due_today: 0, overdue: 0 },
  planOptions: [],
  summary: { today: 0, week: 0, month: 0, outstanding: 0 },
};

export function memberPaymentDuesRpcArgs(query: MemberPaymentDuesQuery) {
  return {
    p_today: query.today,
    p_search: query.search,
    p_plan_ids: query.filters.plans,
    p_buckets: query.filters.buckets,
    p_sort_key: query.sort.key,
    p_sort_direction: query.sort.dir,
    p_page: query.page,
    p_page_size: query.pageSize,
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid member payment ${label}`);
  }
  return value as Record<string, unknown>;
}

function count(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid member payment ${label}`);
  }
  return parsed;
}

function amount(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid member payment ${label}`);
  }
  return parsed;
}

export function parseMemberPaymentDuesPage(
  value: unknown
): MemberPaymentDuesPage {
  const payload = object(value, 'response');
  if (!Array.isArray(payload.rows)) {
    throw new Error('Invalid member payment rows');
  }
  if (!Array.isArray(payload.planOptions)) {
    throw new Error('Invalid member payment plan options');
  }
  const buckets = object(payload.bucketCounts, 'bucket counts');
  const summary = object(payload.summary, 'summary');

  const rows = payload.rows.map((value, index) => {
    const row = object(value, `row ${index + 1}`);
    if (typeof row.id !== 'string' || typeof row.start_date !== 'string') {
      throw new Error(`Invalid member payment row ${index + 1}`);
    }
    return {
      ...row,
      member_number: count(row.member_number, `row ${index + 1} member ID`),
      fee_amount: amount(row.fee_amount, `row ${index + 1} fee`),
      balance: amount(row.balance, `row ${index + 1} balance`),
    } as unknown as MemberPaymentDueRow;
  });

  const planOptions = payload.planOptions.map((value, index) => {
    const option = object(value, `plan option ${index + 1}`);
    if (typeof option.id !== 'string' || typeof option.name !== 'string') {
      throw new Error(`Invalid member payment plan option ${index + 1}`);
    }
    return { id: option.id, name: option.name };
  });

  return {
    rows,
    page: count(payload.page, 'page'),
    totalCount: count(payload.totalCount, 'total count'),
    outstandingCount: count(payload.outstandingCount, 'outstanding count'),
    bucketCounts: {
      due_today: count(buckets.due_today, 'due-today count'),
      overdue: count(buckets.overdue, 'overdue count'),
    },
    planOptions,
    summary: {
      today: amount(summary.today, 'today total'),
      week: amount(summary.week, 'week total'),
      month: amount(summary.month, 'month total'),
      outstanding: amount(summary.outstanding, 'outstanding total'),
    },
  };
}

export async function loadMemberPaymentDues(
  supabase: SupabaseClient,
  query: MemberPaymentDuesQuery,
  signal?: AbortSignal
): Promise<MemberPaymentDuesPage> {
  let request = supabase.rpc(
    'member_payment_dues_page',
    memberPaymentDuesRpcArgs(query)
  );
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  return parseMemberPaymentDuesPage(data);
}
