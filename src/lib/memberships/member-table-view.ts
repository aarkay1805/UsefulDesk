export type MemberTableSortDirection = 'asc' | 'desc';

export interface MemberTableSort {
  key: string;
  dir: MemberTableSortDirection;
}

/**
 * Match the Leads table's column-sort semantics: choosing the direction that
 * is already active clears the explicit sort, while every other choice makes
 * that column and direction active.
 */
export function nextMemberColumnSort(
  current: MemberTableSort | null,
  key: string,
  dir: MemberTableSortDirection
): MemberTableSort | null {
  return current?.key === key && current.dir === dir ? null : { key, dir };
}

export interface MemberTableRecordRange {
  start: number;
  end: number;
}

/** Return the one-based record range represented by a server-paginated page. */
export function memberTableRecordRange(
  totalCount: number,
  page: number,
  pageSize: number
): MemberTableRecordRange | null {
  if (totalCount <= 0) return null;

  const start = page * pageSize + 1;
  if (start > totalCount) return null;

  return {
    start,
    end: Math.min((page + 1) * pageSize, totalCount),
  };
}
