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
