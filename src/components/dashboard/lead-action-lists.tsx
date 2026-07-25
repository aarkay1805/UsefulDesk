'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { CheckCircle2, Inbox, UserRoundSearch } from 'lucide-react';
import {
  loadDashboardFollowUps,
  type DashboardFollowUpMode,
  type DashboardFollowUpRow,
} from '@/lib/dashboard/follow-ups';
import { daysBetween } from '@/lib/memberships/expiry';
import { useCan } from '@/hooks/use-can';
import { useLocale } from '@/hooks/use-locale';
import { FollowUpTaskSummary } from '@/components/follow-ups/follow-up-task-summary';
import { ContactDetailView } from '@/components/contacts/contact-detail-view';
import { useAccountStaff } from '@/components/members/use-account-staff';
import { CompleteFollowUpDialog } from '@/components/follow-ups/complete-follow-up-dialog';
import { Badge } from '@/components/ui/badge';
import { GatedButton } from '@/components/ui/gated-button';
import { UserAvatar } from '@/components/ui/user-avatar';
import { Skeleton } from './skeleton';

// Today's lead actions — the PRD's "smart queue": not a dashboard to
// admire but a work list to clear. Two queues:
//   1. Follow-ups — due work first; nearest upcoming work when due is empty.
//   2. Waiting for first contact — leads still in "New" after 24h.
// Both deep-link into /leads for the full record.

const STALE_HOURS = 24;
const LIST_LIMIT = 8;

interface DashboardFollowUp extends DashboardFollowUpRow {
  /** Days overdue vs account-local today — computed at fetch time. */
  overdueDays: number;
}

interface StaleLead {
  id: string;
  name: string | null;
  phone: string;
  created_at: string;
  /** Whole days since capture — computed at fetch time (render stays pure). */
  waitingDays: number;
}

