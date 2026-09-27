'use client';

import { AlertCircle, CalendarClock } from 'lucide-react';

import { BranchLink as Link } from '@/components/layout/branch-link';
import { useLocale } from '@/hooks/use-locale';
import { daysBetween } from '@/lib/memberships/expiry';
import { DASHBOARD_RENEWAL_WINDOW_DAYS } from '@/lib/dashboard/action-snapshot';
import { expiryBadge, followUpContext } from '@/lib/dashboard/queue-labels';
import { MemberIdentity } from '@/components/members/member-identity';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  QUEUE_LIST,
  QUEUE_SCROLL_INSET,
  QueueCount,
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

/**
 * Every renewal-chased membership ending inside the seven-day window, nearest
 * expiry first — including members who already have a follow-up. Those rows
 * say so (when it is due, and who owns it) instead of disappearing, so the
 * reader sees the work that exists and never opens a competing follow-up;
 * the database allows only one open follow-up per person anyway.
 *
 * Expired recovery stays in the full Renewals queue; this is the near window
 * only. `Renewals due` in Today at a glance counts the same population, and
 * See all opens Renewals on the same Next 7 days window.
 */

export function ExpiringMemberships() {
  const { fmt } = useLocale();
  const { snapshot, failed } = useDashboardActions();
  const queue = snapshot?.expiringMemberships ?? null;
  const sectionFailed =
    failed || snapshot?.errors.includes('expiringMemberships') === true;
  const expiring = queue?.rows ?? null;
  const total = queue?.total ?? 0;
  const shown = expiring?.length ?? 0;
  const today = snapshot?.today ?? fmt.today();
  const listShown = !sectionFailed && shown > 0;

  return (
    <DashboardSection
      id="expiring-memberships"
      title="Expiring memberships"
      className={DASHBOARD_PAIRED_SECTION}
      action={
        <div className="flex items-center gap-2">
          <QueueCount shown={shown} total={total} />
          <Link
            data-slot="button"
            href="/members?view=renewals"
            className={buttonVariants({ variant: 'link', size: 'xs' })}
          >
            See all
          </Link>
        </div>
      }
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
                title="Could not load expiring memberships"
                hint="Reload the page to try again."
                className="min-h-32"
              />
            ) : expiring === null ? (
              <QueueSkeleton rowClassName="h-11" />
            ) : expiring.length === 0 ? (
              <QueueEmpty
                icon={CalendarClock}
                text={`No memberships expire in the next ${DASHBOARD_RENEWAL_WINDOW_DAYS} days.`}
              />
            ) : (
              <ul className={QUEUE_LIST}>
                {expiring.map((membership) => {
                  const badge = expiryBadge(
                    daysBetween(today, membership.end_date)
                  );
                  const context = [
                    membership.plan?.name,
                    membership.followUp &&
                      followUpContext(membership.followUp, today, (date) =>
                        fmt.date(date)
                      ),
                  ].filter(Boolean);
                  return (
                    <li
                      key={membership.id}
                      className="hover:bg-muted/50 transition-colors"
                    >
                      <Link
                        href={`/members?view=renewals&member=${encodeURIComponent(membership.id)}`}
                        className="flex items-center gap-3 px-2 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <MemberIdentity
                            name={membership.contact?.name}
                            secondary={membership.contact?.phone}
                            src={membership.contact?.avatar_url}
                            meta={
                              context.length > 0
                                ? context.join(' · ')
                                : undefined
                            }
                          />
                        </div>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </ScrollArea>
      </Card>
    </DashboardSection>
  );
}
