import type { RecipientStatus } from '@/types';

export const RECIPIENT_PAGE_SIZE = 50;
export const RECIPIENT_EXPORT_PAGE_SIZE = 200;

export type RecipientCursor = {
  createdAt: string;
  id: string;
};

type RecipientRow = {
  created_at: string;
  id: string;
};

export function recipientCursorFilter(cursor: RecipientCursor): string {
  return `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`;
}

export function boundedRecipientPage<T extends RecipientRow>(
  rows: T[],
  pageSize: number
): { rows: T[]; nextCursor: RecipientCursor | null } {
  const page = rows.slice(0, pageSize);
  const last = page[page.length - 1];

  return {
    rows: page,
    nextCursor:
      rows.length > pageSize && last
        ? { createdAt: last.created_at, id: last.id }
        : null,
  };
}

export async function walkRecipientPages<T>(
  fetchPage: (cursor: RecipientCursor | null) => Promise<{
    rows: T[];
    nextCursor: RecipientCursor | null;
  }>
): Promise<T[]> {
  const allRows: T[] = [];
  let cursor: RecipientCursor | null = null;

  do {
    const page = await fetchPage(cursor);
    allRows.push(...page.rows);
    cursor = page.nextCursor;
  } while (cursor);

  return allRows;
}

export function recipientStatusQuery(
  status: RecipientStatus | 'all'
): RecipientStatus | null {
  return status === 'all' ? null : status;
}
