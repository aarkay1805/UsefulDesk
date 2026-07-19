'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  UserRoundSearch,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/errors';
import {
  buildLeadAccountabilityRows,
  FIRST_RESPONSE_HOURS,
  rowsForLeadAccountabilityView,
  summarizeLeadAccountability,
  type AccountabilityFollowUp,
  type AccountabilityLead,
  type LeadAccountabilityIssue,
  type LeadAccountabilityScope,
  type LeadAccountabilityView,
} from '@/lib/leads/accountability';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { useLeadFieldOptions } from '@/hooks/use-lead-field-options';
import { useLocale } from '@/hooks/use-locale';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { GatedButton } from '@/components/ui/gated-button';
import { SearchInput } from '@/components/ui/search-input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Toolbar,
  ToolbarToggleGroup,
  ToolbarToggleItem,
} from '@/components/ui/toolbar';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { UserAvatar } from '@/components/ui/user-avatar';
import { EmptyState } from '@/components/dashboard/empty-state';
import { useAccountStaff } from '@/components/members/use-account-staff';
import {
  AssigneeDisplay,
  StatusBadge,
} from '@/components/leads/lead-cell-renderers';
import { CompleteFollowUpDialog } from '@/components/follow-ups/complete-follow-up-dialog';
import { FollowUpTaskSummary } from '@/components/follow-ups/follow-up-task-summary';

const FETCH_BATCH = 500;
const PAGE_SIZE = 25;

type QueueFilter =
  | 'all'
  | 'overdue'
  | 'today'
  | 'upcoming'
  | 'within_sla'
  | 'missing'
  | 'unassigned';

const ISSUE_BADGE: Record<
  Exclude<LeadAccountabilityIssue, 'upcoming'>,
  { label: string; variant: 'danger' | 'warning' | 'info' | 'neutral' }
> = {
  overdue: { label: 'Overdue', variant: 'danger' },
  due_today: { label: 'Due today', variant: 'warning' },
  first_response_overdue: {
    label: `First response ${FIRST_RESPONSE_HOURS}h+`,
    variant: 'danger',
  },
  missing_next_action: { label: 'No follow-up', variant: 'info' },
};

const FILTER_ISSUE: Partial<Record<QueueFilter, LeadAccountabilityIssue>> = {
  overdue: 'overdue',
  today: 'due_today',
  missing: 'missing_next_action',
  upcoming: 'upcoming',
};

async function fetchAllActiveLeads(
  supabase: ReturnType<typeof createClient>
): Promise<AccountabilityLead[]> {
  const rows: AccountabilityLead[] = [];
  for (let from = 0; ; from += FETCH_BATCH) {
    const { data, error } = await supabase
      .from('contacts')
      .select(
        'id, name, phone, avatar_url, lead_status, lead_status_changed_at, assigned_to, created_at, memberships!left(id)'
      )
      .is('memberships', null)
      .or('lead_status.is.null,lead_status.neq.lost')
      .order('created_at', { ascending: true })
      .range(from, from + FETCH_BATCH - 1);
    if (error) throw error;
    const batch = (data ?? []) as unknown as AccountabilityLead[];
    rows.push(...batch);
    if (batch.length < FETCH_BATCH) return rows;
  }
}

async function fetchAllOpenLeadFollowUps(
  supabase: ReturnType<typeof createClient>
): Promise<AccountabilityFollowUp[]> {
  const rows: AccountabilityFollowUp[] = [];
  for (let from = 0; ; from += FETCH_BATCH) {
    const { data, error } = await supabase
      .from('follow_ups')
      .select(
        'id, contact_id, membership_id, assigned_to, created_by, reason, task_type, due_date, status, outcome, note, completed_at, created_at, updated_at'
      )
      .eq('status', 'open')
      .is('membership_id', null)
      .order('due_date', { ascending: true })
      .range(from, from + FETCH_BATCH - 1);
    if (error) throw error;
    const batch = (data ?? []) as AccountabilityFollowUp[];
    rows.push(...batch);
    if (batch.length < FETCH_BATCH) return rows;
  }
}

interface LeadAccountabilityViewProps {
  view: LeadAccountabilityView;
  /** Bumped by the page after lead or follow-up mutations. */
  refreshNonce: number;
  onOpenLead: (contactId: string, focusFollowUp: boolean) => void;
}

