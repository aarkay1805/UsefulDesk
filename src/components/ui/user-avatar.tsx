'use client';

import type { ComponentProps, ReactNode } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

/**
 * UserAvatar — the single way to render a person's avatar anywhere in
 * the product (teammates in notes/rosters/sidebar, and later members
 * and contacts). Shows the uploaded photo when `src` is set; otherwise
 * falls back to the name's first initial on the primary tint.
 *
 * Keep every person-avatar call-site on this component so a photo
 * uploaded in Settings → Profile appears everywhere at once. Size via
 * the underlying Avatar `size` prop ('sm' | 'default' | 'lg') plus
 * `className` for one-off dimensions; restyle the initial through
 * `fallbackClassName` (e.g. a larger text size on a hero avatar) —
 * don't fork the fill/tint recipe per call-site.
 *
 * `children` render inside the Avatar root — for `AvatarBadge`
 * overlays like presence dots.
 */
export function UserAvatar({
  name,
  src,
  fallbackClassName,
  children,
  ...props
}: Omit<ComponentProps<typeof Avatar>, 'children'> & {
  /** Display name; its first character is the fallback initial. */
  name: string;
  /** Photo URL. Null/undefined renders the initial fallback. */
  src?: string | null;
  /** Extends the fallback initial's classes (text size etc.). */
  fallbackClassName?: string;
  /** Overlays such as `AvatarBadge`. */
  children?: ReactNode;
}) {
  return (
    <Avatar {...props}>
      {src ? <AvatarImage src={src} alt={name} /> : null}
      <AvatarFallback
        className={cn(
          'bg-primary/10 text-sm font-medium text-primary-text',
          fallbackClassName
        )}
      >
        {(name.trim().charAt(0) || '?').toUpperCase()}
      </AvatarFallback>
      {children}
    </Avatar>
  );
}
