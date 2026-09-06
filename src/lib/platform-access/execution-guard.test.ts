import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  requireCurrentExecution,
  RetiredExecutionError,
} from './execution-guard';

function client(row: Record<string, unknown>) {
  const filters: Array<[string, string, unknown]> = [];
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      filters.push(['eq', column, value]);
      return builder;
    },
    gt: (column: string, value: unknown) => {
      filters.push(['gt', column, value]);
      return builder;
    },
    maybeSingle: async () => ({
      error: null,
      data: filters.every(([op, col, val]) =>
        op === 'eq' ? row[col] === val : String(row[col]) > String(val)
      )
        ? row
        : null,
    }),
  };
  return { from: vi.fn(() => builder) } as unknown as SupabaseClient;
}

describe('retired worker authority', () => {
  it.each(['broadcast', 'automation'] as const)(
    'does not revive a retired %s lease after product access is restored',
    async (kind) => {
      const prefix = kind === 'broadcast' ? 'send_' : '';
      const parent = kind === 'broadcast' ? 'broadcast_id' : 'automation_id';
      const row: Record<string, unknown> = {
        id: 'work',
        [parent]: 'parent',
        status: kind === 'broadcast' ? 'pending' : 'running',
        [`${prefix}lease_owner`]: 'worker',
        [`${prefix}lease_until`]: '2099-01-01T00:00:00Z',
      };
      const execution = {
        kind,
        id: 'work',
        parentId: 'parent',
        owner: 'worker',
      };
      await expect(
        requireCurrentExecution(client(row), execution)
      ).resolves.toBeUndefined();
      row.status = 'failed';
      row[`${prefix}lease_owner`] = null;
      row[`${prefix}lease_until`] = null;
      await expect(
        requireCurrentExecution(client(row), execution)
      ).rejects.toBeInstanceOf(RetiredExecutionError);
    }
  );
  it('blocks a cached flow run after the database run is retired', async () => {
    const row = { id: 'run', account_id: 'account', status: 'active' };
    const execution = {
      kind: 'flow' as const,
      id: 'run',
      accountId: 'account',
    };
    await expect(
      requireCurrentExecution(client(row), execution)
    ).resolves.toBeUndefined();
    row.status = 'failed';
    await expect(
      requireCurrentExecution(client(row), execution)
    ).rejects.toBeInstanceOf(RetiredExecutionError);
  });
  it('rejects an expired or reassigned lease even with active product access', async () => {
    for (const row of [
      { lease_owner: 'other-worker', lease_until: '2099-01-01T00:00:00Z' },
      { lease_owner: 'worker', lease_until: '2000-01-01T00:00:00Z' },
    ])
      await expect(
        requireCurrentExecution(
          client({
            id: 'work',
            automation_id: 'parent',
            status: 'running',
            ...row,
          }),
          {
            kind: 'automation',
            id: 'work',
            parentId: 'parent',
            owner: 'worker',
          }
        )
      ).rejects.toBeInstanceOf(RetiredExecutionError);
  });
});