export function LeadActionLists() {
  const canEdit = useCan('send-messages');
  const { fmt } = useLocale();
  const { nameById, avatarById } = useAccountStaff();

  const [followUps, setFollowUps] = useState<DashboardFollowUp[] | null>(null);
  const [followUpTotal, setFollowUpTotal] = useState(0);
  const [followUpMode, setFollowUpMode] =
    useState<DashboardFollowUpMode | null>(null);
  const [staleLeads, setStaleLeads] = useState<StaleLead[] | null>(null);
  const [staleTotal, setStaleTotal] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [completing, setCompleting] = useState<DashboardFollowUp | null>(null);
  const [detailContactId, setDetailContactId] = useState<string | null>(null);
  const actionTotal = (followUpMode === 'due' ? followUpTotal : 0) + staleTotal;

  useEffect(() => {
    void nonce; // manual refetch trigger — bump to reload
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const today = fmt.today();
      const staleCutoff = new Date(
        Date.now() - STALE_HOURS * 60 * 60 * 1000
      ).toISOString();

      const [followUpRes, staleRes] = await Promise.all([
        loadDashboardFollowUps(supabase, today, LIST_LIMIT),
        supabase
          .from('contacts')
          .select('id, name, phone, created_at, memberships!left(id)', {
            count: 'exact',
          })
          .is('memberships', null)
          .is('lead_status', null)
          .lt('created_at', staleCutoff)
          .order('created_at', { ascending: true })
          .limit(LIST_LIMIT),
      ]);

      if (cancelled) return;
      const now = Date.now();
      type StaleRow = Omit<StaleLead, 'waitingDays'>;
      setFollowUps(
        followUpRes.rows.map((f) => ({
          ...f,
          overdueDays: daysBetween(f.due_date, today),
        }))
      );
      setFollowUpTotal(followUpRes.total);
      setFollowUpMode(followUpRes.mode);
      setStaleLeads(
        ((staleRes.data ?? []) as unknown as StaleRow[]).map((l) => ({
          ...l,
          waitingDays: Math.max(
            1,
            Math.floor(
              (now - new Date(l.created_at).getTime()) / (24 * 60 * 60 * 1000)
            )
          ),
        }))
      );
      setStaleTotal(staleRes.count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce, fmt]);

  return (
    <section className="border-border bg-card rounded-xl border">
      <header className="border-border flex items-center justify-between border-b px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-foreground text-sm font-semibold">
              Today&apos;s lead actions
            </h2>
            {followUps !== null && staleLeads !== null && (
              <Badge variant={actionTotal > 0 ? 'warning' : 'success'}>
                {actionTotal} to clear
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Actionable follow-ups and new leads still waiting for a first touch
          </p>
        </div>
        <Link
          href="/leads?view=followups"
          className="text-primary-text hover:text-primary-text/80 text-xs font-medium"
        >
          Open follow-ups →
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-2">
        {/* Queue 1 — due follow-ups, or upcoming when the due queue is empty */}
        <div>
          <p className="text-muted-foreground mb-2 flex items-center justify-between text-xs font-medium">
            <span>
              {followUpMode === 'upcoming'
                ? 'Upcoming follow-ups'
                : 'Follow-ups due'}
            </span>
            {followUpTotal > 0 && (
              <span className="tabular-nums">
                {followUpTotal > LIST_LIMIT
                  ? `${LIST_LIMIT} of ${followUpTotal}`
                  : followUpTotal}
              </span>
            )}
          </p>
          {followUps === null ? (
            <ListSkeleton />
          ) : followUps.length === 0 ? (
            <QueueEmpty
              icon={Inbox}
              text={
                followUpMode === 'upcoming'
                  ? 'No due or upcoming follow-ups.'
                  : 'Nothing due — queue is clear.'
              }
            />
          ) : (
            <ul className="space-y-2">
              {followUps.map((f) => {
                const overdueDays = f.overdueDays;
                const who =
                  f.contact?.name?.trim() || f.contact?.phone || 'Lead';
                const assignee = f.assigned_to
                  ? (nameById.get(f.assigned_to) ?? 'Teammate')
                  : null;
                return (
                  <li
                    key={f.id}
                    className="border-border/60 bg-muted/20 hover:border-border-hover flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 transition-colors"
                    tabIndex={0}
                    aria-label={`Open ${who} details`}
                    onClick={() => setDetailContactId(f.contact_id)}
                    onKeyDown={(event) => {
                      if (event.currentTarget !== event.target) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setDetailContactId(f.contact_id);
                      }
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <FollowUpTaskSummary
                        taskType={f.task_type}
                        note={f.note}
                        label={who}
                      />
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {followUpMode === 'upcoming' ? (
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {fmt.date(f.due_date)}
                        </span>
                      ) : (
                        <Badge variant={overdueDays > 0 ? 'danger' : 'warning'}>
                          {overdueDays > 0
                            ? `Overdue ${overdueDays}d`
                            : 'Today'}
                        </Badge>
                      )}
                      {assignee && (
                        <UserAvatar
                          name={assignee}
                          src={
                            f.assigned_to ? avatarById.get(f.assigned_to) : null
                          }
                          className="size-5 shrink-0"
                          fallbackClassName="text-[10px]"
                          title={`Assigned to ${assignee}`}
                        />
                      )}
                      <GatedButton
                        variant="ghost"
                        size="icon-sm"
                        canAct={canEdit}
                        gateReason="complete follow-ups"
                        onClick={(event) => {
                          event.stopPropagation();
                          setCompleting(f);
                        }}
                        aria-label={`Complete follow-up for ${who}`}
                      >
                        <CheckCircle2 className="size-3.5" />
                      </GatedButton>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Queue 2 — new leads waiting on first contact */}
        <div>
          <p className="text-muted-foreground mb-2 flex items-center justify-between text-xs font-medium">
            <span>Waiting for first contact ({STALE_HOURS}h+)</span>
            {staleTotal > 0 && (
              <span className="tabular-nums">
                {staleTotal > LIST_LIMIT
                  ? `${LIST_LIMIT} of ${staleTotal}`
                  : staleTotal}
              </span>
            )}
          </p>
          {staleLeads === null ? (
            <ListSkeleton />
          ) : staleLeads.length === 0 ? (
            <QueueEmpty
              icon={UserRoundSearch}
              text="No new leads waiting — good response time."
            />
          ) : (
            <ul className="space-y-1.5">
              {staleLeads.map((l) => {
                const waitingDays = l.waitingDays;
                return (
                  <li key={l.id}>
                    <Link
                      href={`/leads?contact=${encodeURIComponent(l.id)}&focus=followup`}
                      className="border-border/60 bg-muted/20 hover:border-border-hover flex items-center gap-2.5 rounded-lg border px-2.5 py-2 transition-colors"
                    >
                      <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                        {l.name?.trim() || l.phone}
                      </span>
                      <span className="text-muted-foreground shrink-0 font-mono text-xs">
                        {l.phone}
                      </span>
                      <Badge variant="info">waiting {waitingDays}d</Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
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
            membership_id: null,
            note: completing.note,
            contact: { name: completing.contact?.name ?? undefined },
          }}
          context="lead"
          onSaved={() => {
            setCompleting(null);
            setNonce((value) => value + 1);
          }}
        />
      )}
      <ContactDetailView
        open={Boolean(detailContactId)}
        onOpenChange={(open) => {
          if (!open) setDetailContactId(null);
        }}
        contactId={detailContactId}
        onUpdated={() => setNonce((value) => value + 1)}
      />
    </section>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

function QueueEmpty({
  icon: Icon,
  text,
}: {
  icon: typeof Inbox;
  text: string;
}) {
  return (
    <div className="border-border text-muted-foreground flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-xs">
      <Icon className="size-4 shrink-0" />
      {text}
    </div>
  );
}
