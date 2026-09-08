'use client';

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import type { MembershipPlan } from '@/types';

/**
 * Load the account's membership plans (RLS scopes to the caller's
 * account). `activeOnly` (the default) hides archived plans — used by
 * the add-member / renew pickers so a retired plan can't be chosen for
 * a new period, while a detail view can pass false to still resolve the
 * name of an archived plan a member is already on.
 */
type PlansSnapshot = {
  plans: MembershipPlan[];
  loading: boolean;
  error: Error | null;
};
type PlanCacheEntry = PlansSnapshot & {
  listeners: Set<() => void>;
  generation: number;
  version: number;
  request: Promise<void> | null;
};

const EMPTY_SNAPSHOT: PlansSnapshot = {
  plans: [],
  loading: false,
  error: null,
};
const planCache = new Map<string, PlanCacheEntry>();

function cacheEntry(accountId: string) {
  let entry = planCache.get(accountId);
  if (!entry) {
    entry = {
      ...EMPTY_SNAPSHOT,
      loading: true,
      listeners: new Set(),
      generation: 0,
      version: 0,
      request: null,
    };
    planCache.set(accountId, entry);
  }
  return entry;
}
function notify(entry: PlanCacheEntry) {
  entry.version += 1;
  entry.listeners.forEach((listener) => listener());
}
async function loadPlans(accountId: string, force = false) {
  const entry = cacheEntry(accountId);
  if (entry.request && !force) return entry.request;
  const generation = ++entry.generation;
  entry.loading = true;
  entry.error = null;
  notify(entry);
  const request = (async () => {
    try {
      // The query and browser-lifetime cache are both keyed to the active
      // branch, so a branch switch cannot expose another catalogue.
      const { data, error } = await createClient()
        .from('membership_plans')
        .select('*, pricing_options:plan_pricing_options(*)')
        .eq('account_id', accountId)
        .order('name', { ascending: true });
      if (error) throw error;
      if (entry.generation !== generation) return;
      entry.plans = ((data as MembershipPlan[]) ?? []).map((plan) => ({
        ...plan,
        pricing_options: (plan.pricing_options ?? [])
          .slice()
          .sort(
            (a, b) =>
              a.sort_order - b.sort_order ||
              a.created_at.localeCompare(b.created_at)
          ),
      }));
    } catch (error) {
      if (entry.generation !== generation) return;
      entry.error =
        error instanceof Error
          ? error
          : new Error('Membership plans could not be loaded');
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

/** Refresh a branch's shared plan catalogue after a plan or option mutation. */
export function invalidateMembershipPlans(accountId: string) {
  if (planCache.has(accountId)) void loadPlans(accountId, true);
}

export function useMembershipPlans(activeOnly = true) {
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
    if (accountId) void loadPlans(accountId);
  }, [accountId]);
  const refresh = useCallback(() => {
    if (accountId) void loadPlans(accountId, true);
  }, [accountId]);
  const plans = useMemo(
    () =>
      activeOnly
        ? snapshot.plans.filter((plan) => plan.is_active)
        : snapshot.plans,
    [activeOnly, snapshot.plans]
  );
  return { plans, loading: snapshot.loading, error: snapshot.error, refresh };
}
