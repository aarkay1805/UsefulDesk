'use client';

import { BranchLink as Link } from '@/components/layout/branch-link';
import { useState } from 'react';
import { MessageSquare, UserPlus, Radio, Zap, Inbox } from 'lucide-react';
import type { ComponentType } from 'react';
import type { ActivityItem, ActivityKind } from '@/lib/dashboard/types';
import { useLocale } from '@/hooks/use-locale';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';

interface ActivityFeedProps {
  items: ActivityItem[] | null;
  loading: boolean;
}

/** Rows shown before the reader asks for the rest. */
const COLLAPSED_ROWS = 6;

interface KindTheme {
  icon: ComponentType<{ className?: string }>;
  /** Tailwind classes for the round icon badge + label color. */
  badge: string;
}

const KIND_THEME: Record<ActivityKind, KindTheme> = {
  message: {
    icon: MessageSquare,
    badge: 'bg-blue-500/10 text-blue-foreground',
  },
  contact: { icon: UserPlus, badge: 'bg-primary/10 text-primary-text' },
  broadcast: { icon: Radio, badge: 'bg-amber-500/10 text-amber-foreground' },
  automation: { icon: Zap, badge: 'bg-rose-500/10 text-rose-foreground' },
};

/**
 * A glance at what just happened. The old footer offered four page sizes
 * (5/10/20/50) with a disabled-state rule for each — four decisions for a
 * feed nobody navigates. One expand control replaces them and reveals more
 * rows than the old maximum in a single click.
 */
export function ActivityFeed({ items, loading }: ActivityFeedProps) {
  const { fmt } = useLocale();
  const [expanded, setExpanded] = useState(false);

  const totalLoaded = items?.length ?? 0;
  const visible = expanded
    ? (items ?? [])
    : (items?.slice(0, COLLAPSED_ROWS) ?? []);

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Recent work</CardTitle>
        <CardAction>
          <Link
            data-slot="button"
            href="/inbox"
            className={buttonVariants({ variant: 'link', size: 'xs' })}
          >
            Open inbox
          </Link>
        </CardAction>
      </CardHeader>

      {loading || !items ? (
        <CardContent className="space-y-2">
          {Array.from({ length: COLLAPSED_ROWS }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      ) : items.length === 0 ? (
        <CardContent>
          <EmptyState
            icon={Inbox}
            title="No activity yet"
            hint="Messages, leads, broadcasts, and automations will show here."
          />
        </CardContent>
      ) : (
        <>
          {/* Dividers alone separate the rows: the old alternating stripe
              rode on top of them, so every row carried two separators. */}
          <ul className="divide-border divide-y">
            {visible.map((it) => {
              const theme = KIND_THEME[it.kind];
              const Icon = theme.icon;
              const row = (
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <span
                    className={cn(
                      'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full',
                      theme.badge
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                    {it.text}
                  </span>
                  <span className="text-muted-foreground flex-shrink-0 text-xs tabular-nums">
                    {relativeTime(it.at, fmt.date)}
                  </span>
                </div>
              );
              return (
                <li key={it.id} className="hover:bg-muted/40 transition-colors">
                  {it.href ? (
                    <Link href={it.href} className="block">
                      {row}
                    </Link>
                  ) : (
                    row
                  )}
                </li>
              );
            })}
          </ul>
          {totalLoaded > COLLAPSED_ROWS && (
            <CardFooter className="justify-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded((open) => !open)}
              >
                {expanded
                  ? 'Show less'
                  : `Show ${totalLoaded - COLLAPSED_ROWS} more`}
              </Button>
            </CardFooter>
          )}
        </>
      )}
    </Card>
  );
}

function relativeTime(
  iso: string,
  formatDate: (value: string | Date) => string
): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} hr ago`;
  if (diffSec < 2_592_000) return `${Math.floor(diffSec / 86400)} days ago`;
  return formatDate(new Date(iso));
}
