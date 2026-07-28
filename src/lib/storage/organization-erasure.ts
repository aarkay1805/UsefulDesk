import type { SupabaseClient } from '@supabase/supabase-js';

export const ORGANIZATION_ACCOUNT_MEDIA_BUCKETS = [
  'chat-media',
  'flow-media',
  'payment-receipts',
  'expense-receipts',
] as const;

const USER_SCOPED_MEDIA_BUCKETS = ['avatars', 'flow-media'] as const;
const KNOWN_MEDIA_BUCKETS = new Set<string>([
  ...ORGANIZATION_ACCOUNT_MEDIA_BUCKETS,
  ...USER_SCOPED_MEDIA_BUCKETS,
]);

export interface StorageObjectRef {
  bucket: string;
  path: string;
}

export function storageObjectRefFromUrl(
  value: string,
  supabaseUrl: string
): StorageObjectRef | null {
  try {
    const url = new URL(value);
    if (url.origin !== new URL(supabaseUrl).origin) return null;

    const marker = '/storage/v1/object/';
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex < 0) return null;

    const remainder = url.pathname.slice(markerIndex + marker.length);
    const segments = remainder.split('/').filter(Boolean);
    if (segments[0] === 'public' || segments[0] === 'sign') {
      segments.shift();
    }

    const bucket = segments.shift();
    if (!bucket || !KNOWN_MEDIA_BUCKETS.has(bucket) || segments.length === 0) {
      return null;
    }

    return {
      bucket,
      path: segments.map((segment) => decodeURIComponent(segment)).join('/'),
    };
  } catch {
    return null;
  }
}

export function collectStorageObjectRefs(
  value: unknown,
  supabaseUrl: string,
  refs: StorageObjectRef[] = []
): StorageObjectRef[] {
  if (typeof value === 'string') {
    const ref = storageObjectRefFromUrl(value, supabaseUrl);
    if (ref) refs.push(ref);
    return refs;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStorageObjectRefs(item, supabaseUrl, refs);
    }
    return refs;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectStorageObjectRefs(item, supabaseUrl, refs);
    }
  }
  return refs;
}

async function removePaths(
  admin: SupabaseClient,
  bucket: string,
  paths: string[]
): Promise<number> {
  let removed = 0;
  for (let start = 0; start < paths.length; start += 1000) {
    const batch = paths.slice(start, start + 1000);
    const { error } = await admin.storage.from(bucket).remove(batch);
    if (error) {
      throw new Error(`Could not purge ${bucket} storage: ${error.message}`);
    }
    removed += batch.length;
  }
  return removed;
}

async function purgeFolder(
  admin: SupabaseClient,
  bucket: string,
  folder: string
): Promise<number> {
  let removed = 0;

  while (true) {
    const { data, error } = await admin.storage
      .from(bucket)
      .list(folder, { limit: 1000, offset: 0 });
    if (error) {
      throw new Error(`Could not list ${bucket}/${folder}: ${error.message}`);
    }
    if (!data || data.length === 0) return removed;

    const files: string[] = [];
    const folders: string[] = [];
    for (const entry of data) {
      const path = `${folder}/${entry.name}`;
      if (entry.id) files.push(path);
      else folders.push(path);
    }

    for (const nested of folders) {
      removed += await purgeFolder(admin, bucket, nested);
    }
    if (files.length > 0) {
      removed += await removePaths(admin, bucket, files);
    }
  }
}

export async function purgeOrganizationStorage(
  admin: SupabaseClient,
  accountIds: string[],
  orphanUserIds: string[],
  exactRefs: StorageObjectRef[]
): Promise<number> {
  let removed = 0;
  const purgedPrefixes = new Set<string>();

  for (const accountId of accountIds) {
    const folder = `account-${accountId}`;
    for (const bucket of ORGANIZATION_ACCOUNT_MEDIA_BUCKETS) {
      removed += await purgeFolder(admin, bucket, folder);
      purgedPrefixes.add(`${bucket}/${folder}/`);
    }
  }

  for (const userId of orphanUserIds) {
    for (const bucket of USER_SCOPED_MEDIA_BUCKETS) {
      removed += await purgeFolder(admin, bucket, userId);
      purgedPrefixes.add(`${bucket}/${userId}/`);
    }
  }

  const uniqueRefs = new Map<string, StorageObjectRef>();
  for (const ref of exactRefs) {
    const key = `${ref.bucket}/${ref.path}`;
    if ([...purgedPrefixes].some((prefix) => key.startsWith(prefix))) continue;
    uniqueRefs.set(key, ref);
  }

  const refsByBucket = new Map<string, string[]>();
  for (const ref of uniqueRefs.values()) {
    const paths = refsByBucket.get(ref.bucket) ?? [];
    paths.push(ref.path);
    refsByBucket.set(ref.bucket, paths);
  }
  for (const [bucket, paths] of refsByBucket) {
    removed += await removePaths(admin, bucket, paths);
  }

  return removed;
}
