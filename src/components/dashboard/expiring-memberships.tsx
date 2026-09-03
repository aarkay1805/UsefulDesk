'use client';

import { AlertCircle, CalendarClock } from 'lucide-react';

import { BranchLink as Link } from '@/components/layout/branch-link';
import { daysBetween } from '@/lib/memberships/expiry';
import { DASHBOARD_RENEWAL_WINDOW_DAYS } from '@/lib/dashboard/action-snapshot';
import { MemberIdentity } from '@/components/members/member-identity';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  QUEUE_LIST,
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
 * Memberships ending inside the renewal window that nobody has scheduled work
 * for yet. Its own section since follow-ups moved into one merged queue —
 * these are the renewals that have not become a follow-up.
 *
 * Expired recovery stays in the full Renewals queue; this is the near window
 * only. `Renewals due` in Today at a glance counts the same population, which
 * is why this heading names the memberships rather than repeating that label.
 */

export function ExpiringMemberships() {
  const { snapshot, failed } = useDashboardActions();
  const queue = snapshot?.expiringMemberships ?? null;
  const sectionFailed =
    failed || snapshot?.errors.includes('expiringMemberships') === true;
  const expiring = queue?.rows ?? null;
  const total = queue?.total ?? 0;
  const shown = expiring?.length ?? 0;

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
        <ScrollArea className={DASHBOARD_QUEUE_SCROLLER}>
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
                text={`No memberships expiring in the next ${DASHBOARD_RENEWAL_WINDOW_DAYS} days.`}
              />
            ) : (
              <ul className={`${QUEUE_LIST} -my-2`}>
                {expiring.map((membership) => {
                  const days = daysBetween(
                    snapshot?.today ?? '',
                    membership.end_date
                  );
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
                            meta={membership.plan?.name ?? undefined}
                          />
                        </div>
                        <Badge variant="warning">
                          {days === 0 ? 'Expires today' : `Expires in ${days}d`}
                        </Badge>
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
