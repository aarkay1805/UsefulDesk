import {
  MOBILE_AUTH_STORAGE_KEY,
  type SecureSessionStorage,
} from './secure-session-storage';
import { createClient } from '@supabase/supabase-js';
import {
  mobileAuthRefreshCoordinator,
  mobileSessionStorage,
  mobileSupabase,
  selectedBranchRef,
} from './supabase';
import { AUTH_QUIESCENCE_TIMEOUT_MS } from './auth-refresh-coordinator';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: {} })),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

describe('mobile Supabase singleton', () => {
  it('eagerly creates one client with the explicit revocable storage contract', () => {
    const mockCreateClient = jest.mocked(createClient);
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    expect(mockCreateClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'test-anon-key',
      expect.objectContaining({
        auth: expect.objectContaining({
          storage: mobileSessionStorage,
          storageKey: MOBILE_AUTH_STORAGE_KEY,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
          flowType: 'pkce',
          lock: mobileAuthRefreshCoordinator.lock,
          lockAcquireTimeout: AUTH_QUIESCENCE_TIMEOUT_MS,
        }),
        global: { fetch: mobileAuthRefreshCoordinator.fetch },
      })
    );
    expect(mobileSupabase).toBe(mockCreateClient.mock.results[0].value);
    expect(typeof (mobileSessionStorage as SecureSessionStorage).purge).toBe(
      'function'
    );
  });

  it('keeps one mutable selected-branch reference for request publication', () => {
    selectedBranchRef.set(null);
    expect(selectedBranchRef.get()).toBeNull();
    selectedBranchRef.set('d3648c54-a4aa-4dd8-8566-1e3b38c1f497');
    expect(selectedBranchRef.get()).toBe(
      'd3648c54-a4aa-4dd8-8566-1e3b38c1f497'
    );
  });
});
