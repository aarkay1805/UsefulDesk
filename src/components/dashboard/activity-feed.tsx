'use client';

import { BranchLink as Link } from '@/components/layout/branch-link';
import {
  AlertCircle,
  MessageSquare,
  UserPlus,
  Radio,
  Zap,
  Inbox,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { ActivityItem, ActivityKind } from '@/lib/dashboard/types';
import { useLocale } from '@/hooks/use-locale';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  DASHBOARD_PAIRED_SECTION,
  DASHBOARD_QUEUE_SCROLLER,
  DashboardSection,
} from './dashboard-section';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';

interface ActivityFeedProps {
  items: ActivityItem[] | null;
  loading: boolean;
  /** The feed's own request failed; say so instead of pulsing forever. */
  failed?: boolean;
}

/** Placeholder rows while the feed loads — roughly what the card holds. */
const SKELETON_ROWS = 6;

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
 * A glance at what just happened. This card has carried three answers to "how
 * many rows" — four page-size buttons (5/10/20/50), then one expand control,
 * now none. The card is capped at 480px with its own scroller since it started
 * sharing a row with the uncontacted-lead queue, and that cap already bounds
 * the feed: collapsing to six rows on top of it only left the card visibly
 * short beside a full sibling and put a click between the reader and rows
 * that were already loaded. The scroller is the control now. Do not
 * reintroduce a page size or an expand toggle here — bound the payload at the
 * query (`DASHBOARD_ACTIVITY_PREVIEW_LIMIT`) instead.
 */
export function ActivityFeed({
  items,
  loading,
  failed = false,
}: ActivityFeedProps) {
  const { fmt } = useLocale();

  return (
    <DashboardSection
      id="recent-work"
      title="Recent work"
      className={DASHBOARD_PAIRED_SECTION}
      action={
        <Link
          data-slot="button"
          href="/inbox"
          className={buttonVariants({ variant: 'link', size: 'xs' })}
        >
          Open inbox
        </Link>
      }
    >
      {/* No CardHeader: this card has no controls of its own. */}
      <Card className="min-h-0 flex-1">
        {failed ? (
          <CardContent>
            <EmptyState
              icon={AlertCircle}
              title="Could not load recent work"
              hint="Reload the page to try again."
              className="min-h-32"
            />
          </CardContent>
        ) : loading || !items ? (
          <CardContent className="space-y-2">
            {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
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
          /* Dividers alone separate the rows: the old alternating stripe
             rode on top of them, so every row carried two separators. */
          <ScrollArea className={DASHBOARD_QUEUE_SCROLLER}>
            <ul className="divide-border divide-y">
              {items.map((it) => {
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
                  <li
                    key={it.id}
                    className="hover:bg-muted/40 transition-colors"
                  >
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
          </ScrollArea>
        )}
      </Card>
    </DashboardSection>
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
