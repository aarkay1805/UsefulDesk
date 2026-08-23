#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createClient } from '@supabase/supabase-js';

export const STORAGE_BACKUP_BUCKETS = [
  'avatars',
  'chat-media',
  'flow-media',
  'payment-receipts',
];

const LIST_PAGE_SIZE = 1_000;

function assertSafeRelativePath(candidate) {
  const segments = candidate.split('/');
  const unsafe =
    candidate.length === 0 ||
    candidate.includes('\\') ||
    candidate.includes('\0') ||
    isAbsolute(candidate) ||
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..'
    );

  if (unsafe) {
    throw new Error('Unsafe Supabase Storage object path');
  }
}

function destinationFor(outputDirectory, bucket, objectPath) {
  assertSafeRelativePath(bucket);
  assertSafeRelativePath(objectPath);

  const objectRoot = resolve(outputDirectory, 'objects');
  const destination = resolve(objectRoot, bucket, ...objectPath.split('/'));
  const relativeDestination = relative(objectRoot, destination);
  if (relativeDestination.startsWith('..') || isAbsolute(relativeDestination)) {
    throw new Error('Unsafe Supabase Storage object path');
  }

  return destination;
}

export async function listBucketObjects(bucketClient, bucket) {
  const objectPaths = [];

  async function listPrefix(prefix) {
    let offset = 0;

    while (true) {
      const { data, error } = await bucketClient.list(prefix, {
        limit: LIST_PAGE_SIZE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });

      if (error) {
        throw new Error(`Could not list Supabase Storage bucket ${bucket}`, {
          cause: error,
        });
      }

      const entries = data ?? [];
      for (const entry of entries) {
        const objectPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        assertSafeRelativePath(objectPath);

        if (entry.id === null) {
          await listPrefix(objectPath);
        } else {
          objectPaths.push(objectPath);
        }
      }

      if (entries.length < LIST_PAGE_SIZE) {
        break;
      }
      offset += LIST_PAGE_SIZE;
    }
  }

  await listPrefix('');
  return objectPaths.sort((left, right) => left.localeCompare(right));
}

export async function exportStorageBackup({
  buckets = STORAGE_BACKUP_BUCKETS,
  generatedAt = new Date().toISOString(),
  outputDirectory,
  supabase,
}) {
  if (!outputDirectory) {
    throw new Error('A Storage backup output directory is required');
  }

  const manifest = {
    generated_at: generatedAt,
    objects: [],
    version: 1,
  };

  for (const bucket of buckets) {
    assertSafeRelativePath(bucket);
    const bucketClient = supabase.storage.from(bucket);
    const objectPaths = await listBucketObjects(bucketClient, bucket);

    for (const objectPath of objectPaths) {
      const { data, error } = await bucketClient.download(objectPath);
      if (error || !data) {
        throw new Error(`Could not download an object from bucket ${bucket}`, {
          cause: error ?? undefined,
        });
      }

      const contents = Buffer.from(await data.arrayBuffer());
      const destination = destinationFor(outputDirectory, bucket, objectPath);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, contents);

      manifest.objects.push({
        bucket,
        bytes: contents.byteLength,
        path: objectPath,
        sha256: createHash('sha256').update(contents).digest('hex'),
      });
    }
  }

  manifest.objects.sort((left, right) =>
    `${left.bucket}/${left.path}`.localeCompare(`${right.bucket}/${right.path}`)
  );
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    join(outputDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  return manifest;
}

async function main() {
  const outputDirectory = process.argv[2];
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!outputDirectory || !supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Usage: NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/export-supabase-storage.mjs <output-directory>'
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const manifest = await exportStorageBackup({ outputDirectory, supabase });
  const totalBytes = manifest.objects.reduce(
    (sum, object) => sum + object.bytes,
    0
  );
  console.info(
    `Exported ${manifest.objects.length} Storage objects (${totalBytes} bytes) across ${STORAGE_BACKUP_BUCKETS.length} buckets.`
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'Storage export failed'
    );
    process.exitCode = 1;
  });
}
