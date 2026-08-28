'use client';

import { BranchLink as Link } from '@/components/layout/branch-link';
import { Fragment } from 'react';
import {
  AlertCircle,
  ChevronRight,
  CreditCard,
  FlaskConical,
  ShieldAlert,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { useLocale } from '@/hooks/use-locale';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { DashboardSection } from './dashboard-section';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';
import { useDashboardActions } from './dashboard-actions';

/**
 * The rule between two peers on the one-row layout. Stacked below `sm` the
 * three already read as separate rows, so it is dropped there rather than
 * adding a horizontal rule the row spacing does not need. `hidden` takes it
 * out of grid flow entirely, so the single-column layout stays three items.
 */
function ItemDivider() {
  return <Separator orientation="vertical" className="hidden sm:block" />;
}

interface AttentionItem {
  label: string;
  detail: string;
  value: number;
  icon: LucideIcon;
  href: string;
}

/**
 * The exceptions no other queue owns. Renewals due, fees to collect, and
 * inactive members deliberately do NOT appear here — "Today at a glance"
 * already carries those three numbers and links to the same destinations,
 * so repeating them made the page state the same work twice.
 */
export function NeedsAttentionCard() {
  const { fmt } = useLocale();
  const { snapshot, failed } = useDashboardActions();
  const attention = snapshot?.attention ?? null;
  const sectionFailed =
    failed || snapshot?.errors.includes('attention') === true;

  const items: AttentionItem[] = attention
    ? [
        {
          label: 'May leave',
          detail: 'Active members marked as at risk',
          value: attention.churnRisk,
          icon: ShieldAlert,
          href: '/members?view=all',
        },
        {
          label: 'Trials to follow up',
          detail: 'Trials ending soon or already ended',
          value: attention.trialFollowups,
          icon: FlaskConical,
          href: '/members?view=trials',
        },
        {
          label: 'Auto-pay problems',
          detail: 'Auto-pay needs to be fixed',
          value: attention.failedMandates,
          icon: CreditCard,
          href: '/members?view=payments',
        },
      ]
    : [];

  return (
    <DashboardSection id="needs-attention" title="Needs attention">
      <Card>
        {/* One track per item with an `auto` rule track between them, so the
            dividers are real grid items rather than borders hung off each
            block's edge. */}
        <CardContent className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
          {sectionFailed ? (
            <EmptyState
              icon={AlertCircle}
              title="Could not load these lists"
              hint="Reload the page to try again."
              className="min-h-32 sm:col-span-full"
            />
          ) : attention ? (
            items.map((item, index) => (
              <Fragment key={item.label}>
                {index > 0 && <ItemDivider />}
                <Link
                  href={item.href}
                  className="hover:bg-muted/60 focus-visible:ring-ring flex min-w-0 items-center gap-3 rounded-lg p-2.5 transition-colors outline-none focus-visible:ring-2"
                >
                  <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                    <item.icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground block truncate text-sm font-medium">
                      {item.label}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {item.detail}
                    </span>
                  </span>
                  <span className="text-foreground shrink-0 text-base font-semibold tabular-nums">
                    {fmt.number(item.value)}
                  </span>
                  <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                </Link>
              </Fragment>
            ))
          ) : (
            Array.from({ length: 3 }, (_, index) => (
              <Fragment key={index}>
                {index > 0 && <ItemDivider />}
                <Skeleton className="h-14 w-full" />
              </Fragment>
            ))
          )}
        </CardContent>
      </Card>
    </DashboardSection>
  );
}
