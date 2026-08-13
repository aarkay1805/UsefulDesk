'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarClock, CircleAlert, ClipboardCheck } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import {
  loadDashboardFollowUps,
  type DashboardFollowUpMode,
  type DashboardFollowUpRow,
} from '@/lib/dashboard/follow-ups';
import { daysBetween, istAddDays } from '@/lib/memberships/expiry';
import { isRenewalChaseable } from '@/lib/memberships/pricing';
import { useCan } from '@/hooks/use-can';
import { useLocale } from '@/hooks/use-locale';
import type { Membership } from '@/types';
import { CompleteFollowUpDialog } from '@/components/follow-ups/complete-follow-up-dialog';
import { FollowUpCompletionControl } from '@/components/follow-ups/follow-up-completion-control';
import { FollowUpTaskSummary } from '@/components/follow-ups/follow-up-task-summary';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { MemberIdentity } from '@/components/members/member-identity';
import { MemberDetailView } from '@/components/members/member-detail-view';
import { MemberForm } from '@/components/members/member-form';
import { useReminderReadiness } from '@/components/members/send-reminder-button';
import { useAccountStaff } from '@/components/members/use-account-staff';
import {
  Toolbar,
  ToolbarToggleGroup,
  ToolbarToggleItem,
} from '@/components/ui/toolbar';
import { UserAvatar } from '@/components/ui/user-avatar';
import { Skeleton } from './skeleton';

const LIST_LIMIT = 8;
const RENEWAL_WINDOW_DAYS = 7;
type RenewalBucket = 'expiring' | 'expired';

interface MembershipFollowUp extends DashboardFollowUpRow {
  membership_id: string;
  overdueDays: number;
}

interface DashboardMembership {
  id: string;
  end_date: string;
  contact: {
    name: string | null;
    phone: string | null;
    avatar_url: string | null;
  } | null;
  plan: { name: string | null; plan_type: string | null } | null;
}

/**
 * The member counterpart to Today's lead actions. This stays deliberately
 * compact: the full operating queues remain in Members, while the dashboard
 * keeps the next follow-ups and the nearest renewal decisions in view.
 */
