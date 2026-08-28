'use client';

import { AlertCircle, UserRoundSearch } from 'lucide-react';

import { BranchLink as Link } from '@/components/layout/branch-link';
import { DASHBOARD_UNCONTACTED_HOURS } from '@/lib/dashboard/action-snapshot';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { UserAvatar } from '@/components/ui/user-avatar';
import {
  QUEUE_LIST,
  QueueCount,
  QueueEmpty,
  QueueSkeleton,
} from './action-queue';
import { DashboardSection } from './dashboard-section';
import { EmptyState } from './empty-state';
import { useDashboardActions } from './dashboard-actions';

/**
 * Leads still sitting in "New" past the first-response window — nobody has
 * replied to them. Its own section since follow-ups moved into one merged
 * queue; these are the leads that never became a follow-up at all.
 *
 * No "See all": `/leads` routes only `all | followups`, and the first-response
 * accountability view is not reachable from its tabs. Do not link this to a
 * page that shows a different set.
 */

export function UncontactedLeads() {
  const { snapshot, failed } = useDashboardActions();
  const queue = snapshot?.uncontactedLeads ?? null;
  const sectionFailed =
    failed || snapshot?.errors.includes('uncontactedLeads') === true;
  const leads = queue?.rows ?? null;
  const total = queue?.total ?? 0;
  const shown = leads?.length ?? 0;

  return (
    <DashboardSection
      id="not-contacted-yet"
      title="Not contacted yet"
      className="flex flex-col"
      action={<QueueCount shown={shown} total={total} />}
    >
      <Card className="flex-1">
        <CardContent>
          {sectionFailed ? (
            <EmptyState
              icon={AlertCircle}
              title="Could not load uncontacted leads"
              hint="Reload the page to try again."
              className="min-h-32"
            />
          ) : leads === null ? (
            <QueueSkeleton rowClassName="h-11" />
          ) : leads.length === 0 ? (
            <QueueEmpty
              icon={UserRoundSearch}
              text={`Every lead older than ${DASHBOARD_UNCONTACTED_HOURS} hours has been picked up.`}
            />
          ) : (
            <ul className={`${QUEUE_LIST} -my-2.5`}>
              {leads.map((lead) => {
                const displayName = lead.name?.trim() || 'Unnamed lead';
                return (
                  <li key={lead.id}>
                    <Link
                      href={`/leads?contact=${encodeURIComponent(lead.id)}&focus=followup`}
                      className="hover:bg-muted/50 flex items-center gap-3 px-2 py-2.5 transition-colors"
                    >
                      <UserAvatar
                        name={displayName}
                        src={lead.avatarUrl}
                        className="size-8 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground truncate text-sm font-medium">
                          {displayName}
                        </p>
                        <p className="text-muted-foreground mt-0.5 truncate text-xs">
                          {lead.messagePreview}
                        </p>
                      </div>
                      <Badge variant="info">Waiting {lead.waitingDays}d</Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </DashboardSection>
  );
}
