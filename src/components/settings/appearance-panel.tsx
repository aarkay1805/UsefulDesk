'use client';

import { Moon, Palette, SunMoon, Sun } from 'lucide-react';

import { useTheme } from '@/hooks/use-theme';
import {
  MODES,
  THEMES,
  isMode,
  isThemeId,
  type Mode,
  type ThemeId,
} from '@/lib/themes';
import { cn } from '@/lib/utils';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { SettingsPanelHead } from './settings-panel-head';

/**
 * Appearance panel — light/dark mode + accent-color picker.
 *
 * Two independent controls: a mode toggle (light / dark) and the
 * accent grid. Either applies + persists immediately. No save button:
 * each change is a single attribute swap on <html>, there's nothing
 * to roll back.
 *
 * Persistence: the user's profile is authoritative across browsers;
 * localStorage remains a synchronous cache for no-flash page loads.
 */
export function AppearancePanel() {
  const { theme, setTheme, mode, setMode } = useTheme();
  return (
    <section className="animate-in fade-in-50 max-w-3xl duration-200 motion-reduce:animate-none">
      <SettingsPanelHead
        title="Appearance"
        description="Choose a mode and accent. Changes apply immediately and sync to your account."
      />

      <div className="space-y-4">
        <h3
          id="appearance-mode-heading"
          className="text-foreground flex items-center gap-2 text-sm font-semibold"
        >
          <SunMoon className="text-muted-foreground size-4" />
          Mode
        </h3>

        <RadioGroup
          value={mode}
          onValueChange={(value) => isMode(value) && setMode(value)}
          aria-labelledby="appearance-mode-heading"
          className="grid max-w-md grid-cols-2 gap-3"
        >
          {MODES.map((m) => (
            <ModeCard key={m} mode={m} isActive={m === mode} />
          ))}
        </RadioGroup>
      </div>

      <div className="mt-8 space-y-4">
        <h3
          id="appearance-accent-heading"
          className="text-foreground flex items-center gap-2 text-sm font-semibold"
        >
          <Palette className="text-muted-foreground size-4" />
          Accent colour
        </h3>

        <RadioGroup
          value={theme}
          onValueChange={(value) => isThemeId(value) && setTheme(value)}
          aria-labelledby="appearance-accent-heading"
          className="grid grid-cols-2 gap-2 sm:grid-cols-3"
        >
          {THEMES.map((t) => (
            <ThemeCard
              key={t.id}
              id={t.id}
              name={t.name}
              swatch={t.swatch}
              isActive={t.id === theme}
            />
          ))}
        </RadioGroup>
      </div>
    </section>
  );
}

function ModeCard({ mode, isActive }: { mode: Mode; isActive: boolean }) {
  const isLight = mode === 'light';
  const Icon = isLight ? Sun : Moon;
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors',
        isActive
          ? 'border-primary/40 bg-primary/[0.04]'
          : 'border-border/80 hover:border-border-hover'
      )}
    >
      <span
        aria-hidden
        className="bg-muted text-foreground flex size-9 shrink-0 items-center justify-center rounded-lg"
      >
        <Icon className="size-4" />
      </span>
      <span className="text-foreground min-w-0 flex-1 text-sm font-medium capitalize">
        {mode}
      </span>
      <RadioGroupItem value={mode} />
    </label>
  );
}

function ThemeCard({
  id,
  name,
  swatch,
  isActive,
}: {
  id: ThemeId;
  name: string;
  swatch: string;
  isActive: boolean;
}) {
  return (
    <label
      className={cn(
        'flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors',
        isActive
          ? 'border-primary/40 bg-primary/[0.04]'
          : 'border-border/80 hover:border-border-hover'
      )}
    >
      <span
        aria-hidden
        className="size-8 shrink-0 rounded-full"
        style={{ background: swatch }}
      />
      <span className="text-foreground min-w-0 flex-1 text-sm font-medium">
        {name}
      </span>
      <RadioGroupItem value={id} />
    </label>
  );
}
