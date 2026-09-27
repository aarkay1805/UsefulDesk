'use client';

import { AlertCircle, UserRoundSearch } from 'lucide-react';

import { BranchLink as Link } from '@/components/layout/branch-link';
import { waitingLabel } from '@/lib/dashboard/queue-labels';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { UserAvatar } from '@/components/ui/user-avatar';
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
 * Enquiries still in "New" with no recorded contact attempt: no staff
 * WhatsApp message that went out, and no follow-up marked done. Automated
 * replies never count, and a fresh enquiry appears at once — waiting a day
 * before it showed up here cost the most recoverable interest. Newest first,
 * so this morning's enquiry is never buried under an old backlog.
 *
 * Staff clear a row by messaging the enquirer, by moving the enquiry out of
 * New after an offline call (for example to Contacted), or by marking a
 * follow-up done with its outcome. The definition lives in the dashboard
 * snapshot SQL; see `20260927120000_home_queue_definitions.sql`.
 *
 * No "See all": no Enquiries view shows exactly this set. Do not link this to
 * a page that shows a different one.
 */

export function UncontactedLeads() {
  const { snapshot, failed } = useDashboardActions();
  const queue = snapshot?.uncontactedLeads ?? null;
  const sectionFailed =
    failed || snapshot?.errors.includes('uncontactedLeads') === true;
  const leads = queue?.rows ?? null;
  const total = queue?.total ?? 0;
  const shown = leads?.length ?? 0;
  const listShown = !sectionFailed && shown > 0;

  return (
    <DashboardSection
      id="not-contacted-yet"
      title="Not contacted yet"
      className={DASHBOARD_PAIRED_SECTION}
      action={<QueueCount shown={shown} total={total} />}
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
                title="Could not load these enquiries"
                hint="Reload the page to try again."
                className="min-h-32"
              />
            ) : leads === null ? (
              <QueueSkeleton rowClassName="h-11" />
            ) : leads.length === 0 ? (
              <QueueEmpty
                icon={UserRoundSearch}
                text="Your team has contacted every new enquiry."
              />
            ) : (
              <ul className={QUEUE_LIST}>
                {leads.map((lead) => {
                  const displayName = lead.name?.trim() || 'No name';
                  return (
                    <li key={lead.id}>
                      <Link
                        href={`/leads?contact=${encodeURIComponent(lead.id)}&focus=followup`}
                        className="hover:bg-muted/50 flex items-center gap-3 px-2 py-2 transition-colors"
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
                        <Badge variant="info">
                          {waitingLabel(lead.waitingMinutes)}
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
