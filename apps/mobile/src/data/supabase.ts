import 'react-native-url-polyfill/auto';

import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';

import { createBranchAwareFetch } from './branch-aware-fetch';
import { mobileEnvironment } from '../core/env';
import {
  createSecureSessionStorage,
  MOBILE_AUTH_STORAGE_KEY,
} from './secure-session-storage';

export interface SelectedBranchRef {
  get(): string | null;
  set(id: string | null): void;
}

let selectedBranchId: string | null = null;

export const selectedBranchRef: SelectedBranchRef = {
  get: () => selectedBranchId,
  set: (id) => {
    selectedBranchId = id;
  },
};

export const mobileSessionStorage = createSecureSessionStorage(SecureStore);

export const mobileSupabase = createClient(
  mobileEnvironment.supabaseUrl,
  mobileEnvironment.supabaseAnonKey,
  {
    auth: {
      storage: mobileSessionStorage,
      storageKey: MOBILE_AUTH_STORAGE_KEY,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
    global: {
      fetch: createBranchAwareFetch(fetch, () => selectedBranchRef.get()),
    },
  }
);
