import type { SupportedStorage } from '@supabase/supabase-js';

export const MOBILE_AUTH_STORAGE_KEY = 'usefuldesk.mobile.supabase.auth';
export const MOBILE_AUTH_STORAGE_KEYS = [
  MOBILE_AUTH_STORAGE_KEY,
  `${MOBILE_AUTH_STORAGE_KEY}-code-verifier`,
  `${MOBILE_AUTH_STORAGE_KEY}-user`,
] as const;

export interface SecureStoreAdapter {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface SecureSessionStorage extends SupportedStorage {
  allowWrites(): boolean;
  purge(): Promise<{ status: 'success' } | { status: 'failed' }>;
}

const CLEARED_AUTH_VALUE = 'null';

function isOwnedAuthKey(key: string): boolean {
  return MOBILE_AUTH_STORAGE_KEYS.some((ownedKey) => ownedKey === key);
}

export function createSecureSessionStorage(
  adapter: SecureStoreAdapter
): SecureSessionStorage {
  let writesAllowed = true;
  let cleanupVerified = true;
  let generation = 0;
  let operationTail = Promise.resolve();

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operationTail.then(operation, operation);
    operationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

  return {
    getItem: (key) =>
      writesAllowed
        ? enqueue(async () => {
            const value = await adapter.getItemAsync(key);
            return isOwnedAuthKey(key) && value === CLEARED_AUTH_VALUE
              ? null
              : value;
          })
        : Promise.resolve(null),
    setItem: (key, value) => {
      const writeGeneration = generation;
      if (!writesAllowed) return Promise.resolve();
      return enqueue(async () => {
        if (!writesAllowed || writeGeneration !== generation) return;
        await adapter.setItemAsync(key, value);
        if (!writesAllowed || writeGeneration !== generation) {
          await adapter.deleteItemAsync(key);
        }
      });
    },
    removeItem: (key) => {
      const removalGeneration = generation;
      if (!writesAllowed && isOwnedAuthKey(key)) return Promise.resolve();
      return enqueue(async () => {
        if (removalGeneration !== generation) return;
        await adapter.deleteItemAsync(key);
      });
    },
    allowWrites() {
      if (!cleanupVerified) return false;
      generation += 1;
      writesAllowed = true;
      return true;
    },
    purge() {
      generation += 1;
      writesAllowed = false;
      cleanupVerified = false;
      return enqueue(async () => {
        const removals = await Promise.all(
          MOBILE_AUTH_STORAGE_KEYS.map(async (key) => {
            try {
              await adapter.deleteItemAsync(key);
            } catch {
              // A verified absence or tombstone is still a durable cleanup.
            }

            try {
              if ((await adapter.getItemAsync(key)) === null) return true;
            } catch {
              // Fall through to the durable overwrite path.
            }

            try {
              await adapter.setItemAsync(key, CLEARED_AUTH_VALUE);
            } catch {
              return false;
            }

            try {
              const value = await adapter.getItemAsync(key);
              return value === null || value === CLEARED_AUTH_VALUE;
            } catch {
              return false;
            }
          })
        );
        cleanupVerified = removals.every(Boolean);
        return cleanupVerified
          ? { status: 'success' as const }
          : { status: 'failed' as const };
      });
    },
  };
}
