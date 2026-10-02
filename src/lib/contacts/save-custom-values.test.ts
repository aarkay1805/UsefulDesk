import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { saveContactCustomValues } from './save-custom-values';

function database(rows: { custom_field_id: string }[], error: unknown = null) {
  const response = { data: rows, error };
  const query = {
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    select: vi.fn(async () => response),
    then: (resolve: (value: typeof response) => unknown) =>
      Promise.resolve(response).then(resolve),
  };
  const table = {
    delete: vi.fn(() => query),
    insert: vi.fn(() => query),
    upsert: vi.fn(() => query),
  };
  return {
    client: { from: () => table } as unknown as SupabaseClient,
    table,
    query,
  };
}

describe('custom enquiry field saves', () => {
  it('updates a value without deleting the saved value first', async () => {
    const { client, table } = database([{ custom_field_id: 'goal' }]);
    await saveContactCustomValues(
      client,
      'lead',
      { goal: 'Strength' },
      { goal: 'Fitness' }
    );
    expect(table.delete).not.toHaveBeenCalled();
    expect(table.upsert).toHaveBeenCalledWith(
      [{ contact_id: 'lead', custom_field_id: 'goal', value: 'Strength' }],
      { onConflict: 'contact_id,custom_field_id' }
    );
  });

  it('does not erase other custom values when clearing one field', async () => {
    const { client, query } = database([{ custom_field_id: 'goal' }]);
    await saveContactCustomValues(
      client,
      'lead',
      { goal: '' },
      { goal: 'Fitness' }
    );
    expect(query.in).toHaveBeenCalledWith('custom_field_id', ['goal']);
  });

  it('rejects a blocked update instead of claiming the custom value saved', async () => {
    const { client } = database([]);
    await expect(
      saveContactCustomValues(
        client,
        'lead',
        { goal: 'Strength' },
        { goal: 'Fitness' }
      )
    ).rejects.toThrow('Could not save');
  });

  it('rejects a blocked clear of a previously saved field', async () => {
    const { client } = database([]);
    await expect(
      saveContactCustomValues(client, 'lead', { goal: '' }, { goal: 'Fitness' })
    ).rejects.toThrow('Could not save');
  });

  it('skips unchanged values and empty fields that were never saved', async () => {
    const { client, table } = database([]);
    await saveContactCustomValues(
      client,
      'lead',
      { goal: ' Fitness ', other: '' },
      { goal: 'Fitness' }
    );
    expect(table.delete).not.toHaveBeenCalled();
    expect(table.upsert).not.toHaveBeenCalled();
  });

  it('leaves saved values intact when a replacement write fails', async () => {
    const error = { message: 'No internet connection' };
    const { client, table } = database([], error);
    await expect(
      saveContactCustomValues(
        client,
        'lead',
        { goal: 'Strength' },
        { goal: 'Fitness' }
      )
    ).rejects.toBe(error);
    expect(table.delete).not.toHaveBeenCalled();
  });
});
