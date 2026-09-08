'use client';

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';

export interface StaffMember {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
}

/**
 * Load the account's teammates for assignee pickers/labels. RLS on
 * profiles lets any member read rows in their own account, so this is
 * naturally account-scoped (same read the Members roster API does).
 */
type StaffSnapshot = {
  staff: StaffMember[];
  loading: boolean;
  error: Error | null;
};
type StaffCacheEntry = StaffSnapshot & {
  listeners: Set<() => void>;
  generation: number;
  version: number;
  request: Promise<void> | null;
};
const EMPTY_SNAPSHOT: StaffSnapshot = {
  staff: [],
  loading: false,
  error: null,
};
const staffCache = new Map<string, StaffCacheEntry>();

function cacheEntry(accountId: string) {
  let entry = staffCache.get(accountId);
  if (!entry) {
    entry = {
      ...EMPTY_SNAPSHOT,
      loading: true,
      listeners: new Set(),
      generation: 0,
      version: 0,
      request: null,
    };
    staffCache.set(accountId, entry);
  }
  return entry;
}
function notify(entry: StaffCacheEntry) {
  entry.version += 1;
  entry.listeners.forEach((listener) => listener());
}
async function loadStaff(accountId: string, force = false) {
  const entry = cacheEntry(accountId);
  if (entry.request && !force) return entry.request;
  const generation = ++entry.generation;
  entry.loading = true;
  entry.error = null;
  notify(entry);
  const request = (async () => {
    try {
      const { data, error } = await createClient()
        .from('profiles')
        .select('user_id, full_name, avatar_url')
        .eq('account_id', accountId)
        .order('full_name', { ascending: true });
      if (error) throw error;
      if (entry.generation !== generation) return;
      entry.staff = ((data as StaffMember[]) ?? []).map((staff) => ({
        user_id: staff.user_id,
        full_name: staff.full_name || 'Teammate',
        avatar_url: staff.avatar_url ?? null,
      }));
    } catch (error) {
      if (entry.generation !== generation) return;
      entry.error =
        error instanceof Error
          ? error
          : new Error('Teammates could not be loaded');
    } finally {
      if (entry.generation === generation) {
        entry.loading = false;
        entry.request = null;
        notify(entry);
      }
    }
  })();
  entry.request = request;
  return request;
}

/** Refresh shared branch staff after a profile or membership mutation. */
export function invalidateAccountStaff(accountId: string) {
  if (staffCache.has(accountId)) void loadStaff(accountId, true);
}

export function useAccountStaff() {
  const { accountId } = useAuth();
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!accountId) return () => {};
      const entry = cacheEntry(accountId);
      entry.listeners.add(listener);
      return () => entry.listeners.delete(listener);
    },
    [accountId]
  );
  const getSnapshot = useCallback(
    () => (accountId ? cacheEntry(accountId).version : 0),
    [accountId]
  );
  useSyncExternalStore(subscribe, getSnapshot, () => 0);
  const snapshot = accountId ? cacheEntry(accountId) : EMPTY_SNAPSHOT;
  useEffect(() => {
    if (accountId) void loadStaff(accountId);
  }, [accountId]);
  const refresh = useCallback(() => {
    if (accountId) void loadStaff(accountId, true);
  }, [accountId]);

  /** user_id → display name, for rendering assignee chips. */
  const nameById = useMemo(
    () => new Map(snapshot.staff.map((s) => [s.user_id, s.full_name])),
    [snapshot.staff]
  );

  /** user_id → avatar photo URL (null = no upload), for UserAvatar. */
  const avatarById = useMemo(
    () => new Map(snapshot.staff.map((s) => [s.user_id, s.avatar_url])),
    [snapshot.staff]
  );

  return {
    staff: snapshot.staff,
    nameById,
    avatarById,
    loading: snapshot.loading,
    error: snapshot.error,
    refresh,
  };
}
