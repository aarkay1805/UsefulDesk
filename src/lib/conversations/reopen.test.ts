import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { reopenClosedConversation } from './reopen';

function stubClient(
  result: {
    data?: { id: string } | null;
    error?: { message: string } | null;
  } = {}
) {
  const calls: {
    table: string;
    payload: Record<string, unknown> | null;
    filters: [string, unknown][];
  }[] = [];

  const client = {
    from(table: string) {
      const call = {
        table,
        payload: null,
        filters: [],
      } as (typeof calls)[number];
      calls.push(call);
      const builder = {
        update(payload: Record<string, unknown>) {
          call.payload = payload;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.filters.push([column, value]);
          return builder;
        },
        select() {
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({
            data: result.data ?? null,
            error: result.error ?? null,
          });
        },
      };
      return builder;
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

describe('reopenClosedConversation', () => {
  it('compare-and-sets a closed conversation to open', async () => {
    const { client, calls } = stubClient({ data: { id: 'conv-1' } });

    await expect(
      reopenClosedConversation(client, { id: 'conv-1', status: 'closed' })
    ).resolves.toBe(true);

    expect(calls[0].payload).toMatchObject({ status: 'open' });
    expect(calls[0].filters).toEqual([
      ['id', 'conv-1'],
      ['status', 'closed'],
    ]);
  });

  it.each(['open', 'pending', null])(
    'does not overwrite a %s status',
    async (status) => {
      const { client, calls } = stubClient();
      await expect(
        reopenClosedConversation(client, { id: 'conv-1', status })
      ).resolves.toBe(false);
      expect(calls).toEqual([]);
    }
  );

  it('reports a lost CAS without claiming the thread reopened', async () => {
    const { client } = stubClient({ data: null });
    await expect(
      reopenClosedConversation(client, { id: 'conv-1', status: 'closed' })
    ).resolves.toBe(false);
  });

  it('keeps inbound processing alive when the update fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { client } = stubClient({ error: { message: 'permission denied' } });

    await expect(
      reopenClosedConversation(client, { id: 'conv-1', status: 'closed' })
    ).resolves.toBe(false);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
