import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({
  resolveTags: vi.fn(),
  addAndDispatch: vi.fn(),
}));

vi.mock('@/lib/contacts/resolve-import-tags', () => ({
  resolveImportTagIds: mocks.resolveTags,
}));

vi.mock('@/lib/contacts/tag-events', () => ({
  addContactTagAndDispatch: mocks.addAndDispatch,
}));

import { addContactTags, setContactTags } from './contacts';

function fakeDb(currentTagIds: string[] = []) {
  const deleted: string[][] = [];
  const db = {
    from(table: string) {
      if (table !== 'contact_tags')
        throw new Error(`unexpected table ${table}`);
      const state = { operation: 'select', ids: [] as string[] };
      const result = () =>
        state.operation === 'select'
          ? {
              data: currentTagIds.map((tag_id) => ({ tag_id })),
              error: null,
            }
          : { data: null, error: null };
      const builder = {
        select() {
          return builder;
        },
        delete() {
          state.operation = 'delete';
          return builder;
        },
        eq() {
          return builder;
        },
        in(_column: string, ids: string[]) {
          state.ids = ids;
          deleted.push(ids);
          return builder;
        },
        then(
          onFulfilled: (value: ReturnType<typeof result>) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) {
          return Promise.resolve(result()).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { db, deleted };
}

beforeEach(() => {
  mocks.resolveTags.mockReset();
  mocks.addAndDispatch.mockReset();
  mocks.addAndDispatch.mockResolvedValue({ added: true, dispatched: true });
});

describe('contact tag dispatch integrations', () => {
  it('dispatches capture tags once and ignores unrelated resolved tags', async () => {
    mocks.resolveTags.mockResolvedValue({
      tagIdByKey: new Map([
        ['trial', 'tag-trial'],
        ['unrelated', 'tag-unrelated'],
      ]),
      skippedNames: [],
    });
    const { db } = fakeDb();

    await addContactTags(db, 'account-1', 'user-1', 'contact-1', [
      'Trial',
      ' trial ',
    ]);

    expect(mocks.addAndDispatch).toHaveBeenCalledTimes(1);
    expect(mocks.addAndDispatch).toHaveBeenCalledWith({
      db,
      accountId: 'account-1',
      contactId: 'contact-1',
      tagId: 'tag-trial',
    });
  });

  it('replaces API tags by diff and dispatches only genuinely new requested tags', async () => {
    mocks.resolveTags.mockResolvedValue({
      tagIdByKey: new Map([
        ['keep', 'tag-keep'],
        ['new', 'tag-new'],
        ['unrelated', 'tag-unrelated'],
      ]),
      skippedNames: [],
    });
    const { db, deleted } = fakeDb(['tag-keep', 'tag-old']);

    await setContactTags(db, 'account-1', 'user-1', 'contact-1', [
      'Keep',
      'New',
    ]);

    expect(deleted).toEqual([['tag-old']]);
    expect(mocks.addAndDispatch).toHaveBeenCalledTimes(1);
    expect(mocks.addAndDispatch).toHaveBeenCalledWith({
      db,
      accountId: 'account-1',
      contactId: 'contact-1',
      tagId: 'tag-new',
    });
  });
});
