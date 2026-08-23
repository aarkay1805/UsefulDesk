import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  exportStorageBackup,
  listBucketObjects,
} from '../../../scripts/export-supabase-storage.mjs';

type ListedObject = {
  id: string | null;
  name: string;
};

type BucketFixture = Record<string, ListedObject[]>;

function createStorageClient(
  fixtures: Record<string, BucketFixture>,
  downloads: Record<string, string>
) {
  return {
    storage: {
      from(bucket: string) {
        return {
          async list(
            prefix: string,
            options: { limit: number; offset: number }
          ) {
            const items = fixtures[bucket]?.[prefix] ?? [];
            return {
              data: items.slice(options.offset, options.offset + options.limit),
              error: null,
            };
          },
          async download(objectPath: string) {
            const content = downloads[`${bucket}/${objectPath}`];
            return content === undefined
              ? { data: null, error: new Error('missing fixture') }
              : { data: new Blob([content]), error: null };
          },
        };
      },
    },
  };
}

describe('Supabase Storage backup export', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true }))
    );
  });

  it('exports nested objects and writes a stable checksum manifest', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'storage-backup-'));
    temporaryDirectories.push(outputDirectory);

    const client = createStorageClient(
      {
        avatars: {
          '': [
            { id: null, name: 'members' },
            { id: 'root-object', name: 'logo.txt' },
          ],
          members: [{ id: 'nested-object', name: 'member-1.txt' }],
        },
      },
      {
        'avatars/logo.txt': 'gym logo',
        'avatars/members/member-1.txt': 'member photo',
      }
    );

    const manifest = await exportStorageBackup({
      buckets: ['avatars'],
      generatedAt: '2026-08-23T00:00:00.000Z',
      outputDirectory,
      supabase: client,
    });

    await expect(
      readFile(join(outputDirectory, 'objects/avatars/logo.txt'), 'utf8')
    ).resolves.toBe('gym logo');
    await expect(
      readFile(
        join(outputDirectory, 'objects/avatars/members/member-1.txt'),
        'utf8'
      )
    ).resolves.toBe('member photo');
    expect(manifest).toEqual({
      generated_at: '2026-08-23T00:00:00.000Z',
      objects: [
        {
          bucket: 'avatars',
          bytes: 8,
          path: 'logo.txt',
          sha256:
            'e82cbb3aa12a8d326c0b89025206c992c5b14803bbc0e0fde0c589e8fdd1573d',
        },
        {
          bucket: 'avatars',
          bytes: 12,
          path: 'members/member-1.txt',
          sha256:
            '1770f2b51fcb331ec8c45f6c44708eead4057205b83980943328fa55ad0dd24f',
        },
      ],
      version: 1,
    });
    await expect(
      readFile(join(outputDirectory, 'manifest.json'), 'utf8')
    ).resolves.toBe(`${JSON.stringify(manifest, null, 2)}\n`);
  });

  it('paginates object listings without dropping the final page', async () => {
    const firstPage = Array.from({ length: 1_000 }, (_, index) => ({
      id: `object-${index}`,
      name: `object-${index}.txt`,
    }));
    const list = vi
      .fn()
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({
        data: [{ id: 'object-1000', name: 'object-1000.txt' }],
        error: null,
      });

    const paths = await listBucketObjects({ list }, 'avatars');

    expect(paths).toHaveLength(1_001);
    expect(paths).toContain('object-1000.txt');
    expect(list).toHaveBeenNthCalledWith(
      2,
      '',
      expect.objectContaining({ limit: 1_000, offset: 1_000 })
    );
  });

  it('rejects unsafe object paths before writing outside the export root', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'storage-backup-'));
    temporaryDirectories.push(outputDirectory);
    const escapedName = `${basename(outputDirectory)}-escaped.txt`;
    const unsafeObjectPath = `../${escapedName}`;
    const client = createStorageClient(
      {
        avatars: {
          '': [{ id: 'unsafe-object', name: unsafeObjectPath }],
        },
      },
      { [`avatars/${unsafeObjectPath}`]: 'must not be written' }
    );

    await expect(
      exportStorageBackup({
        buckets: ['avatars'],
        outputDirectory,
        supabase: client,
      })
    ).rejects.toThrow('Unsafe Supabase Storage object path');
    await expect(
      stat(join(outputDirectory, '..', escapedName))
    ).rejects.toThrow();
  });
});
