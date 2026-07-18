'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  MODE_STORAGE_KEY,
  STORAGE_KEY,
  isMode,
  isThemeId,
  type Mode,
  type ThemeId,
} from '@/lib/themes';

/**
 * ThemeProvider — wraps the whole app, owns the two theming axes:
 *   • `theme` — the accent color (`data-theme` on <html>)
 *   • `mode`  — light / dark (`data-mode` on <html>)
 * The two are independent, so any accent renders in either mode.
 *
 * The boot script in `src/app/layout.tsx` has already applied both
 * `data-theme` and `data-mode` before React hydrates, so by the time
 * this Provider mounts the page is already painted correctly. We just
 * read what's there and keep it in sync going forward.
 *
 * localStorage is the synchronous paint cache. Authenticated changes
 * are also serialized to the user's profile, and AccountAppearanceSync
 * hydrates that server copy after authentication on every browser.
 */

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (next: ThemeId) => void;
  mode: Mode;
  setMode: (next: Mode) => void;
  toggleMode: () => void;
  /** Apply the authenticated profile's saved values without writing
   *  them back to the database. NULL preserves the current browser
   *  cache for profiles created before account persistence existed. */
  applyAccountAppearance: (next: {
    theme: ThemeId | null;
    mode: Mode | null;
  }) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readInitialTheme(): ThemeId {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  // Whatever the boot script applied is the truth. Fall back to
  // localStorage / default if for some reason the attribute is missing
  // (e.g. someone bypassed the boot script in a custom layout).
  const fromAttr = document.documentElement.dataset.theme;
  if (isThemeId(fromAttr)) return fromAttr;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isThemeId(stored)) return stored;
  } catch {
    // localStorage can throw in private-browsing / sandboxed contexts.
  }
  return DEFAULT_THEME;
}

function readInitialMode(): Mode {
  if (typeof window === 'undefined') return DEFAULT_MODE;
  const fromAttr = document.documentElement.dataset.mode;
  if (isMode(fromAttr)) return fromAttr;
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    if (isMode(stored)) return stored;
  } catch {
    // localStorage can throw in private-browsing / sandboxed contexts.
  }
  return DEFAULT_MODE;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(readInitialTheme);
  const [mode, setModeState] = useState<Mode>(readInitialMode);

  // Keep writes in user-action order. Without serialization, two quick
  // selections can resolve out of order and leave the older choice in
  // the profile even though the UI shows the newer one.
  const appearanceWriteChain = useRef<Promise<void>>(Promise.resolve());

  const persistAppearance = useCallback(
    (patch: { appearance_theme?: ThemeId; appearance_mode?: Mode }) => {
      appearanceWriteChain.current = appearanceWriteChain.current
        .then(async () => {
          const supabase = createClient();
          const {
            data: { session },
            error: sessionError,
          } = await supabase.auth.getSession();

          if (sessionError) throw sessionError;
          // Public/auth pages can share this provider. There is no
          // profile to update until a user is signed in.
          if (!session?.user) return;

          const { error } = await supabase
            .from('profiles')
            .update(patch)
            .eq('user_id', session.user.id);
          if (error) throw error;
        })
        .catch((error: unknown) => {
          console.error('[ThemeProvider] appearance save failed:', error);
          toast.error(
            'Appearance changed on this device, but could not be saved',
            {
              description: 'Try again to sync it with your account.',
            }
          );
        });
    },
    []
  );

  const setTheme = useCallback(
    (next: ThemeId) => {
      setThemeState(next);
      if (typeof document !== 'undefined') {
        document.documentElement.dataset.theme = next;
      }
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Same private-browsing edge case as above; the in-memory state
        // still updates so the current tab works for the session.
      }
      persistAppearance({ appearance_theme: next });
    },
    [persistAppearance]
  );

  const setMode = useCallback(
    (next: Mode) => {
      setModeState(next);
      if (typeof document !== 'undefined') {
        document.documentElement.dataset.mode = next;
      }
      try {
        localStorage.setItem(MODE_STORAGE_KEY, next);
      } catch {
        // Same private-browsing edge case as above.
      }
      persistAppearance({ appearance_mode: next });
    },
    [persistAppearance]
  );

  const applyAccountAppearance = useCallback(
    (next: { theme: ThemeId | null; mode: Mode | null }) => {
      if (next.theme) {
        setThemeState(next.theme);
        document.documentElement.dataset.theme = next.theme;
        try {
          localStorage.setItem(STORAGE_KEY, next.theme);
        } catch {
          // The DOM + in-memory state are still updated.
        }
      }

      if (next.mode) {
        setModeState(next.mode);
        document.documentElement.dataset.mode = next.mode;
        try {
          localStorage.setItem(MODE_STORAGE_KEY, next.mode);
        } catch {
          // The DOM + in-memory state are still updated.
        }
      }
    },
    []
  );

  const toggleMode = useCallback(() => {
    setMode(mode === 'dark' ? 'light' : 'dark');
  }, [mode, setMode]);

  // Sync from other tabs — change theme or mode in tab A, tab B
  // catches up without a refresh.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) {
        if (isThemeId(e.newValue) && e.newValue !== theme) {
          setThemeState(e.newValue);
          document.documentElement.dataset.theme = e.newValue;
        }
        return;
      }
      if (e.key === MODE_STORAGE_KEY) {
        if (isMode(e.newValue) && e.newValue !== mode) {
          setModeState(e.newValue);
          document.documentElement.dataset.mode = e.newValue;
        }
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [theme, mode]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        mode,
        setMode,
        toggleMode,
        applyAccountAppearance,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Fallback for components rendered outside the provider — return
    // no-op setters so callers don't crash. The boot script still
    // applied the right CSS attributes, so visually the page is fine.
    return {
      theme: DEFAULT_THEME,
      setTheme: () => {},
      mode: DEFAULT_MODE,
      setMode: () => {},
      toggleMode: () => {},
      applyAccountAppearance: () => {},
    };
  }
  return ctx;
}
