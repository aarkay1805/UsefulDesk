'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';

/**
 * Per-user, per-account persisted table view (column order / visibility /
 * widths / page size / sort / …). Drop-in replacement for `useLocalStorage`
 * with the same `[value, setValue]` tuple and updater semantics, but the
 * source of truth is the `table_preferences` row (account_id, user_id,
 * view_key) — so a teammate's layout follows them across devices and never
 * bleeds into another account (see migration 053).
 *
 * localStorage is kept as a per-scope cache: it paints the saved layout on
 * the first frame (no flash of defaults on a return visit / same device) and
 * serves as an offline fallback, but the DB row wins once it loads. Writes
 * update state + cache synchronously and debounce the DB upsert so a burst of
 * column toggles coalesces into one round-trip (flushed on unmount / scope
 * change so a quick edit-then-navigate isn't lost).
 *
 * The returned value is always `{ ...initial, ...stored }` so a pref field
 * added after a row was saved reads its default rather than `undefined`.
 */
const CACHE_PREFIX = 'usefuldesk:tableprefs:';
const SAVE_DEBOUNCE_MS = 500;

export function useTablePrefs<T extends object>(
  viewKey: string,
  initial: T
): [T, (value: T | ((prev: T) => T)) => void] {
  const { user, accountId } = useAuth();
  const userId = user?.id ?? null;

  const [value, setValue] = useState<T>(initial);

  // One Supabase browser client for the hook's lifetime.
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (supabaseRef.current === null) supabaseRef.current = createClient();

  // `initial` is expected to be a module-stable default (e.g. DEFAULT_PREFS);
  // captured once so the load effect can merge without a churny dep.
  const initialRef = useRef(initial);

  // Set true once the user has made a local edit for the current scope, so a
  // late DB-load response can't clobber their in-flight change.
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The value of a debounced write not yet sent, so unmount / scope change can
  // flush it (SPA nav doesn't unload the page, so a fire-and-forget upsert
  // lands). Carries the scope it belongs to so a stale flush can't cross scopes.
  const pendingRef = useRef<{
    accountId: string;
    userId: string;
    viewKey: string;
    resolved: T;
  } | null>(null);

  const cacheKey =
    accountId && userId
      ? `${CACHE_PREFIX}${accountId}:${userId}:${viewKey}`
      : null;

  const sendUpsert = useCallback((p: NonNullable<typeof pendingRef.current>) => {
    void supabaseRef
      .current!.from('table_preferences')
      .upsert(
        {
          account_id: p.accountId,
          user_id: p.userId,
          view_key: p.viewKey,
          prefs: p.resolved,
        },
        { onConflict: 'account_id,user_id,view_key' }
      );
  }, []);

  // ---- Load: cache first (instant), then DB (authoritative) --------------
  useEffect(() => {
    dirtyRef.current = false;

    // Paint the cached layout immediately (same device / return visit).
    if (cacheKey) {
      try {
        const raw = window.localStorage.getItem(cacheKey);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setValue(
          raw !== null
            ? { ...initialRef.current, ...(JSON.parse(raw) as object) }
            : initialRef.current
        );
      } catch {
        setValue(initialRef.current);
      }
    }

    // Not signed in / no account yet — stay on cache/defaults, no DB read.
    if (!accountId || !userId) return;

    let cancelled = false;
    (async () => {
      const { data } = await supabaseRef
        .current!.from('table_preferences')
        .select('prefs')
        .eq('account_id', accountId)
        .eq('user_id', userId)
        .eq('view_key', viewKey)
        .maybeSingle();

      if (cancelled) return;
      // A local edit landed while the read was in flight — theirs wins.
      if (!dirtyRef.current && data?.prefs) {
        setValue({ ...initialRef.current, ...(data.prefs as object) } as T);
        if (cacheKey) {
          try {
            window.localStorage.setItem(cacheKey, JSON.stringify(data.prefs));
          } catch {
            /* storage full/blocked */
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId, userId, viewKey, cacheKey]);

  // Flush a pending debounced write before the scope changes or the hook
  // unmounts (reading refs in cleanup is allowed; render never touches them).
  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      const p = pendingRef.current;
      if (p) {
        pendingRef.current = null;
        sendUpsert(p);
      }
    },
    [accountId, userId, viewKey, sendUpsert]
  );

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved =
          typeof next === 'function'
            ? (next as (p: T) => T)(prev)
            : next;
        dirtyRef.current = true;
        if (cacheKey) {
          try {
            window.localStorage.setItem(cacheKey, JSON.stringify(resolved));
          } catch {
            /* storage full/blocked — value still updates in memory */
          }
        }
        if (accountId && userId) {
          pendingRef.current = { accountId, userId, viewKey, resolved };
          if (saveTimer.current) clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => {
            const p = pendingRef.current;
            if (p) {
              pendingRef.current = null;
              sendUpsert(p);
            }
          }, SAVE_DEBOUNCE_MS);
        }
        return resolved;
      });
    },
    [accountId, userId, viewKey, cacheKey, sendUpsert]
  );

  return [value, set];
}
