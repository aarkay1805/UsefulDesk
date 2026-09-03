'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { AlertCircle, ClipboardCheck } from 'lucide-react';

import { BranchLink as Link } from '@/components/layout/branch-link';
import {
  type DashboardFollowUpRow,
  type DashboardFollowUpScope,
} from '@/lib/dashboard/follow-ups';
import { followUpDueState } from '@/lib/follow-ups/due-state';
import { REASON_LABEL } from '@/lib/memberships/follow-ups';
import { useCan } from '@/hooks/use-can';
import { useLocale } from '@/hooks/use-locale';
import type { Membership } from '@/types';
import { FollowUpCompletionControl } from '@/components/follow-ups/follow-up-completion-control';
import { FollowUpTaskLine } from '@/components/follow-ups/follow-up-task-summary';
import { MemberIdentity } from '@/components/members/member-identity';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Chip, ChipCount, ChipGroup } from '@/components/ui/chip';
import { UserAvatar } from '@/components/ui/user-avatar';
import { QUEUE_LIST, QueueEmpty, QueueSkeleton } from './action-queue';
import { useDashboardActions } from './dashboard-actions';
import {
  DASHBOARD_PAIRED_SECTION,
  DASHBOARD_QUEUE_SCROLLER,
  DashboardSection,
} from './dashboard-section';
import { EmptyState } from './empty-state';

const CompleteFollowUpDialog = dynamic(() =>
  import('@/components/follow-ups/complete-follow-up-dialog').then(
    (module) => module.CompleteFollowUpDialog
  )
);
const ContactDetailView = dynamic(() =>
  import('@/components/contacts/contact-detail-view').then(
    (module) => module.ContactDetailView
  )
);
const DashboardMemberDetail = dynamic(() =>
  import('./dashboard-member-detail').then(
    (module) => module.DashboardMemberDetail
  )
);
const MemberForm = dynamic(() =>
  import('@/components/members/member-form').then((module) => module.MemberForm)
);

/**
 * The day's committed work, in one list.
 *
 * The dashboard used to split this by who the follow-up was about — a Lead
 * work queue and a Member work queue, each with its own follow-up column.
 * That is not how the work arrives: an owner clearing follow-ups wants every
 * task in due order, not two lists to reconcile. Scope became a filter chip
 * instead, and the queues that are NOT follow-ups (expiring memberships,
 * uncontacted leads) became sections of their own.
 */

const SCOPES: { value: DashboardFollowUpScope; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'lead', label: 'Leads' },
  { value: 'member', label: 'Members' },
];

/** Only Leads and Members have a page that owns the whole queue. */
const SCOPE_HREF: Partial<Record<DashboardFollowUpScope, string>> = {
  lead: '/leads?view=followups',
  member: '/members?view=followups',
};

const isMemberFollowUp = (
  followUp: DashboardFollowUpRow
): followUp is DashboardFollowUpRow & { membership_id: string } =>
  Boolean(followUp.membership_id);

/**
 * The member-only Reason, in the column the row aligns on.
 *
 * A row used to carry a `Lead`/`Member` kind tag as well — beside the Reason
 * on a member row, which is non-nullable and member-only, so the tag repeated
 * what the Reason already said. Naming the side of the business earns nothing
 * on a row that already opens the right detail sheet and is already filterable
 * by chip, so it is gone: a member row is the one with a Reason, and that is
 * the same treatment every other member queue uses.
 *
 * Null under the Leads chip, where no row has one and the column would be
 * empty down the queue.
 */
const followUpReason = (
  followUp: DashboardFollowUpRow,
  scope: DashboardFollowUpScope
): string | null => {
  if (scope === 'lead' || !isMemberFollowUp(followUp)) return null;
  return REASON_LABEL[followUp.reason];
};

/**
 * The row is a record laid out in columns, the way a mail list puts sender,
 * subject, and date in their own tracks. It used to be a subject pinned to the
 * left edge and a state cluster pinned to the right by `ml-auto`, so no two
 * rows agreed where the state column was and the queue could not be scanned
 * downward for what is late. Each row re-enters this template through
 * `subgrid`, the same way `lead-funnel` aligns its stage rows.
 *
 * `auto` for the meta tracks, never fixed widths — the due cell holds a badge
 * or a **localized** medium date, so only content sizing survives a change of
 * account locale.
 *
 * The switch is a **container** query and not a viewport breakpoint: this
 * queue shares a row with Expiring memberships, so the viewport tells it
 * nothing about the width it actually has. `@md` (448px) is the threshold
 * because that is the width the dashboard genuinely hands it — a 1440px
 * viewport leaves this column 568px, and the `@2xl` (672px) it asked for
 * before needed a ~1650px window before a single track appeared. The grid was
 * real on paper and dead on every laptop; the rows below `@2xl` were falling
 * back to the phone layout at 97px each, ragged down the right edge, with
 * four of eight visible inside the card's 480px cap.
 *
 * Below `@md` the row keeps that wrapping flex line, which is still the right
 * shape for a phone: identity cell, then the trailing cluster wrapping under
 * it against the right edge.
 */
