import { describe, expect, it } from 'vitest';

import {
  collectStorageObjectRefs,
  storageObjectRefFromUrl,
} from './organization-erasure';

const SUPABASE_URL = 'https://project-ref.supabase.co';

describe('organization erasure storage references', () => {
  it('extracts public and signed Storage object URLs from this project', () => {
    expect(
      storageObjectRefFromUrl(
        `${SUPABASE_URL}/storage/v1/object/public/avatars/user-1/member.webp`,
        SUPABASE_URL
      )
    ).toEqual({ bucket: 'avatars', path: 'user-1/member.webp' });

    expect(
      storageObjectRefFromUrl(
        `${SUPABASE_URL}/storage/v1/object/sign/payment-receipts/account-1/receipt.pdf?token=x`,
        SUPABASE_URL
      )
    ).toEqual({
      bucket: 'payment-receipts',
      path: 'account-1/receipt.pdf',
    });
  });

  it('ignores external URLs and unknown buckets', () => {
    expect(
      storageObjectRefFromUrl(
        'https://cdn.example.com/storage/v1/object/public/avatars/a.webp',
        SUPABASE_URL
      )
    ).toBeNull();
    expect(
      storageObjectRefFromUrl(
        `${SUPABASE_URL}/storage/v1/object/public/unmanaged/a.webp`,
        SUPABASE_URL
      )
    ).toBeNull();
  });

  it('collects nested legacy media references without treating plain text as paths', () => {
    const refs = collectStorageObjectRefs(
      {
        branches: [
          {
            config: {
              media_url: `${SUPABASE_URL}/storage/v1/object/public/flow-media/user-1/file.pdf`,
            },
          },
        ],
        note: 'account-1/not-an-object',
      },
      SUPABASE_URL
    );

    expect(refs).toEqual([{ bucket: 'flow-media', path: 'user-1/file.pdf' }]);
  });
});
