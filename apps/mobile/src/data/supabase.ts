import 'react-native-url-polyfill/auto';

import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';

import { createBranchAwareFetch } from './branch-aware-fetch';
import {
  AUTH_QUIESCENCE_TIMEOUT_MS,
  createAuthRefreshCoordinator,
} from './auth-refresh-coordinator';
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
export const mobileAuthRefreshCoordinator = createAuthRefreshCoordinator(
  createBranchAwareFetch(fetch, () => selectedBranchRef.get()),
  mobileEnvironment.supabaseUrl
);

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
      lock: mobileAuthRefreshCoordinator.lock,
      lockAcquireTimeout: AUTH_QUIESCENCE_TIMEOUT_MS,
    },
    global: {
      fetch: mobileAuthRefreshCoordinator.fetch,
    },
  }
);
