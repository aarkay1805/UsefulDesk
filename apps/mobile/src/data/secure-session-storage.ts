import type { SupportedStorage } from '@supabase/supabase-js';

interface SecureStoreAdapter {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export function createSecureSessionStorage(
  adapter: SecureStoreAdapter
): SupportedStorage {
  return {
    getItem: (key) => adapter.getItemAsync(key),
    setItem: (key, value) => adapter.setItemAsync(key, value),
    removeItem: (key) => adapter.deleteItemAsync(key),
  };
}
