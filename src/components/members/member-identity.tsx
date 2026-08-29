'use client';

import type React from 'react';
import { useId } from 'react';

import { buttonVariants } from '@/components/ui/button';
import {
  PreviewCard,
  PreviewCardContent,
  PreviewCardTrigger,
} from '@/components/ui/preview-card';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useLocale } from '@/hooks/use-locale';
import { cn } from '@/lib/utils';

/**
 * MemberIdentity — the single way to render a person's identity on the
 * Members page: an avatar next to the name over a communication line
 * (phone in our case; email is an equally valid comm string). Use it in
 * every member row/column so the same person reads identically across the
 * all-members table, renewals, follow-ups, trials, payment-due and
 * inactive lists — never hand-roll a bare name+phone stack again.
 *
 * Members carry no photo today, so the avatar is the initial fallback via
 * `UserAvatar`; `src` is wired for a future member photo URL so uploading
 * one lights up every call-site at once. An optional `meta` node renders a
 * third line for list-specific context (e.g. "plan · due date"); the
 * caller styles it.
 */
export function MemberIdentity({
  name,
  secondary,
  meta,
  src,
  size = 'default',
  className,
  avatarPreview,
}: {
  name?: string | null;
  /** Communication line — phone (preferred) or email. */
  secondary?: string | null;
  /** Optional third context line, fully styled by the caller. */
  meta?: React.ReactNode;
  /** Future member photo URL; null/undefined → initial fallback. */
  src?: string | null;
  size?: 'sm' | 'default' | 'lg';
  className?: string;
  /** Optional hover/focus content anchored only to the avatar. */
  avatarPreview?: {
    content: React.ReactNode;
    href: string;
    onNavigate: () => void;
  };
}) {
  const { fmt } = useLocale();
  const display = name?.trim() || 'Unnamed';
  const avatarPreviewTriggerId = useId();
  // Two lines (name + phone) → centre the avatar against the pair. Three
  // or more (a `meta` context line is present) → top-align it to the
  // block's first line instead.
  const multiLine = Boolean(secondary) && Boolean(meta);
  return (
    <div
      className={cn(
        'flex min-w-0 gap-2.5',
        multiLine ? 'items-start' : 'items-center',
        className
      )}
    >
      {avatarPreview ? (
        <PreviewCard>
          <PreviewCardTrigger
            id={avatarPreviewTriggerId}
            href={avatarPreview.href}
            className={buttonVariants({ variant: 'ghost', size: 'icon' })}
            aria-label={`Quick view for ${display}`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              avatarPreview.onNavigate();
            }}
          >
            <UserAvatar name={display} src={src} size={size} />
          </PreviewCardTrigger>
          <PreviewCardContent side="right" align="start" sideOffset={8}>
            {avatarPreview.content}
          </PreviewCardContent>
        </PreviewCard>
      ) : (
        <UserAvatar name={display} src={src} size={size} />
      )}
      <div className="min-w-0">
        <div className="text-foreground truncate text-sm font-medium">
          {display}
        </div>
        {secondary ? (
          <div className="text-muted-foreground truncate text-xs">
            {fmt.phone(secondary)}
          </div>
        ) : null}
        {meta}
      </div>
    </div>
  );
}
