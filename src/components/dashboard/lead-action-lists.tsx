'use client';

import { useEffect, useState } from 'react';
import { BranchLink as Link } from '@/components/layout/branch-link';
import { createClient } from '@/lib/supabase/client';
import { Inbox, UserRoundSearch } from 'lucide-react';
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
import { FollowUpCompletionControl } from '@/components/follow-ups/follow-up-completion-control';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { UserAvatar } from '@/components/ui/user-avatar';
import { QueueEmpty, QueueHeading, QueueSkeleton } from './action-queue';
import { DashboardSection } from './dashboard-section';

// Today's lead actions — the PRD's "smart queue": not a dashboard to
// admire but a work list to clear. Two queues:
//   1. Follow-ups — due work first; nearest upcoming work when due is empty.
//   2. Not contacted yet — leads still in "New" after STALE_HOURS.
// Rows deep-link into /leads for the full record. Only queue 1 has a page
// that owns the whole list, so only it carries a "See all".

const STALE_HOURS = 24;
const LIST_LIMIT = 8;

interface DashboardFollowUp extends DashboardFollowUpRow {
  /** Days overdue vs account-local today — computed at fetch time. */
  overdueDays: number;
}

interface StaleLead {
  id: string;
  name: string | null;
  avatarUrl: string | null;
  messagePreview: string;
  /** Whole days since capture — computed at fetch time (render stays pure). */
  waitingDays: number;
}

interface StaleLeadRow {
  id: string;
  name: string | null;
  avatar_url: string | null;
  created_at: string;
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
          .select('id, name, avatar_url, created_at, memberships!left(id)', {
            count: 'exact',
          })
          .is('memberships', null)
          .is('lead_status', null)
          .lt('created_at', staleCutoff)
          .order('created_at', { ascending: true })
          .limit(LIST_LIMIT),
      ]);

      const staleRows = (staleRes.data ?? []) as unknown as StaleLeadRow[];
      const staleContactIds = staleRows.map((lead) => lead.id);
      const conversationRes =
        staleContactIds.length > 0
          ? await supabase
              .from('conversations')
              .select('contact_id, last_message_text')
              .in('contact_id', staleContactIds)
              .order('last_message_at', {
                ascending: false,
                nullsFirst: false,
              })
          : { data: [] };

      if (cancelled) return;
      const now = Date.now();
      const messageByContact = new Map<string, string>();
      for (const conversation of conversationRes.data ?? []) {
        if (!messageByContact.has(conversation.contact_id)) {
          messageByContact.set(
            conversation.contact_id,
            conversation.last_message_text?.trim() || 'No message yet'
          );
        }
      }
      setFollowUps(
        followUpRes.rows.map((f) => ({
          ...f,
          overdueDays: daysBetween(f.due_date, today),
        }))
      );
      setFollowUpTotal(followUpRes.total);
      setFollowUpMode(followUpRes.mode);
      setStaleLeads(
        staleRows.map((l) => ({
          id: l.id,
          name: l.name,
          avatarUrl: l.avatar_url,
          messagePreview: messageByContact.get(l.id) ?? 'No message yet',
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
    <DashboardSection
      id="lead-work"
      title="Lead work"
      badge={
        followUps !== null && staleLeads !== null ? (
          <Badge variant={actionTotal > 0 ? 'warning' : 'success'}>
            {actionTotal} to do
          </Badge>
        ) : null
      }
    >
      <Card>
        <CardContent className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Queue 1 — due follow-ups, or upcoming when the due queue is empty */}
          <div>
            <QueueHeading
              label={
                followUpMode === 'upcoming'
                  ? 'Next follow-ups'
                  : 'Follow-ups to do'
              }
              href="/leads?view=followups"
              shown={followUps?.length}
              total={followUpTotal}
            />
            {followUps === null ? (
              <QueueSkeleton />
            ) : followUps.length === 0 ? (
              <QueueEmpty
                icon={Inbox}
                text={
                  followUpMode === 'upcoming'
                    ? 'No follow-ups are due or coming up.'
                    : 'No follow-ups are due today.'
                }
              />
            ) : (
              <ul className="divide-border/60 -mx-2 divide-y">
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
                      className="hover:bg-muted/50 flex cursor-pointer items-center gap-2.5 px-2 py-2 transition-colors"
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
                          <Badge
                            variant={overdueDays > 0 ? 'danger' : 'warning'}
                          >
                            {overdueDays > 0
                              ? `Overdue ${overdueDays}d`
                              : 'Today'}
                          </Badge>
                        )}
                        {assignee && (
                          <UserAvatar
                            name={assignee}
                            src={
                              f.assigned_to
                                ? avatarById.get(f.assigned_to)
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
                            setCompleting(f);
                          }}
                          ariaLabel={`Complete follow-up for ${who}`}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Queue 2 — new leads waiting on first contact */}
          <div>
            <QueueHeading
              label="Not contacted yet"
              shown={staleLeads?.length}
              total={staleTotal}
            />
            {staleLeads === null ? (
              <QueueSkeleton rowClassName="h-11" />
            ) : staleLeads.length === 0 ? (
              <QueueEmpty
                icon={UserRoundSearch}
                text="No new leads are waiting."
              />
            ) : (
              <ul className="divide-border/60 -mx-2 divide-y">
                {staleLeads.map((l) => {
                  const waitingDays = l.waitingDays;
                  const displayName = l.name?.trim() || 'Unnamed lead';
                  return (
                    <li key={l.id}>
                      <Link
                        href={`/leads?contact=${encodeURIComponent(l.id)}&focus=followup`}
                        className="hover:bg-muted/50 flex items-center gap-3 px-2 py-2.5 transition-colors"
                      >
                        <UserAvatar
                          name={displayName}
                          src={l.avatarUrl}
                          className="size-8 shrink-0"
                          fallbackClassName="text-xs"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-foreground truncate text-sm font-medium">
                            {displayName}
                          </p>
                          <p className="text-muted-foreground mt-0.5 truncate text-xs">
                            {l.messagePreview}
                          </p>
                        </div>
                        <Badge variant="info">Waiting {waitingDays}d</Badge>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
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
    </DashboardSection>
  );
}
