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
  allowWrites(): void;
  purge(): Promise<{ status: 'success' } | { status: 'failed' }>;
}

export function createSecureSessionStorage(
  adapter: SecureStoreAdapter
): SecureSessionStorage {
  let writesAllowed = true;
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
        ? enqueue(() => adapter.getItemAsync(key))
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
    removeItem: (key) => enqueue(() => adapter.deleteItemAsync(key)),
    allowWrites() {
      generation += 1;
      writesAllowed = true;
    },
    purge() {
      generation += 1;
      writesAllowed = false;
      return enqueue(async () => {
        const removals = await Promise.allSettled(
          MOBILE_AUTH_STORAGE_KEYS.map((key) => adapter.deleteItemAsync(key))
        );
        return removals.every((result) => result.status === 'fulfilled')
          ? { status: 'success' as const }
          : { status: 'failed' as const };
      });
    },
  };
}
