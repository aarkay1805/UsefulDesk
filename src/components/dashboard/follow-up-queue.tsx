'use client';

import { useEffect, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';

import { BranchLink as Link } from '@/components/layout/branch-link';
import { createClient } from '@/lib/supabase/client';
import {
  loadDashboardFollowUpCounts,
  loadDashboardFollowUps,
  type DashboardFollowUpCounts,
  type DashboardFollowUpRow,
  type DashboardFollowUpScope,
} from '@/lib/dashboard/follow-ups';
import { followUpDueState } from '@/lib/follow-ups/due-state';
import { useCan } from '@/hooks/use-can';
import { useLocale } from '@/hooks/use-locale';
import type { Membership } from '@/types';
import { CompleteFollowUpDialog } from '@/components/follow-ups/complete-follow-up-dialog';
import { FollowUpCompletionControl } from '@/components/follow-ups/follow-up-completion-control';
import { FollowUpTaskSummary } from '@/components/follow-ups/follow-up-task-summary';
import { ContactDetailView } from '@/components/contacts/contact-detail-view';
import { MemberDetailView } from '@/components/members/member-detail-view';
import { MemberForm } from '@/components/members/member-form';
import { useReminderReadiness } from '@/components/members/send-reminder-button';
import { useAccountStaff } from '@/components/members/use-account-staff';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Chip, ChipCount, ChipGroup } from '@/components/ui/chip';
import { UserAvatar } from '@/components/ui/user-avatar';
import { QUEUE_LIST, QueueEmpty, QueueSkeleton } from './action-queue';
import { DashboardSection } from './dashboard-section';

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

const LIST_LIMIT = 8;

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

export function FollowUpQueue() {
  const canEdit = useCan('send-messages');
  const { fmt } = useLocale();
  const readiness = useReminderReadiness();
  const { nameById, avatarById } = useAccountStaff();

  const [scope, setScope] = useState<DashboardFollowUpScope>('all');
  const [rows, setRows] = useState<DashboardFollowUpRow[] | null>(null);
  const [counts, setCounts] = useState<DashboardFollowUpCounts | null>(null);
  const [nonce, setNonce] = useState(0);

  const [completing, setCompleting] = useState<DashboardFollowUpRow | null>(
    null
  );
  const [detailContactId, setDetailContactId] = useState<string | null>(null);
  const [detailMembershipId, setDetailMembershipId] = useState<string | null>(
    null
  );
  const [editing, setEditing] = useState<Membership | null>(null);

  // Counts and rows load separately: the chips must keep their totals while a
  // scope change refetches only the list they filter.
  useEffect(() => {
    void nonce;
    let cancelled = false;
    (async () => {
      try {
        const next = await loadDashboardFollowUpCounts(createClient());
        if (!cancelled) setCounts(next);
      } catch (error) {
        console.error('[dashboard] follow-up counts failed:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  useEffect(() => {
    void nonce;
    let cancelled = false;
    (async () => {
      try {
        const next = await loadDashboardFollowUps(
          createClient(),
          LIST_LIMIT,
          scope
        );
        if (!cancelled) setRows(next);
      } catch (error) {
        console.error('[dashboard] follow-up queue failed:', error);
        if (!cancelled) setRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce, scope]);

  const today = fmt.today();
  const href = SCOPE_HREF[scope];
  const reload = () => setNonce((value) => value + 1);

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
          {rows === null ? (
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
            <ul className={`${QUEUE_LIST} -my-2`}>
              {rows.map((followUp) => {
                const isMember = isMemberFollowUp(followUp);
                const who =
                  followUp.contact?.name?.trim() ||
                  followUp.contact?.phone ||
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
                    // Wraps on its own terms: the trailing cluster runs ~194px,
                    // so on a phone it drops to a second line instead of
                    // squeezing the person's name into 107px.
                    className="hover:bg-muted/50 flex cursor-pointer flex-wrap items-center gap-x-2.5 gap-y-1.5 px-2 py-2 transition-colors"
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
                    <div className="min-w-0 grow basis-48">
                      <FollowUpTaskSummary
                        taskType={followUp.task_type}
                        note={followUp.note}
                        label={who}
                        // Reason is member context only — see ui-patterns.
                        reason={isMember ? followUp.reason : undefined}
                      />
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-2">
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
      <ContactDetailView
        open={Boolean(detailContactId)}
        onOpenChange={(open) => {
          if (!open) setDetailContactId(null);
        }}
        contactId={detailContactId}
        onUpdated={reload}
      />
      <MemberDetailView
        membershipId={detailMembershipId}
        open={Boolean(detailMembershipId)}
        reloadKey={nonce}
        onOpenChange={(open) => {
          if (!open) setDetailMembershipId(null);
        }}
        readiness={readiness}
        onChanged={reload}
        onEdit={setEditing}
      />
      <MemberForm
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        member={editing}
        onSaved={reload}
      />
    </DashboardSection>
  );
}
