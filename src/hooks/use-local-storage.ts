'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * localStorage-backed state. Reads the stored value once on mount (SSR-safe —
 * falls back to `initial` on the server and when nothing/invalid is stored),
 * and writes back on every change. Returns a `[value, setValue]` tuple with
 * the same updater semantics as `useState` (accepts a value or a function).
 *
 * Note: the first client render uses `initial` to stay hydration-safe, then
 * swaps to the persisted value in an effect. Callers that render user prefs
 * should tolerate that one-frame default (the contacts table does).
 */
export function useLocalStorage<T>(
  key: string,
  initial: T
): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);

  // Hydrate from localStorage after mount (avoids SSR/CSR markup mismatch).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setValue(JSON.parse(raw) as T);
      }
    } catch {
      // Corrupt/blocked storage — keep the in-memory default.
    }
  }, [key]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved =
          typeof next === 'function'
            ? (next as (p: T) => T)(prev)
            : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // Storage full/blocked — value still updates in memory.
        }
        return resolved;
      });
    },
    [key]
  );

  return [value, set];
}
