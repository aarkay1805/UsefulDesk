import { describe, expect, it, vi } from 'vitest';

import { cleanupExpiredMemberImportDrafts } from './import-draft-admin';

describe('expired member import draft cleanup', () => {
  it('treats a missing object as success and deletes metadata afterwards', async () => {
    const events: string[] = [];
    const builder: Record<string, unknown> = {};
    builder.delete = vi.fn(() => {
      events.push('delete-row');
      return builder;
    });
    builder.eq = vi.fn(() => builder);
    builder.select = vi.fn(async () => ({
      data: [{ id: 'draft-1' }],
      error: null,
    }));
    const client = {
      rpc: vi.fn(async () => ({
        data: [
          {
            id: 'draft-1',
            object_path: 'account/author/draft/file.csv',
          },
        ],
        error: null,
      })),
      storage: {
        from: () => ({
          remove: vi.fn(async () => {
            events.push('remove-object');
            return { data: null, error: { message: 'Object not found' } };
          }),
        }),
      },
      from: () => builder,
    };

    await expect(
      cleanupExpiredMemberImportDrafts(client as never)
    ).resolves.toEqual({ claimed: 1, deleted: 1, failed: 0 });
    expect(events).toEqual(['remove-object', 'delete-row']);
  });
});