export function LeadAccountabilityView({
  view,
  refreshNonce,
  onOpenLead,
}: LeadAccountabilityViewProps) {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const canEdit = useCan('send-messages');
  const { fmt } = useLocale();
  const fieldOptions = useLeadFieldOptions();
  const { nameById, avatarById } = useAccountStaff();

  const [scope, setScope] = useState<LeadAccountabilityScope>('mine');
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [search, setSearch] = useState('');
  const [leads, setLeads] = useState<AccountabilityLead[]>([]);
  const [followUps, setFollowUps] = useState<AccountabilityFollowUp[]>([]);
  const [loadedAt, setLoadedAt] = useState(() => new Date().toISOString());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [page, setPage] = useState(0);
  const [completing, setCompleting] = useState<{
    followUp: AccountabilityFollowUp;
    lead: AccountabilityLead;
  } | null>(null);

  useEffect(() => {
    void nonce;
    void refreshNonce;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [nextLeads, nextFollowUps] = await Promise.all([
          fetchAllActiveLeads(supabase),
          fetchAllOpenLeadFollowUps(supabase),
        ]);
        if (cancelled) return;
        setLeads(nextLeads);
        setFollowUps(nextFollowUps);
        setLoadedAt(new Date().toISOString());
      } catch (error) {
        if (cancelled) return;
        const message = getErrorMessage(
          error,
          view === 'followups'
            ? 'Failed to load follow-ups'
            : 'Failed to load first response'
        );
        setLoadError(message);
        toast.error(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce, refreshNonce, supabase, view]);

  const today = fmt.today();
  const allRows = useMemo(
    () =>
      buildLeadAccountabilityRows(leads, followUps, {
        today,
        now: loadedAt,
        scope,
        userId: user?.id ?? null,
    }),
    [leads, followUps, today, loadedAt, scope, user?.id]
  );
  const rows = useMemo(
    () => rowsForLeadAccountabilityView(allRows, view),
    [allRows, view]
  );
  const summary = useMemo(() => summarizeLeadAccountability(rows), [rows]);
  const upcomingCount = useMemo(
    () => rows.filter((row) => row.issues.includes('upcoming')).length,
    [rows]
  );
  const withinSlaCount = rows.length - summary.firstResponseOverdue;

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const issue = FILTER_ISSUE[filter];
    return rows.filter((row) => {
      const matchesFilter =
        filter === 'all'
          ? true
          : view === 'first_response' && filter === 'overdue'
            ? row.issues.includes('first_response_overdue')
            : filter === 'within_sla'
              ? !row.issues.includes('first_response_overdue')
              : filter === 'missing'
                ? row.followUp === null
                : filter === 'unassigned'
                  ? row.ownerId === null
                : issue
                  ? row.issues.includes(issue)
                  : true;
      if (!matchesFilter) return false;
      if (!term) return true;
      return (
        row.lead.name?.toLowerCase().includes(term) ||
        row.lead.phone.toLowerCase().includes(term) ||
        nameById
          .get(row.ownerId ?? '')
          ?.toLowerCase()
          .includes(term)
      );
    });
  }, [filter, nameById, rows, search, view]);

  const pageKey = `${view}:${scope}:${filter}:${search}`;
  const [previousPageKey, setPreviousPageKey] = useState(pageKey);
  if (pageKey !== previousPageKey) {
    setPreviousPageKey(pageKey);
    setPage(0);
  }

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const visibleRows = filteredRows.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE
  );

  function refetch() {
    setCompleting(null);
    setNonce((value) => value + 1);
  }

  const searchPlaceholder =
    view === 'followups'
      ? 'Search follow-ups…'
      : 'Search first response…';
  const searchLabel =
    view === 'followups' ? 'Search follow-ups' : 'Search first response';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section className="border-border bg-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border">
        <div className="border-border flex shrink-0 flex-wrap items-center gap-2 border-b p-2">
          <SearchInput
            containerClassName="min-w-48 w-full max-w-[320px] flex-1 basis-64"
            value={search}
            onValueChange={setSearch}
            placeholder={searchPlaceholder}
            aria-label={searchLabel}
          />

          <TooltipProvider>
            <ChipGroup<QueueFilter>
              selectionMode="single"
              value={[filter]}
              onValueChange={(values) => values[0] && setFilter(values[0])}
              aria-label={
                view === 'followups'
                  ? 'Lead follow-up filters'
                  : 'First response filters'
              }
            >
              <QueueChip
                value="all"
                label="All"
                count={rows.length}
                helpText={
                  view === 'followups'
                    ? 'All scheduled lead follow-ups.'
                    : 'Leads still in New and awaiting their first response.'
                }
              />
              <QueueChip
                value="overdue"
                label="Overdue"
                count={
                  view === 'followups'
                    ? summary.overdue
                    : summary.firstResponseOverdue
                }
                helpText={
                  view === 'followups'
                    ? 'Follow-ups past their due date.'
                    : `Leads that missed the ${FIRST_RESPONSE_HOURS}-hour first-response target.`
                }
              />
              {view === 'followups' ? (
                <>
                  <QueueChip
                    value="today"
                    label="Today"
                    count={summary.dueToday}
                    helpText="Follow-ups due today."
                  />
                  <QueueChip
                    value="upcoming"
                    label="Upcoming"
                    count={upcomingCount}
                    helpText="Follow-ups due after today."
                  />
                </>
              ) : (
                <>
                  <QueueChip
                    value="within_sla"
                    label={`Within ${FIRST_RESPONSE_HOURS}h`}
                    count={withinSlaCount}
                    helpText="New leads still inside the first-response window."
                  />
                  <QueueChip
                    value="missing"
                    label="No follow-up"
                    count={summary.missingNextAction}
                    helpText="New leads without an open follow-up."
                  />
                </>
              )}
              <QueueChip
                value="unassigned"
                label="Unassigned"
                count={summary.unassigned}
                helpText="Work without a responsible salesperson."
              />
            </ChipGroup>
          </TooltipProvider>

          <Toolbar
            className="ml-auto"
            aria-label={
              view === 'followups'
                ? 'Lead follow-up scope'
                : 'First response scope'
            }
          >
            <ToolbarToggleGroup<LeadAccountabilityScope>
              value={[scope]}
              onValueChange={(values) => values[0] && setScope(values[0])}
              aria-label="Owner scope"
            >
              <ToolbarToggleItem value="mine">
                <UserRoundSearch className="size-4" />
                My work
              </ToolbarToggleItem>
              <ToolbarToggleItem value="team">
                <Users className="size-4" />
                Team
              </ToolbarToggleItem>
            </ToolbarToggleGroup>
          </Toolbar>
        </div>

        {loading && leads.length === 0 ? (
          <div className="text-muted-foreground flex items-center gap-2 px-4 py-12 text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading{' '}
            {view === 'followups' ? 'follow-ups' : 'first response'}…
          </div>
        ) : loadError ? (
          <div className="p-4">
            <EmptyState
              icon={AlertTriangle}
              title={
                view === 'followups'
                  ? 'Follow-ups could not be loaded'
                  : 'First response could not be loaded'
              }
              hint={loadError}
            />
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={CheckCircle2}
              title="Queue is clear"
              hint={
                scope === 'mine'
                  ? `No ${view === 'followups' ? 'follow-ups' : 'first-response leads'} match this queue in My work.`
                  : `No team ${view === 'followups' ? 'follow-ups' : 'first-response leads'} match this queue.`
              }
            />
          </div>
        ) : (
          <div className="min-h-0 overflow-auto">
            <Table className="min-w-[1120px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>
                    {view === 'followups' ? 'Due status' : 'Response window'}
                  </TableHead>
                  <TableHead>Follow-up</TableHead>
                  <TableHead>Due date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>
                    {view === 'followups' ? 'Stage age' : 'Waiting'}
                  </TableHead>
                  <TableHead>Assigned to</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((row) => {
                  const followUp = row.followUp;
                  return (
                    <TableRow
                      key={row.lead.id}
                      className="cursor-pointer"
                      onClick={() => onOpenLead(row.lead.id, Boolean(followUp))}
                    >
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-2.5">
                          <UserAvatar
                            name={row.lead.name || row.lead.phone}
                            src={row.lead.avatar_url}
                            className="size-8 shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="text-foreground truncate text-sm font-medium">
                              {row.lead.name?.trim() || 'Unnamed'}
                            </p>
                            <p className="text-muted-foreground truncate font-mono text-xs">
                              {row.lead.phone}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {view === 'followups' ? (
                            row.issues.includes('overdue') ? (
                              <Badge variant={ISSUE_BADGE.overdue.variant}>
                                {ISSUE_BADGE.overdue.label}
                              </Badge>
                            ) : row.issues.includes('due_today') ? (
                              <Badge variant={ISSUE_BADGE.due_today.variant}>
                                {ISSUE_BADGE.due_today.label}
                              </Badge>
                            ) : (
                              <Badge variant="neutral">Upcoming</Badge>
                            )
                          ) : (
                            <>
                              {row.issues.includes(
                                'first_response_overdue'
                              ) ? (
                                <Badge
                                  variant={
                                    ISSUE_BADGE.first_response_overdue.variant
                                  }
                                >
                                  {
                                    ISSUE_BADGE.first_response_overdue
                                      .label
                                  }
                                </Badge>
                              ) : (
                                <Badge variant="info">
                                  Within {FIRST_RESPONSE_HOURS}h
                                </Badge>
                              )}
                              {!followUp && (
                                <Badge variant="info">No follow-up</Badge>
                              )}
                            </>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <FollowUpTaskSummary
                          taskType={followUp?.task_type}
                          note={followUp?.note}
                        />
                      </TableCell>
                      <TableCell>
                        {followUp ? (
                          <span className="text-muted-foreground text-sm tabular-nums">
                            {fmt.date(followUp.due_date)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-sm">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          column={fieldOptions.statusFor(row.lead.lead_status)}
                        />
                      </TableCell>
                      <TableCell>
                        <span className="text-muted-foreground text-sm tabular-nums">
                          {row.stageAgeDays === 0
                            ? 'Today'
                            : `${row.stageAgeDays}d`}
                        </span>
                      </TableCell>
                      <TableCell>
                        {row.ownerId ? (
                          <AssigneeDisplay
                            name={nameById.get(row.ownerId) ?? 'Teammate'}
                            avatarUrl={avatarById.get(row.ownerId)}
                          />
                        ) : (
                          <Badge variant="neutral">Unassigned</Badge>
                        )}
                      </TableCell>
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        {followUp ? (
                          <GatedButton
                            variant="ghost"
                            size="sm"
                            canAct={canEdit}
                            gateReason="complete follow-ups"
                            onClick={() =>
                              setCompleting({ followUp, lead: row.lead })
                            }
                          >
                            <CheckCircle2 className="size-4" />
                            Complete
                          </GatedButton>
                        ) : (
                          <GatedButton
                            variant="ghost"
                            size="sm"
                            canAct={canEdit}
                            gateReason="add a follow-up"
                            onClick={() => onOpenLead(row.lead.id, true)}
                          >
                            <CalendarClock className="size-4" />
                            Add follow-up
                          </GatedButton>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="border-border mt-auto flex shrink-0 items-center justify-between border-t px-3 py-2">
          <p className="text-muted-foreground text-xs">
            {filteredRows.length}{' '}
            {view === 'followups'
              ? `follow-up${filteredRows.length === 1 ? '' : 's'}`
              : `lead${filteredRows.length === 1 ? '' : 's'}`}{' '}
            in this queue
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={safePage === 0}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-muted-foreground px-2 text-xs">
              Page {safePage + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={safePage >= totalPages - 1}
              onClick={() =>
                setPage((value) => Math.min(totalPages - 1, value + 1))
              }
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </section>

      {completing && (
        <CompleteFollowUpDialog
          open={Boolean(completing)}
          onOpenChange={(open) => {
            if (!open) setCompleting(null);
          }}
          followUp={{
            id: completing.followUp.id,
            contact_id: completing.followUp.contact_id,
            membership_id: null,
            note: completing.followUp.note,
            contact: { name: completing.lead.name },
          }}
          context="lead"
          onSaved={refetch}
        />
      )}
    </div>
  );
}

function QueueChip({
  value,
  label,
  count,
  helpText,
}: {
  value: QueueFilter;
  label: string;
  count: number;
  helpText: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger delay={1000} render={<Chip value={value} />}>
        {label} <span className="tabular-nums">{count}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-pretty">
        {helpText}
      </TooltipContent>
    </Tooltip>
  );
}
