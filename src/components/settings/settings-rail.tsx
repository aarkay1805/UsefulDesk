'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import {
  RAIL_GROUPS,
  SECTION_META,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from './settings-sections';

// Width at/above which the rail is a vertical column (already in view, so
// no auto-scroll needed). Mirrors the Tailwind `lg:` breakpoint that
// drives the row→column switch in the markup below — keep the two in sync.
const RAIL_DESKTOP_MIN_PX = 1024;
const RAIL_DESKTOP_QUERY = `(min-width: ${RAIL_DESKTOP_MIN_PX}px)`;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * The settings left rail — grouped, vertical on desktop and a
 * horizontal scroller on narrow screens (mirrors the mockup's ≤920px
 * behaviour). The active item auto-scrolls into view when the rail is
 * horizontal so a deep-linked section is never off-screen.
 */
export function SettingsRail({
  active,
  onSelect,
  hints,
}: {
  active: SettingsSection;
  onSelect: (section: SettingsSection) => void;
  hints?: Partial<Record<SettingsSection, ReactNode>>;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);
  const previousActiveRef = useRef<SettingsSection | null>(null);

  // Position a deep link before paint, then animate later section changes when
  // motion is allowed. Scrolling never moves focus: native button focus stays
  // with the control that initiated the navigation.
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;

    const desktopMedia = window.matchMedia(RAIL_DESKTOP_QUERY);
    const previousActive = previousActiveRef.current;
    previousActiveRef.current = active;

    const positionActive = (behavior: ScrollBehavior) => {
      activeRef.current?.scrollIntoView({
        inline: 'center',
        block: 'nearest',
        behavior,
      });
    };

    // Avoid repeating the initial positioning when Strict Mode replays effects.
    if (previousActive !== active && !desktopMedia.matches) {
      const reduceMotion = window.matchMedia(REDUCED_MOTION_QUERY).matches;
      positionActive(
        previousActive === null || reduceMotion ? 'auto' : 'smooth'
      );
    }

    const handleBreakpointChange = (event: MediaQueryListEvent) => {
      if (!event.matches) positionActive('auto');
    };
    desktopMedia.addEventListener('change', handleBreakpointChange);
    return () =>
      desktopMedia.removeEventListener('change', handleBreakpointChange);
  }, [active]);

  return (
    <nav
      aria-label="Settings sections"
      className={cn(
        'flex [scrollbar-width:none] gap-1 overflow-x-auto pb-2 [&::-webkit-scrollbar]:hidden',
        'border-border border-b',
        'lg:sticky lg:top-0 lg:flex-col lg:overflow-visible lg:border-b-0 lg:pb-0'
      )}
    >
      {RAIL_GROUPS.map(({ label, group }) => {
        const items = SETTINGS_SECTIONS.filter(
          (s) => SECTION_META[s].group === group
        );
        return (
          <div
            key={group}
            className="flex shrink-0 gap-1 lg:flex-col lg:gap-0.5"
          >
            {label ? (
              <div className="text-muted-foreground hidden px-3 pt-3.5 pb-1.5 text-[11px] font-semibold tracking-[0.09em] uppercase lg:block">
                {label}
              </div>
            ) : null}
            {items.map((s) => {
              const meta = SECTION_META[s];
              const Icon = meta.brandIcon ?? meta.icon;
              const isActive = s === active;
              return (
                <button
                  key={s}
                  ref={isActive ? activeRef : undefined}
                  type="button"
                  onClick={() => onSelect(s)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium whitespace-nowrap transition-colors',
                    'lg:w-full',
                    isActive
                      ? 'bg-primary-soft text-primary-text'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <Icon
                    className={cn(
                      'size-4 shrink-0',
                      meta.brandIcon && 'grayscale'
                    )}
                  />
                  <span className="flex-1">{meta.label}</span>
                  {hints?.[s] != null ? (
                    <span
                      className={cn(
                        'hidden items-center gap-1.5 text-xs lg:inline-flex',
                        isActive ? 'text-primary-text' : 'text-muted-foreground'
                      )}
                    >
                      {hints[s]}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
