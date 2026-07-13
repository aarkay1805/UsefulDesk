"use client";

import { useEffect, useState } from "react";

/**
 * Tiny `matchMedia` shim. We could pull in `react-responsive`, but
 * matchMedia is one of those browser APIs that doesn't need a dependency.
 *
 * Reach for this only when a breakpoint has to change WHAT RENDERS, not
 * merely how it looks — CSS (`hidden lg:block`) is the right tool for the
 * latter and needs no JS. The inbox needs it because its mobile contact
 * profile is a `Sheet`, which portals to <body>: a `lg:hidden` wrapper
 * around it would style the wrapper, not the portalled popup, so the
 * overlay would still open on desktop behind the inline panel.
 *
 * SSR renders `false` (no window), so the first client render can differ
 * from the server for a true query. Keep that in mind: gate only subtrees
 * whose initial render is identical either way (the inbox's sheet starts
 * closed, so it renders nothing on either side of hydration).
 */
export function useMatchMedia(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    // Safari < 14 still uses addListener; addEventListener is the modern
    // path. Both fire identically.
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}
