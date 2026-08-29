'use client';

import { useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};

/**
 * Returns false during SSR and the first hydration render, true after —
 * the sanctioned (warning-free, no setState-in-effect) way to diverge
 * server vs client. Lets a component match the server-rendered default
 * on first paint, then adopt a browser-only value.
 *
 * Reach for this when the browser-only value has to reach JavaScript.
 * When it only decides an icon, a class, or a label, prefer CSS keyed
 * off the `<html>` attributes the boot script sets before first paint
 * (see `mode-toggle.tsx`) — that has no post-hydration swap at all.
 */
export function useIsClient() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}
