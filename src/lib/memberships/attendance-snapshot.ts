import type { SupabaseClient } from '@supabase/supabase-js';

import type { SortDir } from '@/components/table/column-header';
import type { Attendance, Membership } from '@/types';

export type AttendanceBucket = 'present' | 'absent';
export type AttendanceSortKey = 'name' | 'checked_in_at' | 'checked_out_at';

export interface AttendanceSort {
  key: AttendanceSortKey;
  dir: SortDir;
}

export interface AttendanceSnapshotRow {
  membership: Membership;
  attendance: Attendance | null;
  used: number;
}

export interface AttendanceSnapshotPage {
  rows: AttendanceSnapshotRow[];
  page: number;
  totalCount: number;
  presentCount: number;
  absentCount: number;
  planOptions: { value: string; label: string }[];
}

export interface AttendanceSnapshotQuery {
  dayStart: string;
  dayEnd: string;
  today: string;
  timeZone: string;
  weekStart: number;
  includeUsage: boolean;
  bucket: AttendanceBucket;
  search: string;
  planIds: string[];
  sort: AttendanceSort;
  page: number;
  pageSize: number;
}

export const EMPTY_ATTENDANCE_SNAPSHOT: AttendanceSnapshotPage = {
  rows: [],
  page: 0,
  totalCount: 0,
  presentCount: 0,
  absentCount: 0,
  planOptions: [],
};

export function attendanceSnapshotRpcArgs(query: AttendanceSnapshotQuery) {
  return {
    p_day_start: query.dayStart,
    p_day_end: query.dayEnd,
    p_today: query.today,
    p_time_zone: query.timeZone,
    p_week_start: query.weekStart,
    p_include_usage: query.includeUsage,
    p_bucket: query.bucket,
    p_search: query.search,
    p_plan_ids: query.planIds,
    p_sort_key: query.sort.key,
    p_sort_direction: query.sort.dir,
    p_page: query.page,
    p_page_size: query.pageSize,
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid attendance ${label}`);
  }
  return value as Record<string, unknown>;
}

function count(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid attendance ${label}`);
  }
  return parsed;
}

function amount(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid attendance ${label}`);
  }
  return parsed;
}

export function parseAttendanceSnapshotPage(
  value: unknown
): AttendanceSnapshotPage {
  const payload = object(value, 'response');
  if (!Array.isArray(payload.rows)) {
    throw new Error('Invalid attendance rows');
  }
  if (!Array.isArray(payload.planOptions)) {
    throw new Error('Invalid attendance plan options');
  }

  const rows = payload.rows.map((value, index) => {
    const row = object(value, `row ${index + 1}`);
    const membership = object(row.membership, `row ${index + 1} membership`);
    const contact = object(membership.contact, `row ${index + 1} contact`);
    const plan =
      membership.plan === null
        ? null
        : object(membership.plan, `row ${index + 1} plan`);
    const attendance =
      row.attendance === null
        ? null
        : object(row.attendance, `row ${index + 1} visit`);

    if (
      typeof membership.id !== 'string' ||
      typeof membership.account_id !== 'string' ||
      typeof membership.contact_id !== 'string' ||
      typeof membership.start_date !== 'string' ||
      typeof membership.end_date !== 'string' ||
      typeof contact.id !== 'string' ||
      (plan !== null && typeof plan.id !== 'string') ||
      (attendance !== null &&
        (typeof attendance.id !== 'string' ||
          typeof attendance.checked_in_at !== 'string'))
    ) {
      throw new Error(`Invalid attendance row ${index + 1}`);
    }

    return {
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
        contact,
        plan:
          plan === null
            ? undefined
            : {
                ...plan,
                price: amount(plan.price, `row ${index + 1} plan price`),
                duration_days: count(
                  plan.duration_days,
                  `row ${index + 1} plan duration`
                ),
              },
      } as unknown as Membership,
      attendance: attendance as unknown as Attendance | null,
      used: count(row.used, `row ${index + 1} usage`),
    };
  });

  const planOptions = payload.planOptions.map((value, index) => {
    const option = object(value, `plan option ${index + 1}`);
    if (typeof option.value !== 'string' || typeof option.label !== 'string') {
      throw new Error(`Invalid attendance plan option ${index + 1}`);
    }
    return { value: option.value, label: option.label };
  });

  return {
    rows,
    page: count(payload.page, 'page'),
    totalCount: count(payload.totalCount, 'total count'),
    presentCount: count(payload.presentCount, 'present count'),
    absentCount: count(payload.absentCount, 'absent count'),
    planOptions,
  };
}

export async function loadAttendanceSnapshot(
  supabase: SupabaseClient,
  query: AttendanceSnapshotQuery,
  signal?: AbortSignal
): Promise<AttendanceSnapshotPage> {
  let request = supabase.rpc(
    'member_attendance_page',
    attendanceSnapshotRpcArgs(query)
  );
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  return parseAttendanceSnapshotPage(data);
}
