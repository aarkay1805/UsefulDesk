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
import { useCan } from '@/hooks/use-can';
import { useLocale } from '@/hooks/use-locale';
import type { Membership } from '@/types';
import { FollowUpCompletionControl } from '@/components/follow-ups/follow-up-completion-control';
import {
  FollowUpTaskLabel,
  FollowUpTaskNote,
} from '@/components/follow-ups/follow-up-task-summary';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Chip, ChipCount, ChipGroup } from '@/components/ui/chip';
import { UserAvatar } from '@/components/ui/user-avatar';
import { QUEUE_LIST, QueueEmpty, QueueSkeleton } from './action-queue';
import { useDashboardActions } from './dashboard-actions';
import { DashboardSection } from './dashboard-section';
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
 * The row is a record laid out in columns, the way a mail list puts sender,
 * subject, and date in their own tracks. It used to be a subject pinned to the
 * left edge and a state cluster pinned to the right by `ml-auto`, with ~965px
 * of nothing between them at a 1600px viewport — a reading cost at 100% zoom
 * and two disconnected halves at 200%, because the two ends of one record were
 * never on screen together.
 *
 * The note is what fixes that: promoted out of a subtitle into the flexible
 * track, it is the one field with enough content to carry the width, so the
 * queue spans the container edge to edge on real text rather than on gutter.
 * It also stops being clipped at the 14rem the stacked cell caps it to.
 *
 * The name track is `fit-content(16rem)`: short names keep the note close, one
 * long name widens the column for every row rather than for itself, and no row
 * pays for a width the queue does not use.
 *
 * `auto` for the meta tracks, never fixed widths — the due cell holds a badge
 * or a **localized** medium date, so only content sizing survives a change of
 * account locale. A right-anchored flex cluster gave `Lead`+`Overdue` (185px)
 * and `Member`+`22 Feb 2027` (212px) different x, so no two rows agreed where
 * the state column was and the queue could not be scanned downward for what is
 * late. Each row re-enters this template through `subgrid`, the same way
 * `lead-funnel` aligns its stage rows.
 */
const FOLLOW_UP_GRID =
  'sm:grid sm:grid-cols-[fit-content(16rem)_minmax(0,1fr)_auto_auto_auto_auto] sm:gap-x-2.5';
/** Same template minus the Lead/Member column, which only the All chip shows. */
const FOLLOW_UP_GRID_NO_KIND =
  'sm:grid sm:grid-cols-[fit-content(16rem)_minmax(0,1fr)_auto_auto_auto] sm:gap-x-2.5';
/**
 * Below `sm` there is no width to distribute and no room for a third text
 * column, so the row keeps the wrapping flex line it has always had: name,
 * then the note on its own full-width line, then the trailing cluster. The
 * grid starts where the slack does.
 */
const FOLLOW_UP_ROW =
  'flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-2 py-2 sm:col-span-full sm:grid sm:grid-cols-subgrid sm:gap-y-0';

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
      action={
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
      <Card>
        {/* The card header carries the control, never a second copy of the
            section title above it. */}
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
        <CardContent>
          {sectionFailed ? (
            <EmptyState
              icon={AlertCircle}
              title="Could not load follow-ups"
              hint="Reload the page to try again."
              className="min-h-32"
            />
          ) : rows === null ? (
            <QueueSkeleton rowClassName="h-11" />
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
                scope === 'all' ? FOLLOW_UP_GRID : FOLLOW_UP_GRID_NO_KIND
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
                    <div className="min-w-0 grow basis-48 sm:basis-auto">
                      <FollowUpTaskLabel
                        taskType={followUp.task_type}
                        label={who}
                        // Reason is member context only — see ui-patterns.
                        reason={isMember ? followUp.reason : undefined}
                      />
                    </div>
                    {/* Always a cell at `sm` so a note-less row keeps the
                        column count and the meta stays aligned with the rows
                        around it. On a phone it drops out of flow instead,
                        where an empty item would only buy a stray row gap. */}
                    <div
                      className={
                        followUp.note
                          ? 'min-w-0 basis-full ps-6 sm:basis-auto sm:ps-0'
                          : 'hidden min-w-0 sm:block'
                      }
                    >
                      {followUp.note && (
                        <FollowUpTaskNote
                          note={followUp.note}
                          variant="column"
                        />
                      )}
                    </div>
                    {/* One wrapper on a phone so the cluster wraps as a
                        unit; `contents` dissolves it at `sm` so each part
                        becomes a real cell in the row's subgrid. */}
                    <div className="ml-auto flex shrink-0 items-center gap-2 sm:contents">
                      {/* Under a single-scope chip every row is the same kind,
                          so the tag would say nothing. It earns its place only
                          in the mixed list. */}
                      {scope === 'all' && (
                        <Badge variant="neutral">
                          {isMember ? 'Member' : 'Lead'}
                        </Badge>
                      )}
                      {dueState ? (
                        <Badge variant={dueState.variant}>
                          {dueState.label}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {fmt.date(followUp.due_date)}
                        </span>
                      )}
                      {assignee && (
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
