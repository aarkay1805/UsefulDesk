#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

async function listBucketObjectEntries(bucketClient, bucket) {
  const objects = [];

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
          objects.push({
            cacheControl: entry.metadata?.cacheControl ?? null,
            contentType: entry.metadata?.mimetype ?? null,
            path: objectPath,
          });
        }
      }

      if (entries.length < LIST_PAGE_SIZE) {
        break;
      }
      offset += LIST_PAGE_SIZE;
    }
  }

  await listPrefix('');
  return objects.sort((left, right) => left.path.localeCompare(right.path));
}

export async function listBucketObjects(bucketClient, bucket) {
  const objects = await listBucketObjectEntries(bucketClient, bucket);
  return objects.map((object) => object.path);
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
    version: 2,
  };

  for (const bucket of buckets) {
    assertSafeRelativePath(bucket);
    const bucketClient = supabase.storage.from(bucket);
    const objects = await listBucketObjectEntries(bucketClient, bucket);

    for (const object of objects) {
      const objectPath = object.path;
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
        cache_control: object.cacheControl,
        content_type: object.contentType ?? data.type ?? null,
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

function cacheControlForUpload(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return '3600';
  }

  const maxAge = value.match(/(?:^|,)\s*max-age=(\d+)(?:,|$)/i);
  return maxAge?.[1] ?? value;
}

export async function restoreStorageBackup({ inputDirectory, supabase }) {
  if (!inputDirectory) {
    throw new Error('A Storage backup input directory is required');
  }

  const manifest = JSON.parse(
    await readFile(join(inputDirectory, 'manifest.json'), 'utf8')
  );
  if (![1, 2].includes(manifest.version) || !Array.isArray(manifest.objects)) {
    throw new Error('Unsupported Supabase Storage backup manifest');
  }

  let totalBytes = 0;
  for (const object of manifest.objects) {
    assertSafeRelativePath(object.bucket);
    assertSafeRelativePath(object.path);

    const contents = await readFile(
      destinationFor(inputDirectory, object.bucket, object.path)
    );
    const checksum = createHash('sha256').update(contents).digest('hex');
    if (contents.byteLength !== object.bytes || checksum !== object.sha256) {
      throw new Error(
        `Supabase Storage backup object failed verification: ${object.bucket}/${object.path}`
      );
    }

    const bucketClient = supabase.storage.from(object.bucket);
    const { error: uploadError } = await bucketClient.upload(
      object.path,
      new Uint8Array(contents),
      {
        cacheControl: cacheControlForUpload(object.cache_control),
        contentType: object.content_type ?? 'application/octet-stream',
        upsert: true,
      }
    );
    if (uploadError) {
      throw new Error(
        `Could not restore Supabase Storage object ${object.bucket}/${object.path}`,
        { cause: uploadError }
      );
    }

    const { data: restoredData, error: downloadError } =
      await bucketClient.download(object.path);
    if (downloadError || !restoredData) {
      throw new Error(
        `Could not verify restored Supabase Storage object ${object.bucket}/${object.path}`,
        { cause: downloadError ?? undefined }
      );
    }

    const restoredContents = Buffer.from(await restoredData.arrayBuffer());
    const restoredChecksum = createHash('sha256')
      .update(restoredContents)
      .digest('hex');
    if (
      restoredContents.byteLength !== object.bytes ||
      restoredChecksum !== object.sha256
    ) {
      throw new Error(
        `Restored Supabase Storage object failed verification: ${object.bucket}/${object.path}`
      );
    }

    totalBytes += contents.byteLength;
  }

  return { objects: manifest.objects.length, totalBytes };
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
