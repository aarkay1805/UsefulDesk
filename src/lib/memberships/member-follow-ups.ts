import type { SupabaseClient } from '@supabase/supabase-js';

import type { SortState } from '@/components/leads/leads-sort';
import type { FollowUpQueueScope } from '@/components/follow-ups/follow-up-queue-controls';
import {
  UNASSIGNED_FOLLOW_UP,
  type FollowUpFilters,
} from '@/lib/memberships/follow-up-filters';
import type { FollowUp } from '@/types';

export interface MemberFollowUpsPage {
  rows: FollowUp[];
  page: number;
  totalCount: number;
  bucketCounts: {
    all: number;
    overdue: number;
    today: number;
    upcoming: number;
  };
}

export interface MemberFollowUpsQuery {
  today: string;
  search: string;
  scope: FollowUpQueueScope;
  filters: FollowUpFilters;
  sort: SortState | null;
  page: number;
  pageSize: number;
}

export const EMPTY_MEMBER_FOLLOW_UPS_PAGE: MemberFollowUpsPage = {
  rows: [],
  page: 0,
  totalCount: 0,
  bucketCounts: { all: 0, overdue: 0, today: 0, upcoming: 0 },
};

export function memberFollowUpsRpcArgs(query: MemberFollowUpsQuery) {
  return {
    p_today: query.today,
    p_search: query.search,
    p_scope: query.scope,
    p_reasons: query.filters.reasons,
    p_assignee_ids: query.filters.assignees.filter(
      (value) => value !== UNASSIGNED_FOLLOW_UP
    ),
    p_include_unassigned:
      query.filters.assignees.includes(UNASSIGNED_FOLLOW_UP),
    p_buckets: query.filters.buckets,
    p_sort_key: query.sort?.key ?? 'due_date',
    p_sort_direction: query.sort?.dir ?? 'asc',
    p_page: query.page,
    p_page_size: query.pageSize,
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid member follow-up ${label}`);
  }
  return value as Record<string, unknown>;
}

function count(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid member follow-up ${label}`);
  }
  return parsed;
}

function amount(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid member follow-up ${label}`);
  }
  return parsed;
}

export function parseMemberFollowUpsPage(value: unknown): MemberFollowUpsPage {
  const payload = object(value, 'response');
  if (!Array.isArray(payload.rows)) {
    throw new Error('Invalid member follow-up rows');
  }
  const buckets = object(payload.bucketCounts, 'bucket counts');

  const rows = payload.rows.map((value, index) => {
    const row = object(value, `row ${index + 1}`);
    const contact = object(row.contact, `row ${index + 1} contact`);
    const membership = object(row.membership, `row ${index + 1} membership`);
    const membershipContact = object(
      membership.contact,
      `row ${index + 1} membership contact`
    );

    if (
      typeof row.id !== 'string' ||
      typeof row.membership_id !== 'string' ||
      typeof row.created_by !== 'string' ||
      typeof row.reason !== 'string' ||
      typeof row.task_type !== 'string' ||
      typeof row.due_date !== 'string' ||
      typeof contact.id !== 'string' ||
      typeof membership.id !== 'string' ||
      typeof membership.start_date !== 'string' ||
      typeof membership.end_date !== 'string' ||
      typeof membershipContact.id !== 'string'
    ) {
      throw new Error(`Invalid member follow-up row ${index + 1}`);
    }

    return {
      ...row,
      contact,
      membership: {
        ...membership,
        member_number: count(
          membership.member_number,
          `row ${index + 1} member ID`
        ),
        fee_amount: amount(
          membership.fee_amount,
          `row ${index + 1} membership fee`
        ),
        contact: membershipContact,
      },
    } as unknown as FollowUp;
  });

  return {
    rows,
    page: count(payload.page, 'page'),
    totalCount: count(payload.totalCount, 'total count'),
    bucketCounts: {
      all: count(buckets.all, 'all count'),
      overdue: count(buckets.overdue, 'overdue count'),
      today: count(buckets.today, 'today count'),
      upcoming: count(buckets.upcoming, 'upcoming count'),
    },
  };
}

export async function loadMemberFollowUps(
  supabase: SupabaseClient,
  query: MemberFollowUpsQuery,
  signal?: AbortSignal
): Promise<MemberFollowUpsPage> {
  let request = supabase.rpc(
    'member_follow_ups_page',
    memberFollowUpsRpcArgs(query)
  );
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  return parseMemberFollowUpsPage(data);
}
