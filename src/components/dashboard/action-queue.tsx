'use client';

import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Skeleton } from './skeleton';

/**
 * The shared parts of a dashboard action queue. Every queue is its own section
 * now, so what they have in common is the loading state, the empty state, and
 * the truncation count — not a sub-heading.
 */

/**
 * "8 of 23", and nothing when the list is whole. A count printed above the
 * rows it counts restates what the rows already show; this only answers the
 * question the rows cannot — is there more than this?
 */
export function QueueCount({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null;
  return (
    <span className="text-muted-foreground shrink-0 text-xs font-medium tabular-nums">
      {shown} of {total}
    </span>
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

/**
 * No padding of its own: `Card`'s `py-4` is the whole vertical inset, the same
 * 16px a populated queue's first row sits at. Its old `py-3` stacked on top of
 * that and left an empty queue with a deeper top and bottom than any card with
 * rows in it.
 */
export function QueueEmpty({
  icon: Icon,
  text,
}: {
  icon: LucideIcon;
  text: string;
}) {
  return (
    <div className="text-muted-foreground flex items-center gap-2 text-xs">
      <Icon className="size-4 shrink-0" />
      {text}
    </div>
  );
}

/**
 * The class every queue list carries. `-mx-2` is the long-standing half of it:
 * it cancels half the card's `px-4` so each row's own `px-2` still lands text
 * at 16px while the dividers run wider than the text.
 *
 * `-my-*` is the vertical twin, and it must match the row's own `py-*`. A row
 * pads itself so the whole strip is a hover and click target, but that padding
 * used to ADD to the card's `py-4` — text sat 24-28px from the top edge against
 * 16px from the sides, so every queue read bottom- and top-heavy. Pulling the
 * list back by the row's own padding puts the first and last rows' text at the
 * same 16px as the sides while the hover strip keeps its full height.
 */
export const QUEUE_LIST = 'divide-border/60 -mx-2 divide-y';