const FOLLOW_UP_GRID =
  '@md/follow-ups:grid @md/follow-ups:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] @md/follow-ups:gap-x-2.5';
/** Same template minus the Reason column, which the Leads chip drops. */
const FOLLOW_UP_GRID_NO_REASON =
  '@md/follow-ups:grid @md/follow-ups:grid-cols-[minmax(0,1fr)_auto_auto_auto] @md/follow-ups:gap-x-2.5';
const FOLLOW_UP_ROW =
  'flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-2 py-2 @md/follow-ups:col-span-full @md/follow-ups:grid @md/follow-ups:grid-cols-subgrid @md/follow-ups:gap-y-0';

export function FollowUpQueue() {
  const canEdit = useCan('send-messages');
  const { fmt } = useLocale();
  const { snapshot, failed, refresh } = useDashboardActions();

  const [scope, setScope] = useState<DashboardFollowUpScope>('all');
  const [detailReloadKey, setDetailReloadKey] = useState(0);

  const [completing, setCompleting] = useState<DashboardFollowUpRow | null>(
    null
  );
  const [detailContactId, setDetailContactId] = useState<string | null>(null);
  const [detailMembershipId, setDetailMembershipId] = useState<string | null>(
    null
  );
  const [editing, setEditing] = useState<Membership | null>(null);

  const followUps = snapshot?.followUps ?? null;
  const counts = followUps?.counts ?? null;
  const rows = followUps?.rows[scope] ?? null;
  const nameById = useMemo(
    () =>
      new Map(
        (followUps?.staff ?? []).map((staff) => [
          staff.user_id,
          staff.full_name || 'Teammate',
        ])
      ),
    [followUps?.staff]
  );
  const avatarById = useMemo(
    () =>
      new Map(
        (followUps?.staff ?? []).map((staff) => [
          staff.user_id,
          staff.avatar_url,
        ])
      ),
    [followUps?.staff]
  );
  const sectionFailed =
    failed || snapshot?.errors.includes('followUps') === true;
  const today = snapshot?.today ?? fmt.today();
  const href = SCOPE_HREF[scope];
  const reload = () => {
    setDetailReloadKey((value) => value + 1);
    refresh();
  };

  return (
    <DashboardSection
      id="follow-ups"
      title="Follow-ups"
      className={DASHBOARD_PAIRED_SECTION}
      action={
        // No `QueueCount` here, unlike the sections beside it: the chips
        // already carry the live total of the queue each one filters to, and
        // "8 of 41" would print that 41 a second time one line above it.
        //
        // No link under All: no single page owns both queues, and pointing
        // this at one of them would be a promise the destination can't keep.
        href ? (
          <Link
            data-slot="button"
            href={href}
            className={buttonVariants({ variant: 'link', size: 'xs' })}
          >
            See all
          </Link>
        ) : null
      }
    >
      <Card className="min-h-0 flex-1">
        {/* The card header carries the control, never a second copy of the
            section title above it. It stays put while the queue scrolls. */}
        <CardHeader className="border-b">
          <ChipGroup<DashboardFollowUpScope>
            selectionMode="single"
            value={[scope]}
            onValueChange={(values) => values[0] && setScope(values[0])}
            aria-label="Follow-up scope"
          >
            {SCOPES.map((option) => (
              <Chip key={option.value} value={option.value}>
                {option.label}
                {counts && <ChipCount count={counts[option.value]} />}
              </Chip>
            ))}
          </ChipGroup>
        </CardHeader>
        <ScrollArea className={DASHBOARD_QUEUE_SCROLLER}>
          {/* The row template answers to this column's width, not the
              viewport's — see FOLLOW_UP_GRID. */}
          <CardContent className="@container/follow-ups">
            {sectionFailed ? (
              <EmptyState
                icon={AlertCircle}
                title="Could not load follow-ups"
                hint="Reload the page to try again."
                className="min-h-32"
              />
            ) : rows === null ? (
              // 52px is the loaded row: a name over a note, plus the row's
              // own py-2. The old h-11 was sized for the single-line grid row
              // that only ever rendered above 672px.
              <QueueSkeleton rowClassName="h-13" />
            ) : rows.length === 0 ? (
              <QueueEmpty
                icon={ClipboardCheck}
                text={
                  scope === 'lead'
                    ? 'No open lead follow-ups.'
                    : scope === 'member'
                      ? 'No open member follow-ups.'
                      : 'No open follow-ups. Nothing is waiting on you.'
                }
              />
            ) : (
              <ul
                className={`${QUEUE_LIST} -my-2 ${
                  scope === 'lead' ? FOLLOW_UP_GRID_NO_REASON : FOLLOW_UP_GRID
                }`}
              >
                {rows.map((followUp) => {
                  const isMember = isMemberFollowUp(followUp);
                  const who =
                    followUp.contact?.name?.trim() ||
                    fmt.phone(followUp.contact?.phone) ||
                    (isMember ? 'Member' : 'Lead');
                  const assignee = followUp.assigned_to
                    ? (nameById.get(followUp.assigned_to) ?? 'Teammate')
                    : null;
                  const reason = followUpReason(followUp, scope);
                  const dueState = followUpDueState(
                    'open',
                    followUp.due_date,
                    today
                  );
                  const open = () =>
                    isMember
                      ? setDetailMembershipId(followUp.membership_id)
                      : setDetailContactId(followUp.contact_id);

                  return (
                    <li
                      key={followUp.id}
                      className={`hover:bg-muted/50 cursor-pointer transition-colors ${FOLLOW_UP_ROW}`}
                      tabIndex={0}
                      aria-label={`Open ${who} details`}
                      onClick={open}
                      onKeyDown={(event) => {
                        if (event.currentTarget !== event.target) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          open();
                        }
                      }}
                    >
                      {/* The person leads the row, the way every queue
                        beside this one leads its rows — avatar, name, then a
                        supporting line. It read as a task with a name attached
                        before, which made it the one queue on the dashboard
                        that did not look like the others. `MemberIdentity` is
                        that block; the task moves into its context line. */}
                      <div className="min-w-0 grow basis-48 @md/follow-ups:basis-auto">
                        <MemberIdentity
                          name={who}
                          src={followUp.contact?.avatar_url}
                          meta={
                            <FollowUpTaskLine
                              taskType={followUp.task_type}
                              note={followUp.note}
                            />
                          }
                        />
                      </div>
                      {/* One wrapper on a phone so the cluster wraps as a
                        unit; `contents` dissolves it at `@md` so each part
                        becomes a real cell in the row's subgrid. Every part
                        must then render on EVERY row, or the cells after a
                        missing one shift a track left. */}
                      <div className="ml-auto flex shrink-0 items-center gap-2 @md/follow-ups:contents">
                        {scope !== 'lead' &&
                          (reason ? (
                            <Badge variant="neutral">{reason}</Badge>
                          ) : (
                            // A lead row has no Reason, but the column still
                            // owes the rows below it a cell — see the avatar
                            // placeholder for what an omitted one does to
                            // everything after it.
                            <span
                              aria-hidden
                              className="hidden @md/follow-ups:block"
                            />
                          ))}
                        {dueState ? (
                          <Badge variant={dueState.variant}>
                            {dueState.label}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs tabular-nums">
                            {fmt.date(followUp.due_date)}
                          </span>
                        )}
                        {assignee ? (
                          <UserAvatar
                            name={assignee}
                            src={
                              followUp.assigned_to
                                ? avatarById.get(followUp.assigned_to)
                                : null
                            }
                            size="xs"
                            className="shrink-0"
                            title={`Assigned to ${assignee}`}
                          />
                        ) : (
                          // Holds the avatar's track open on an unassigned
                          // row. Omitting it slid the completion control into
                          // the avatar column, so the one control the reader
                          // aims at was the one that moved. Nothing to hold
                          // open on a phone, where the cluster is a flex line.
                          <span
                            aria-hidden
                            className="hidden size-5 @md/follow-ups:block"
                          />
                        )}
                        <FollowUpCompletionControl
                          status="open"
                          canAct={canEdit}
                          gateReason="complete follow-ups"
                          onMarkDone={(event) => {
                            event.stopPropagation();
                            setCompleting(followUp);
                          }}
                          ariaLabel={`Complete follow-up for ${who}`}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </ScrollArea>
      </Card>

      {completing && (
        <CompleteFollowUpDialog
          open={Boolean(completing)}
          onOpenChange={(open) => {
            if (!open) setCompleting(null);
          }}
          followUp={{
            id: completing.id,
            contact_id: completing.contact_id,
            membership_id: completing.membership_id,
            note: completing.note,
            contact: { name: completing.contact?.name ?? undefined },
          }}
          context={isMemberFollowUp(completing) ? 'member' : 'lead'}
          onSaved={() => {
            setCompleting(null);
            reload();
          }}
        />
      )}
      {detailContactId ? (
        <ContactDetailView
          open
          onOpenChange={(open) => {
            if (!open) setDetailContactId(null);
          }}
          contactId={detailContactId}
          onUpdated={reload}
        />
      ) : null}
      {detailMembershipId && (
        <DashboardMemberDetail
          membershipId={detailMembershipId}
          reloadKey={detailReloadKey}
          onClose={() => setDetailMembershipId(null)}
          onChanged={reload}
          onEdit={setEditing}
        />
      )}
      {editing ? (
        <MemberForm
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          member={editing}
          onSaved={reload}
        />
      ) : null}
    </DashboardSection>
  );
}
