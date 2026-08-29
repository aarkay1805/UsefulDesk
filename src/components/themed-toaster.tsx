'use client';

import { Toaster } from 'sonner';

import { useTheme } from '@/hooks/use-theme';

/**
 * Toaster wrapper that tracks the active light/dark mode.
 *
 * Lives inside <ThemeProvider> (see layout.tsx) so it can read the
 * current mode and hand it to sonner. Colors are driven off the same
 * CSS tokens as the rest of the app, so a toast looks at home in
 * either mode without a second palette to maintain.
 *
 * `mode` arrives already hydration-gated — ThemeProvider hands out
 * DEFAULT_MODE until the first client render is past, so the sonner
 * `theme` attribute matches the server's. This file used to own that
 * gate privately; it now lives in the provider so every consumer gets
 * it. See `use-is-client.ts`.
 */
export function ThemedToaster() {
  const { mode } = useTheme();
  return (
    <Toaster
      theme={mode}
      position="top-right"
      toastOptions={{
        style: {
          background: 'var(--popover)',
          border: '1px solid var(--border)',
          color: 'var(--popover-foreground)',
        },
      }}
    />
  );
}
