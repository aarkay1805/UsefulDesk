'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import type { MessageTemplate } from '@/types';

type TemplateSnapshot = {
  templates: MessageTemplate[];
  loading: boolean;
};

type TemplateCacheEntry = TemplateSnapshot & {
  listeners: Set<() => void>;
  generation: number;
  version: number;
  request: Promise<void> | null;
};

const EMPTY_SNAPSHOT: TemplateSnapshot = { templates: [], loading: false };
const templateCache = new Map<string, TemplateCacheEntry>();

function cacheEntry(accountId: string): TemplateCacheEntry {
  let entry = templateCache.get(accountId);
  if (!entry) {
    entry = {
      ...EMPTY_SNAPSHOT,
      loading: true,
      listeners: new Set(),
      generation: 0,
      version: 0,
      request: null,
    };
    templateCache.set(accountId, entry);
  }
  return entry;
}

function notify(entry: TemplateCacheEntry) {
  entry.version += 1;
  entry.listeners.forEach((listener) => listener());
}

async function loadApprovedTemplates(accountId: string, force = false) {
  const entry = cacheEntry(accountId);
  if (entry.request && !force) return entry.request;
  if (!force && entry.version > 0 && !entry.loading) return;

  const generation = ++entry.generation;
  entry.loading = true;
  notify(entry);
  const request = (async () => {
    try {
      // The established branch context is only a UI precondition. RLS still
      // authorizes the read, while this explicit account predicate keeps the
      // browser result aligned with the selected branch.
      const { data, error } = await createClient()
        .from('message_templates')
        .select('*')
        .eq('account_id', accountId)
        .eq('status', 'APPROVED')
        .order('created_at', { ascending: false });
      if (error) throw error;
      if (entry.generation !== generation) return;
      entry.templates = (data as MessageTemplate[] | null) ?? [];
    } catch (error) {
      if (entry.generation !== generation) return;
      console.error('Failed to fetch approved templates:', error);
      entry.templates = [];
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

/** Revalidate approved templates after a branch-local template mutation. */
export function invalidateApprovedMessageTemplates(accountId: string) {
  if (templateCache.has(accountId)) void loadApprovedTemplates(accountId, true);
}

/**
 * Shared, browser-lifetime approved-template result for the selected branch.
 * Data authorization remains at the RLS-protected query and the send route.
 */
export function useApprovedMessageTemplates(enabled: boolean) {
  const { accountId, profileLoading } = useAuth();
  const ready = enabled && !profileLoading && !!accountId;
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!ready || !accountId) return () => {};
      const entry = cacheEntry(accountId);
      entry.listeners.add(listener);
      return () => entry.listeners.delete(listener);
    },
    [accountId, ready]
  );
  const getSnapshot = useCallback(
    () => (ready && accountId ? cacheEntry(accountId).version : 0),
    [accountId, ready]
  );
  useSyncExternalStore(subscribe, getSnapshot, () => 0);

  useEffect(() => {
    if (ready && accountId) void loadApprovedTemplates(accountId);
  }, [accountId, ready]);

  const snapshot = ready && accountId ? cacheEntry(accountId) : EMPTY_SNAPSHOT;
  return {
    templates: snapshot.templates,
    loading: ready ? snapshot.loading : false,
  };
}
