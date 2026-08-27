import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { loadConversationsSeries, loadLeadFunnel } from './queries';

function queryBuilder(result: {
  data: unknown;
  error: unknown;
  count?: number | null;
}) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    order: vi.fn(() => builder),
    then: (
      resolve: (value: typeof result) => unknown,
      reject: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

describe('dashboard insight calendar boundaries', () => {
  it('buckets conversation points in the selected branch timezone', async () => {
    const messages = queryBuilder({
      data: [
        { created_at: '2026-08-26T18:29:59.000Z', sender_type: 'agent' },
        { created_at: '2026-08-26T18:30:00.000Z', sender_type: 'customer' },
        { created_at: '2026-08-27T04:30:00.000Z', sender_type: 'agent' },
      ],
      error: null,
    });
    const db = {
      from: vi.fn(() => messages),
    } as unknown as SupabaseClient;

    const result = await loadConversationsSeries(
      db,
      2,
      'Asia/Kolkata',
      '2026-08-27'
    );

    expect(messages.gte).toHaveBeenCalledWith(
      'created_at',
      '2026-08-25T18:30:00.000Z'
    );
    expect(result).toEqual([
      { day: '2026-08-26', incoming: 0, outgoing: 1 },
      { day: '2026-08-27', incoming: 1, outgoing: 1 },
    ]);
  });

  it('starts converted-this-month at branch-local midnight', async () => {
    const builders: Array<{
      table: string;
      builder: ReturnType<typeof queryBuilder>;
    }> = [];
    const db = {
      from: vi.fn((table: string) => {
        const result =
          table === 'memberships'
            ? { data: null, error: null, count: 0 }
            : { data: [], error: null };
        const builder = queryBuilder(result);
        builders.push({ table, builder });
        return builder;
      }),
      rpc: vi.fn(async () => ({ data: [], error: null })),
    } as unknown as SupabaseClient;

    await loadLeadFunnel(db, 'Asia/Kolkata', '2026-08-27');

    const memberships = builders.find((entry) => entry.table === 'memberships');
    expect(memberships?.builder.gte).toHaveBeenCalledWith(
      'created_at',
      '2026-07-31T18:30:00.000Z'
    );
  });
});
