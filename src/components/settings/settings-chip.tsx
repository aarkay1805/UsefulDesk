import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Small status / role pill used across the settings redesign
 * (Overview tiles, WhatsApp banner, the "Active" appearance markers).
 *
 * Status colours (emerald = good, amber = attention) use the shared semantic
 * hue foreground tokens. Neutrals stay on the neutral design tokens.
 */
export type ChipVariant = 'owner' | 'admin' | 'ok' | 'warn' | 'muted';

// Foreground tokens adapt toward the live page foreground in either mode.
const VARIANTS: Record<ChipVariant, string> = {
  owner: 'border-amber-500/40 bg-amber-500/10 text-amber-foreground',
  admin: 'border-primary-soft-2 bg-primary-soft text-primary-text',
  ok: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-foreground',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-foreground',
  muted: 'border-border bg-muted text-muted-foreground',
};

export function SettingsChip({
  variant = 'muted',
  className,
  children,
}: {
  variant?: ChipVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3.5',
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A small live status dot (e.g. WhatsApp connected indicator). */
export function StatusDot({
  tone = 'ok',
  className,
}: {
  tone?: 'ok' | 'muted';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full',
        tone === 'ok' ? 'bg-emerald-500' : 'bg-muted-foreground',
        className,
      )}
    />
  );
}
