import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveContactConversation } from './resolve-contact-conversation';

interface Script {
  contact?: { id: string } | null;
  contactError?: { code?: string; message: string } | null;
  conversations?: Array<{ id: string } | null>;
  createdId?: string | null;
  createError?: { code?: string; message: string } | null;
}

function makeDb(script: Script) {
  const inserted: Record<string, unknown>[] = [];
  const filters: Array<{
    table: 'contacts' | 'conversations';
    column: string;
    value: unknown;
  }> = [];
  const order = vi.fn();
  const limit = vi.fn();
  let conversationLookup = 0;

  const db = {
    from(table: string) {
      if (table === 'contacts') {
        const builder = {
          select: vi.fn(() => builder),
          eq: vi.fn((column: string, value: unknown) => {
            filters.push({ table: 'contacts', column, value });
            return builder;
          }),
          maybeSingle: vi.fn(async () => ({
            data: script.contact ?? null,
            error: script.contactError ?? null,
          })),
        };
        return builder;
      }

      if (table !== 'conversations') {
        throw new Error(`Unexpected table ${table}`);
      }

      let inserting = false;
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn((column: string, value: unknown) => {
          filters.push({ table: 'conversations', column, value });
          return builder;
        }),
        order: vi.fn((...args: unknown[]) => {
          order(...args);
          return builder;
        }),
        limit: vi.fn((...args: unknown[]) => {
          limit(...args);
          return builder;
        }),
        insert: vi.fn((payload: Record<string, unknown>) => {
          inserting = true;
          inserted.push(payload);
          return builder;
        }),
        maybeSingle: vi.fn(async () => {
          const row = script.conversations?.[conversationLookup] ?? null;
          conversationLookup++;
          return { data: row, error: null };
        }),
        single: vi.fn(async () => ({
          data: inserting && script.createdId ? { id: script.createdId } : null,
          error: inserting ? (script.createError ?? null) : null,
        })),
      };
      return builder;
    },
  } as unknown as SupabaseClient;

  return { db, inserted, filters, order, limit };
}

describe('resolveContactConversation', () => {
  it('rejects a missing or cross-account contact before conversation work', async () => {
    const { db } = makeDb({ contact: null });

    await expect(
      resolveContactConversation(db, 'account-1', 'user-1', 'contact-1')
    ).rejects.toMatchObject({
      status: 404,
      message: 'Contact not found',
    });
  });

  it('reuses the oldest existing account/contact conversation', async () => {
    const { db, inserted, filters, order, limit } = makeDb({
      contact: { id: 'contact-1' },
      conversations: [{ id: 'conversation-oldest' }],
    });

    await expect(
      resolveContactConversation(db, 'account-1', 'user-1', 'contact-1')
    ).resolves.toBe('conversation-oldest');

    expect(order).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(limit).toHaveBeenCalledWith(1);
    expect(filters).toEqual([
      { table: 'contacts', column: 'id', value: 'contact-1' },
      { table: 'contacts', column: 'account_id', value: 'account-1' },
      { table: 'conversations', column: 'account_id', value: 'account-1' },
      { table: 'conversations', column: 'contact_id', value: 'contact-1' },
    ]);
    expect(inserted).toHaveLength(0);
  });

  it('creates an account-scoped conversation with caller audit attribution', async () => {
    const { db, inserted } = makeDb({
      contact: { id: 'contact-1' },
      conversations: [null],
      createdId: 'conversation-new',
    });

    await expect(
      resolveContactConversation(db, 'account-1', 'user-1', 'contact-1')
    ).resolves.toBe('conversation-new');

    expect(inserted).toEqual([
      {
        account_id: 'account-1',
        user_id: 'user-1',
        contact_id: 'contact-1',
      },
    ]);
  });

  it('re-resolves the oldest winner after a unique insert race', async () => {
    const { db, inserted, order, limit } = makeDb({
      contact: { id: 'contact-1' },
      conversations: [null, { id: 'conversation-winner' }],
      createError: { code: '23505', message: 'duplicate key' },
    });

    await expect(
      resolveContactConversation(db, 'account-1', 'user-1', 'contact-1')
    ).resolves.toBe('conversation-winner');

    expect(inserted).toHaveLength(1);
    expect(order).toHaveBeenCalledTimes(2);
    expect(limit).toHaveBeenCalledTimes(2);
  });

  it('fails without accepting an empty insert or unresolved race result', async () => {
    const missingInsert = makeDb({
      contact: { id: 'contact-1' },
      conversations: [null],
      createdId: null,
    });
    await expect(
      resolveContactConversation(
        missingInsert.db,
        'account-1',
        'user-1',
        'contact-1'
      )
    ).rejects.toMatchObject({
      status: 500,
      message: 'Failed to open a conversation for this contact',
    });

    const unresolvedRace = makeDb({
      contact: { id: 'contact-1' },
      conversations: [null, null],
      createError: { code: '23505', message: 'duplicate key' },
    });
    await expect(
      resolveContactConversation(
        unresolvedRace.db,
        'account-1',
        'user-1',
        'contact-1'
      )
    ).rejects.toMatchObject({
      status: 500,
      message: 'Failed to open a conversation for this contact',
    });
  });
});
