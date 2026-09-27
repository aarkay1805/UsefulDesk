'use client';

import {
  AlertCircle,
  ChevronRight,
  CircleCheck,
  FlaskConical,
  ShieldAlert,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { BranchLink as Link } from '@/components/layout/branch-link';
import { useLocale } from '@/hooks/use-locale';
import type { DashboardAutoPayProblem } from '@/lib/dashboard/action-snapshot';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { UserAvatar } from '@/components/ui/user-avatar';
import {
  QUEUE_LIST,
  QUEUE_SCROLL_INSET,
  QueueEmpty,
  QueueSkeleton,
} from './action-queue';
import {
  DASHBOARD_PAIRED_SECTION,
  DASHBOARD_QUEUE_SCROLLER,
  DashboardSection,
} from './dashboard-section';
import { EmptyState } from './empty-state';
import { useDashboardActions } from './dashboard-actions';

const AUTO_PAY_REASON: Record<DashboardAutoPayProblem, string> = {
  setup_failed: 'AutoPay could not be set up',
  stopped: 'AutoPay stopped after payments failed',
};

const ROW =
  'hover:bg-muted/50 flex items-center gap-3 px-2 py-2 transition-colors';

/**
 * The exceptions no other Home queue owns, and only the ones that exist
 * today. Renewals due, fees to collect, and members not coming deliberately
 * do NOT appear here — Today at a glance already carries those numbers and
 * links to the same destinations.
 *
 * Every row opens exactly the people it counts. Trials open the Trials page,
 * which applies the same window and the same Not interested retirement.
 * May leave opens All members filtered to Active + May leave, the population
 * counted here. No page lists AutoPay problems, so those rows are the people
 * themselves and each opens that member, whose Billing section holds the
 * recovery. A zero never takes a row: the section shrinks to one quiet line
 * rather than spending the same space every day on nothing.
 */
export function NeedsAttentionCard() {
  const { fmt } = useLocale();
  const { snapshot, failed } = useDashboardActions();
  const attention = snapshot?.attention ?? null;
  const sectionFailed =
    failed || snapshot?.errors.includes('attention') === true;

  const counts: {
    label: string;
    detail: string;
    value: number;
    icon: LucideIcon;
    href: string;
  }[] = attention
    ? [
        {
          label: 'Trials to follow up',
          detail: 'Ending this week, or ended without joining',
          value: attention.trials,
          icon: FlaskConical,
          href: '/members?view=trials',
        },
        {
          label: 'May leave',
          detail: 'Active members your team marked',
          value: attention.mayLeave,
          icon: ShieldAlert,
          href: '/members?view=all&filter=may-leave',
        },
      ].filter((item) => item.value > 0)
    : [];
  const autoPay = attention?.autoPay ?? null;
  const empty = counts.length === 0 && (autoPay?.rows.length ?? 0) === 0;
  const listShown = !sectionFailed && attention !== null && !empty;

  return (
    <DashboardSection
      id="needs-attention"
      title="Needs attention"
      className={DASHBOARD_PAIRED_SECTION}
    >
      <Card className="min-h-0 flex-1">
        <ScrollArea
          className={
            listShown
              ? `${DASHBOARD_QUEUE_SCROLLER} ${QUEUE_SCROLL_INSET}`
              : DASHBOARD_QUEUE_SCROLLER
          }
        >
          <CardContent>
            {sectionFailed ? (
              <EmptyState
                icon={AlertCircle}
                title="Could not load these lists"
                hint="Reload the page to try again."
                className="min-h-32"
              />
            ) : !attention ? (
              <QueueSkeleton rowClassName="h-11" />
            ) : empty ? (
              <QueueEmpty
                icon={CircleCheck}
                text="No trials to follow up, AutoPay problems, or members marked “May leave”."
              />
            ) : (
              <>
                <ul className={QUEUE_LIST}>
                  {counts.map((item) => (
                    <li key={item.label}>
                      <Link href={item.href} className={ROW}>
                        <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
                          <item.icon className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="text-foreground block truncate text-sm font-medium">
                            {item.label}
                          </span>
                          <span className="text-muted-foreground block text-xs">
                            {item.detail}
                          </span>
                        </span>
                        <span className="text-foreground shrink-0 text-base font-semibold tabular-nums">
                          {fmt.number(item.value)}
                        </span>
                        <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                      </Link>
                    </li>
                  ))}
                  {autoPay?.rows.map((row) => {
                    const name = row.name?.trim() || 'Member';
                    return (
                      <li key={row.membershipId}>
                        <Link
                          href={`/members?view=all&member=${encodeURIComponent(row.membershipId)}`}
                          className={ROW}
                        >
                          <UserAvatar
                            name={name}
                            src={row.avatarUrl}
                            className="shrink-0"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="text-foreground block truncate text-sm font-medium">
                              {name}
                            </span>
                            <span className="text-muted-foreground block truncate text-xs">
                              {AUTO_PAY_REASON[row.problem]}
                            </span>
                          </span>
                          <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                {autoPay && autoPay.total > autoPay.rows.length ? (
                  <p className="text-muted-foreground my-2 text-xs">
                    Showing {fmt.number(autoPay.rows.length)} of{' '}
                    {fmt.number(autoPay.total)} AutoPay problems.
                  </p>
                ) : null}
              </>
            )}
          </CardContent>
        </ScrollArea>
      </Card>
    </DashboardSection>
  );
}
