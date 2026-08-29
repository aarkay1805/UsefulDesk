'use client';

import { Moon, Sun } from 'lucide-react';

import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';

const BUTTON_CLASS =
  'text-muted-foreground hover:bg-muted hover:text-foreground h-10 w-10 items-center justify-center rounded-md transition-colors';

/**
 * Light/dark mode toggle — a single visible icon button that flips the
 * app between the two modes. Sun shows in light mode (click → go dark),
 * moon shows in dark mode (click → go light); the label always names
 * the destination so screen-reader users hear what the click does.
 *
 * 40×40 hit target to match the header's other touch controls.
 *
 * BOTH buttons are always rendered and CSS picks one via the `dark:`
 * variant (`html[data-mode="dark"]`, see globals.css). That looks
 * redundant and is not: the mode lives in localStorage, so the server
 * can only ever render DEFAULT_MODE. Branching the markup on `mode`
 * here — one button whose icon and label follow the hook — made every
 * user whose mode isn't the default hydrate against server HTML for
 * the other mode, which React recovers from by regenerating the tree
 * (there is no Suspense boundary between here and the root), and
 * repainted the wrong icon for a beat on every load. Static markup has
 * neither problem: the boot script sets `data-mode` before first paint,
 * so the right button is the only one ever shown. `ThemedToaster` hits
 * the same wall and solves it with `useIsClient`, which is the right
 * tool when the value must reach JS — an icon and a label can be
 * chosen in CSS, so they are.
 *
 * The inactive button is `display: none`, so it is out of the
 * accessibility tree and the tab order, and contributes no flex gap.
 */
export function ModeToggle({ className }: { className?: string }) {
  const { toggleMode } = useTheme();
  return (
    <>
      <button
        type="button"
        onClick={toggleMode}
        aria-label="Switch to dark mode"
        title="Switch to dark mode"
        className={cn(BUTTON_CLASS, 'flex dark:hidden', className)}
      >
        <Sun className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={toggleMode}
        aria-label="Switch to light mode"
        title="Switch to light mode"
        className={cn(BUTTON_CLASS, 'hidden dark:flex', className)}
      >
        <Moon className="h-5 w-5" />
      </button>
    </>
  );
}
