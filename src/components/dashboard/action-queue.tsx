'use client';

import type { LucideIcon } from 'lucide-react';

import { BranchLink as Link } from '@/components/layout/branch-link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Skeleton } from './skeleton';

/**
 * The shared parts of a dashboard action queue — the named column inside a
 * work section's card. Lead work and Member work both render two of these, so
 * the label, the truncation count, and the "See all" escape hatch must sit in
 * the same place in all four columns; they used to be three different shapes.
 */

export function QueueHeading({
  label,
  href,
  shown,
  total,
}: {
  label: string;
  /** Where the full queue lives. Omitted when no page owns this list. */
  href?: string;
  /** Rows rendered here, paired with `total` to report truncation. */
  shown?: number;
  total?: number;
}) {
  // The count answers one question — "is this the whole list?" — so it only
  // appears when the answer is no. Printing "5" above five visible rows
  // restates what the rows already show.
  const truncated = shown !== undefined && total !== undefined && total > shown;

  return (
    <div className="text-muted-foreground mb-2 flex min-h-6 items-center gap-2 text-xs font-medium">
      <span>{label}</span>
      {href && (
        <Link
          data-slot="button"
          href={href}
          className={buttonVariants({ variant: 'link', size: 'xs' })}
        >
          See all
        </Link>
      )}
      {truncated && (
        <span className="ml-auto shrink-0 tabular-nums">
          {shown} of {total}
        </span>
      )}
    </div>
  );
}

export function QueueSkeleton({
  rowClassName = 'h-9',
}: {
  rowClassName?: string;
}) {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: 3 }).map((_, index) => (
        <Skeleton key={index} className={cn('w-full', rowClassName)} />
      ))}
    </div>
  );
}

export function QueueEmpty({
  icon: Icon,
  text,
}: {
  icon: LucideIcon;
  text: string;
}) {
  return (
    <div className="text-muted-foreground flex items-center gap-2 py-3 text-xs">
      <Icon className="size-4 shrink-0" />
      {text}
    </div>
  );
}
