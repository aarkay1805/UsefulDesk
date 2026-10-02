import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { updateContact } from './update-contact';

function clientFor(data: { id: string }[] | null, error: unknown = null) {
  const result = { data, error };
  const query = {
    then: (resolve: (value: typeof result) => unknown) =>
      Promise.resolve(result).then(resolve),
    select: vi.fn(() => Promise.resolve(result)),
  };
  const eq = vi.fn(() => query);
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  return {
    client: { from } as unknown as SupabaseClient,
    from,
    update,
    eq,
    query,
  };
}

describe('contact update confirmation', () => {
  it('rejects an RLS-blocked or removed contact instead of reporting a saved edit', async () => {
    const { client } = clientFor([]);
    await expect(
      updateContact(client, 'lead-1', { name: 'Asha' })
    ).rejects.toThrow('Could not save');
  });

  it('confirms the edited contact before the caller changes its displayed fields', async () => {
    const { client, from, update, eq, query } = clientFor([{ id: 'lead-1' }]);
    await expect(
      updateContact(client, 'lead-1', { name: 'Asha' })
    ).resolves.toBeUndefined();
    expect(from).toHaveBeenCalledWith('contacts');
    expect(update).toHaveBeenCalledWith({
      name: 'Asha',
      updated_at: expect.any(String),
    });
    expect(eq).toHaveBeenCalledWith('id', 'lead-1');
    expect(query.select).toHaveBeenCalledWith('id');
  });

  it('preserves database error codes so duplicate phones get the existing recovery message', async () => {
    const error = { code: '23505', message: 'duplicate key value' };
    const { client } = clientFor(null, error);
    await expect(
      updateContact(client, 'lead-1', { phone: '+919876543210' })
    ).rejects.toBe(error);
  });
});