export function MembershipActionLists() {
  const canEdit = useCan('send-messages');
  const { fmt } = useLocale();
  const readiness = useReminderReadiness();
  const { nameById, avatarById } = useAccountStaff();
  const [followUps, setFollowUps] = useState<MembershipFollowUp[] | null>(null);
  const [followUpTotal, setFollowUpTotal] = useState(0);
  const [followUpMode, setFollowUpMode] =
    useState<DashboardFollowUpMode | null>(null);
  const [expiring, setExpiring] = useState<DashboardMembership[] | null>(null);
  const [expired, setExpired] = useState<DashboardMembership[] | null>(null);
  const [bucket, setBucket] = useState<RenewalBucket>('expiring');
  const [nonce, setNonce] = useState(0);
  const [completing, setCompleting] = useState<MembershipFollowUp | null>(null);
  const [detailMembershipId, setDetailMembershipId] = useState<string | null>(
    null
  );
  const [editing, setEditing] = useState<Membership | null>(null);

  useEffect(() => {
    void nonce;
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const today = fmt.today();
      const expiringThrough = istAddDays(today, RENEWAL_WINDOW_DAYS);
      const [followUpResult, expiringResult, expiredResult] = await Promise.all(
        [
          loadDashboardFollowUps(supabase, today, LIST_LIMIT, 'member'),
          supabase
            .from('memberships')
            .select(
              'id, end_date, contact:contacts(name, phone, avatar_url), plan:membership_plans(name, plan_type)'
            )
            .eq('is_trial', false)
            .eq('status', 'active')
            .gte('end_date', today)
            .lte('end_date', expiringThrough)
            .order('end_date', { ascending: true }),
          supabase
            .from('memberships')
            .select(
              'id, end_date, contact:contacts(name, phone, avatar_url), plan:membership_plans(name, plan_type)'
            )
            .eq('is_trial', false)
            .eq('status', 'active')
            .lt('end_date', today)
            .order('end_date', { ascending: false }),
        ]
      );
      if (cancelled) return;

      const renewalRows = (rows: DashboardMembership[] | null) =>
        (rows ?? []).filter((membership) =>
          isRenewalChaseable(membership.plan)
        );
      setFollowUps(
        followUpResult.rows
          .filter(
            (
              followUp
            ): followUp is DashboardFollowUpRow & {
              membership_id: string;
            } => Boolean(followUp.membership_id)
          )
          .map((followUp) => ({
            ...followUp,
            overdueDays: daysBetween(followUp.due_date, today),
          }))
      );
      setFollowUpTotal(followUpResult.total);
      setFollowUpMode(followUpResult.mode);
      setExpiring(
        renewalRows(expiringResult.data as DashboardMembership[] | null)
      );
      setExpired(
        renewalRows(expiredResult.data as DashboardMembership[] | null)
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [fmt, nonce]);

  const renewals = bucket === 'expiring' ? expiring : expired;
  const renewalTotal = renewals?.length ?? 0;
  const actionTotal =
    (followUpMode === 'due' ? followUpTotal : 0) +
    (expiring?.length ?? 0) +
    (expired?.length ?? 0);

  return (
    <section className="border-border bg-card rounded-xl border">
      <header className="border-border border-b px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-foreground text-sm font-semibold">
              Member work
            </h2>
            {followUps !== null && expiring !== null && expired !== null && (
              <Badge variant={actionTotal > 0 ? 'warning' : 'success'}>
                {actionTotal} to do
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Follow-ups and renewals to finish.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-2">
        <div>
          <QueueHeading
            label={
              followUpMode === 'upcoming'
                ? 'Next follow-ups'
                : 'Follow-ups to do'
            }
          />
          {followUps === null ? (
            <ListSkeleton />
          ) : followUps.length === 0 ? (
            <QueueEmpty
              icon={ClipboardCheck}
              text={
                followUpMode === 'upcoming'
                  ? 'No follow-ups are due or coming up.'
                  : 'No follow-ups are due today.'
              }
            />
          ) : (
            <ul className="border-border/60 divide-border/60 bg-muted/20 divide-y overflow-hidden rounded-lg border">
              {followUps.map((followUp) => {
                const name =
                  followUp.contact?.name?.trim() ||
                  followUp.contact?.phone ||
                  'Member';
                const assignee = followUp.assigned_to
                  ? (nameById.get(followUp.assigned_to) ?? 'Teammate')
                  : null;
                return (
                  <li
                    key={followUp.id}
                    className="hover:bg-muted/50 flex cursor-pointer items-center gap-2.5 px-2.5 py-2 transition-colors"
                    tabIndex={0}
                    aria-label={`Open ${name} details`}
                    onClick={() =>
                      setDetailMembershipId(followUp.membership_id)
                    }
                    onKeyDown={(event) => {
                      if (event.currentTarget !== event.target) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setDetailMembershipId(followUp.membership_id);
                      }
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <FollowUpTaskSummary
                        taskType={followUp.task_type}
                        note={followUp.note}
                        label={name}
                        reason={followUp.reason}
                      />
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {followUpMode === 'upcoming' ? (
                        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                          {fmt.date(followUp.due_date)}
                        </span>
                      ) : (
                        <Badge
                          variant={
                            followUp.overdueDays > 0 ? 'danger' : 'warning'
                          }
                        >
                          {followUp.overdueDays > 0
                            ? `Overdue ${followUp.overdueDays}d`
                            : 'Today'}
                        </Badge>
                      )}
                      {assignee && (
                        <UserAvatar
                          name={assignee}
                          src={
                            followUp.assigned_to
                              ? avatarById.get(followUp.assigned_to)
                              : null
                          }
                          className="size-5 shrink-0"
                          fallbackClassName="text-[10px]"
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
                        ariaLabel={`Complete follow-up for ${name}`}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <Toolbar aria-label="Membership renewal status">
              <ToolbarToggleGroup<RenewalBucket>
                aria-label="Membership renewal status"
                value={[bucket]}
                onValueChange={(next) => next[0] && setBucket(next[0])}
              >
                <ToolbarToggleItem
                  value="expiring"
                  aria-label="Expiring memberships"
                >
                  <CalendarClock className="size-3.5" />
                  <span>Expiring</span>
                  <Badge variant="neutral" size="count">
                    {expiring?.length ?? 0}
                  </Badge>
                </ToolbarToggleItem>
                <ToolbarToggleItem
                  value="expired"
                  aria-label="Expired memberships"
                >
                  <CircleAlert className="size-3.5" />
                  <span>Expired</span>
                  <Badge variant="neutral" size="count">
                    {expired?.length ?? 0}
                  </Badge>
                </ToolbarToggleItem>
              </ToolbarToggleGroup>
            </Toolbar>
            <Link
              data-slot="button"
              href="/members?view=renewals"
              className={buttonVariants({ variant: 'link', size: 'xs' })}
            >
              See all
            </Link>
          </div>
          {renewals === null ? (
            <ListSkeleton />
          ) : renewals.length === 0 ? (
            <QueueEmpty
              icon={CalendarClock}
              text={
                bucket === 'expiring'
                  ? 'No memberships expiring in the next 7 days.'
                  : 'No memberships have expired.'
              }
            />
          ) : (
            <ul className="border-border/60 divide-border/60 bg-muted/20 divide-y overflow-hidden rounded-lg border">
              {renewals.slice(0, LIST_LIMIT).map((membership) => {
                const days = daysBetween(fmt.today(), membership.end_date);
                return (
                  <li
                    key={membership.id}
                    className="hover:bg-muted/50 transition-colors"
                  >
                    <Link
                      href={`/members?view=renewals&member=${encodeURIComponent(membership.id)}`}
                      className="flex items-center gap-3 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <MemberIdentity
                          name={membership.contact?.name}
                          secondary={membership.contact?.phone}
                          src={membership.contact?.avatar_url}
                          meta={membership.plan?.name ?? undefined}
                        />
                      </div>
                      <Badge
                        variant={bucket === 'expired' ? 'danger' : 'warning'}
                      >
                        {bucket === 'expired'
                          ? `Expired ${Math.abs(days)}d`
                          : days === 0
                            ? 'Expires today'
                            : `Expires in ${days}d`}
                      </Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {renewalTotal > LIST_LIMIT && (
            <p className="text-muted-foreground mt-2 text-right text-xs tabular-nums">
              Showing {LIST_LIMIT} of {renewalTotal}
            </p>
          )}
        </div>
      </div>
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
          context="member"
          onSaved={() => {
            setCompleting(null);
            setNonce((value) => value + 1);
          }}
        />
      )}
      <MemberDetailView
        membershipId={detailMembershipId}
        open={Boolean(detailMembershipId)}
        reloadKey={nonce}
        onOpenChange={(open) => {
          if (!open) setDetailMembershipId(null);
        }}
        readiness={readiness}
        onChanged={() => setNonce((value) => value + 1)}
        onEdit={setEditing}
      />
      <MemberForm
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        member={editing}
        onSaved={() => setNonce((value) => value + 1)}
      />
    </section>
  );
}

function QueueHeading({ label }: { label: string }) {
  return (
    <div className="text-muted-foreground mb-2 flex items-center gap-2 text-xs font-medium">
      <span>{label}</span>
      <Link
        data-slot="button"
        href="/members?view=followups"
        className={buttonVariants({ variant: 'link', size: 'xs' })}
      >
        See all
      </Link>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}

function QueueEmpty({
  icon: Icon,
  text,
}: {
  icon: typeof CalendarClock;
  text: string;
}) {
  return (
    <div className="border-border text-muted-foreground flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-xs">
      <Icon className="size-4 shrink-0" />
      {text}
    </div>
  );
}
