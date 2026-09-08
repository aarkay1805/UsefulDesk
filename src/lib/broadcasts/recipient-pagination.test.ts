import { describe, expect, it } from 'vitest';
import {
  boundedRecipientPage,
  recipientCursorFilter,
  walkRecipientPages,
} from './recipient-pagination';

describe('broadcast recipient pagination', () => {
  it('uses a timestamp and id cursor so equal timestamps do not skip rows', () => {
    expect(
      recipientCursorFilter({
        createdAt: '2026-09-08T10:00:00.000Z',
        id: 'recipient-b',
      })
    ).toBe(
      'created_at.lt.2026-09-08T10:00:00.000Z,and(created_at.eq.2026-09-08T10:00:00.000Z,id.lt.recipient-b)'
    );
  });

  it('keeps a bounded page and exposes its last row as the continuation', () => {
    const result = boundedRecipientPage(
      [
        { id: '3', created_at: '2026-09-08T10:00:03.000Z' },
        { id: '2', created_at: '2026-09-08T10:00:02.000Z' },
        { id: '1', created_at: '2026-09-08T10:00:01.000Z' },
      ],
      2
    );

    expect(result.rows.map((row) => row.id)).toEqual(['3', '2']);
    expect(result.nextCursor).toEqual({
      id: '2',
      createdAt: '2026-09-08T10:00:02.000Z',
    });
  });

  it('walks every bounded export page in order', async () => {
    const cursors: Array<string | null> = [];
    const rows = await walkRecipientPages(async (cursor) => {
      cursors.push(cursor?.id ?? null);
      if (!cursor) {
        return {
          rows: ['newest', 'middle'],
          nextCursor: { createdAt: '2026-09-08T10:00:02.000Z', id: 'middle' },
        };
      }
      return { rows: ['oldest'], nextCursor: null };
    });

    expect(rows).toEqual(['newest', 'middle', 'oldest']);
    expect(cursors).toEqual([null, 'middle']);
  });
});
