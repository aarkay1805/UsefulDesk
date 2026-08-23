import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  exportStorageBackup,
  listBucketObjects,
  restoreStorageBackup,
} from '../../../scripts/export-supabase-storage.mjs';

type ListedObject = {
  created_at: string | null;
  id: string | null;
  last_accessed_at: string | null;
  metadata: {
    cacheControl: string;
    contentLength: number;
    eTag: string;
    httpStatusCode: number;
    lastModified: string;
    mimetype: string;
    size: number;
  } | null;
  name: string;
  updated_at: string | null;
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
            {
              created_at: null,
              id: null,
              last_accessed_at: null,
              metadata: null,
              name: 'members',
              updated_at: null,
            },
            {
              created_at: '2026-08-23T00:00:00.000Z',
              id: 'root-object',
              last_accessed_at: '2026-08-23T00:00:00.000Z',
              metadata: {
                cacheControl: 'max-age=3600',
                contentLength: 8,
                eTag: 'root-etag',
                httpStatusCode: 200,
                lastModified: '2026-08-23T00:00:00.000Z',
                mimetype: 'text/plain',
                size: 8,
              },
              name: 'logo.txt',
              updated_at: '2026-08-23T00:00:00.000Z',
            },
          ],
          members: [
            {
              created_at: '2026-08-23T00:00:00.000Z',
              id: 'nested-object',
              last_accessed_at: '2026-08-23T00:00:00.000Z',
              metadata: {
                cacheControl: 'max-age=86400',
                contentLength: 12,
                eTag: 'nested-etag',
                httpStatusCode: 200,
                lastModified: '2026-08-23T00:00:00.000Z',
                mimetype: 'image/jpeg',
                size: 12,
              },
              name: 'member-1.txt',
              updated_at: '2026-08-23T00:00:00.000Z',
            },
          ],
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
          cache_control: 'max-age=3600',
          content_type: 'text/plain',
          path: 'logo.txt',
          sha256:
            'e82cbb3aa12a8d326c0b89025206c992c5b14803bbc0e0fde0c589e8fdd1573d',
        },
        {
          bucket: 'avatars',
          bytes: 12,
          cache_control: 'max-age=86400',
          content_type: 'image/jpeg',
          path: 'members/member-1.txt',
          sha256:
            '1770f2b51fcb331ec8c45f6c44708eead4057205b83980943328fa55ad0dd24f',
        },
      ],
      version: 2,
    });
    await expect(
      readFile(join(outputDirectory, 'manifest.json'), 'utf8')
    ).resolves.toBe(`${JSON.stringify(manifest, null, 2)}\n`);
  });

  it('paginates object listings without dropping the final page', async () => {
    const firstPage = Array.from({ length: 1_000 }, (_, index) => ({
      created_at: '2026-08-23T00:00:00.000Z',
      id: `object-${index}`,
      last_accessed_at: '2026-08-23T00:00:00.000Z',
      metadata: {
        cacheControl: 'max-age=3600',
        contentLength: 1,
        eTag: `etag-${index}`,
        httpStatusCode: 200,
        lastModified: '2026-08-23T00:00:00.000Z',
        mimetype: 'text/plain',
        size: 1,
      },
      name: `object-${index}.txt`,
      updated_at: '2026-08-23T00:00:00.000Z',
    }));
    const list = vi
      .fn()
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({
        data: [
          {
            created_at: '2026-08-23T00:00:00.000Z',
            id: 'object-1000',
            last_accessed_at: '2026-08-23T00:00:00.000Z',
            metadata: {
              cacheControl: 'max-age=3600',
              contentLength: 1,
              eTag: 'etag-1000',
              httpStatusCode: 200,
              lastModified: '2026-08-23T00:00:00.000Z',
              mimetype: 'text/plain',
              size: 1,
            },
            name: 'object-1000.txt',
            updated_at: '2026-08-23T00:00:00.000Z',
          },
        ],
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
          '': [
            {
              created_at: '2026-08-23T00:00:00.000Z',
              id: 'unsafe-object',
              last_accessed_at: '2026-08-23T00:00:00.000Z',
              metadata: {
                cacheControl: 'max-age=3600',
                contentLength: 19,
                eTag: 'unsafe-etag',
                httpStatusCode: 200,
                lastModified: '2026-08-23T00:00:00.000Z',
                mimetype: 'text/plain',
                size: 19,
              },
              name: unsafeObjectPath,
              updated_at: '2026-08-23T00:00:00.000Z',
            },
          ],
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

describe('Supabase Storage backup restore', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true }))
    );
  });

  it('rehydrates an object with its metadata and verifies the uploaded bytes', async () => {
    const inputDirectory = await mkdtemp(join(tmpdir(), 'storage-restore-'));
    temporaryDirectories.push(inputDirectory);
    const objectDirectory = join(inputDirectory, 'objects/avatars');
    await mkdir(objectDirectory, { recursive: true });
    await writeFile(join(objectDirectory, 'logo.txt'), 'gym logo');
    await writeFile(
      join(inputDirectory, 'manifest.json'),
      `${JSON.stringify(
        {
          generated_at: '2026-08-23T00:00:00.000Z',
          objects: [
            {
              bucket: 'avatars',
              bytes: 8,
              cache_control: 'max-age=86400',
              content_type: 'text/plain',
              path: 'logo.txt',
              sha256:
                'e82cbb3aa12a8d326c0b89025206c992c5b14803bbc0e0fde0c589e8fdd1573d',
            },
          ],
          version: 2,
        },
        null,
        2
      )}\n`
    );

    const restoredObjects = new Map<
      string,
      { bytes: Uint8Array; options: Record<string, unknown> }
    >();
    const supabase = {
      storage: {
        from(bucket: string) {
          return {
            async download(objectPath: string) {
              const restored = restoredObjects.get(`${bucket}/${objectPath}`);
              return restored
                ? {
                    data: new Blob([restored.bytes as BlobPart]),
                    error: null,
                  }
                : { data: null, error: new Error('missing restored object') };
            },
            async upload(
              objectPath: string,
              bytes: Uint8Array,
              options: Record<string, unknown>
            ) {
              restoredObjects.set(`${bucket}/${objectPath}`, {
                bytes,
                options,
              });
              return { data: { path: objectPath }, error: null };
            },
          };
        },
      },
    };

    const result = await restoreStorageBackup({
      inputDirectory,
      supabase,
    });

    expect(result).toEqual({ objects: 1, totalBytes: 8 });
    expect(restoredObjects.get('avatars/logo.txt')).toEqual({
      bytes: new Uint8Array(Buffer.from('gym logo')),
      options: {
        cacheControl: '86400',
        contentType: 'text/plain',
        upsert: true,
      },
    });
  });

  it('fails closed before connecting when restore credentials are absent', () => {
    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), 'scripts/restore-supabase-storage.mjs'), '/tmp'],
      {
        encoding: 'utf8',
        env: {
          NODE_ENV: 'test',
          PATH: process.env.PATH,
        },
      }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Usage: RESTORE_SUPABASE_URL=... RESTORE_SUPABASE_SERVICE_ROLE_KEY=...'
    );
  });
});
