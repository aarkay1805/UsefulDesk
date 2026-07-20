'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ListChecks,
  Loader2,
  Settings,
  UserRoundSearch,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
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
import { useTablePrefs } from '@/hooks/use-table-prefs';
import {
  EMPTY_FOLLOW_UP_FILTERS,
  exclusiveFollowUpBucket,
  FOLLOW_UP_BUCKET_OPTIONS,
  UNASSIGNED_FOLLOW_UP,
  type FollowUpBucket,
  type FollowUpFilters as FollowUpFilterState,
} from '@/lib/memberships/follow-up-filters';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { Collapse } from '@/components/ui/collapse';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  assigneeCellOptions,
  StatusBadge,
} from '@/components/leads/lead-cell-renderers';
import { EditableCell } from '@/components/leads/editable-cell';
import type { SortState } from '@/components/leads/leads-sort';
import {
  ColumnHeader,
  type ColumnFilterProp,
  type SortDir,
} from '@/components/table/column-header';
import {
  BulkCompleteFollowUpsDialog,
  CompleteFollowUpDialog,
} from '@/components/follow-ups/complete-follow-up-dialog';
import {
  FollowUpQueueControls,
  type FollowUpBucketCounts,
} from '@/components/follow-ups/follow-up-queue-controls';
import { FollowUpTaskSummary } from '@/components/follow-ups/follow-up-task-summary';
import { FollowUpDialog } from '@/components/follow-ups/follow-up-dialog';
import { FollowUpButton } from '@/components/follow-ups/follow-up-button';

const FETCH_BATCH = 500;
const PAGE_SIZE = 25;
const CHECKBOX_COL_WIDTH = 40;

type LeadFollowUpFilterDim = 'buckets' | 'assignees';

interface LeadFollowUpColumn {
  key: string;
  label: string;
  defaultWidth: number;
  minWidth: number;
  required?: boolean;
  sortKey?: string;
  filterDim?: LeadFollowUpFilterDim;
}

const LEAD_FOLLOW_UP_COLUMNS: LeadFollowUpColumn[] = [
  {
    key: 'name',
    label: 'Name',
    defaultWidth: 250,
    minWidth: 180,
    required: true,
    sortKey: 'name',
  },
  {
    key: 'dueStatus',
    label: 'Due status',
    defaultWidth: 150,
    minWidth: 130,
    filterDim: 'buckets',
  },
  {
    key: 'followUp',
    label: 'Follow-up',
    defaultWidth: 280,
    minWidth: 190,
    sortKey: 'task_type',
  },
  {
    key: 'dueDate',
    label: 'Due date',
    defaultWidth: 170,
    minWidth: 140,
    sortKey: 'due_date',
  },
  {
    key: 'status',
    label: 'Status',
    defaultWidth: 160,
    minWidth: 130,
    sortKey: 'status',
  },
  {
    key: 'stageAge',
    label: 'Stage age',
    defaultWidth: 130,
    minWidth: 110,
    sortKey: 'stage_age',
  },
  {
    key: 'assignee',
    label: 'Assigned to',
    defaultWidth: 200,
    minWidth: 150,
    filterDim: 'assignees',
  },
  {
    key: 'actions',
    label: 'Actions',
    defaultWidth: 160,
    minWidth: 150,
  },
];

const LEAD_FOLLOW_UP_COLUMN_BY_KEY: Record<string, LeadFollowUpColumn> =
  Object.fromEntries(
    LEAD_FOLLOW_UP_COLUMNS.map((column) => [column.key, column])
  );

const LEAD_FOLLOW_UP_SORT_COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'due_date', label: 'Due date' },
  { key: 'task_type', label: 'Follow-up' },
  { key: 'status', label: 'Status' },
  { key: 'stage_age', label: 'Stage age' },
  { key: 'created_at', label: 'Created' },
];

interface LeadFollowUpTablePrefs {
  sort: SortState | null;
  order: string[];
  hidden: string[];
  widths: Record<string, number>;
}

const DEFAULT_LEAD_FOLLOW_UP_PREFS: LeadFollowUpTablePrefs = {
  sort: null,
  order: [],
  hidden: [],
  widths: {},
};

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
  const { staff, nameById, avatarById } = useAccountStaff();

  const [scope, setScope] = useState<LeadAccountabilityScope>('mine');
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [followUpFilters, setFollowUpFilters] = useState<FollowUpFilterState>(
    EMPTY_FOLLOW_UP_FILTERS
  );
  const [search, setSearch] = useState('');
  const [leads, setLeads] = useState<AccountabilityLead[]>([]);
  const [followUps, setFollowUps] = useState<AccountabilityFollowUp[]>([]);
  const [loadedAt, setLoadedAt] = useState(() => new Date().toISOString());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [page, setPage] = useState(0);
  const [prefs, setPrefs] = useTablePrefs<LeadFollowUpTablePrefs>(
    'leads-follow-ups',
    DEFAULT_LEAD_FOLLOW_UP_PREFS
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCompleteOpen, setBulkCompleteOpen] = useState(false);
  const [bulkCount, setBulkCount] = useState(0);
  if (selected.size > 0 && selected.size !== bulkCount) {
    setBulkCount(selected.size);
  }
  const [editingAssigneeId, setEditingAssigneeId] = useState<string | null>(
    null
  );
  const [savingCell, setSavingCell] = useState(false);
  const [completing, setCompleting] = useState<{
    followUp: AccountabilityFollowUp;
    lead: AccountabilityLead;
  } | null>(null);
  const [creatingFor, setCreatingFor] = useState<AccountabilityLead | null>(
    null
  );

  const orderedColumns = useMemo(() => {
    const known = LEAD_FOLLOW_UP_COLUMNS.map((column) => column.key);
    const saved = prefs.order.filter((key) => known.includes(key));
    const missing = known.filter((key) => !saved.includes(key));
    return [...saved, ...missing];
  }, [prefs.order]);

  const visibleColumns = useMemo(
    () =>
      orderedColumns
        .map((key) => LEAD_FOLLOW_UP_COLUMN_BY_KEY[key])
        .filter(
          (column): column is LeadFollowUpColumn =>
            Boolean(column) && !prefs.hidden.includes(column.key)
        ),
    [orderedColumns, prefs.hidden]
  );

  const [resizing, setResizing] = useState<{
    key: string;
    width: number;
  } | null>(null);

  function widthOf(column: LeadFollowUpColumn) {
    if (resizing?.key === column.key) return resizing.width;
    return prefs.widths[column.key] ?? column.defaultWidth;
  }

  const tableColumns =
    view === 'followups' ? visibleColumns : LEAD_FOLLOW_UP_COLUMNS;
  const displayWidthOf = (column: LeadFollowUpColumn) =>
    view === 'followups' ? widthOf(column) : column.defaultWidth;
  const tableWidth =
    (view === 'followups' ? CHECKBOX_COL_WIDTH : 0) +
    tableColumns.reduce((sum, column) => sum + displayWidthOf(column), 0);

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
  const withinSlaCount = rows.length - summary.firstResponseOverdue;

  const followUpBaseRows = useMemo(() => {
    if (view !== 'followups') return rows;
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      const assigneeMatches =
        followUpFilters.assignees.length === 0 ||
        (row.ownerId === null
          ? followUpFilters.assignees.includes(UNASSIGNED_FOLLOW_UP)
          : followUpFilters.assignees.includes(row.ownerId));
      if (!assigneeMatches) return false;
      if (!term) return true;
      return (
        row.lead.name?.toLowerCase().includes(term) ||
        row.lead.phone.toLowerCase().includes(term) ||
        row.followUp?.note?.toLowerCase().includes(term) ||
        nameById
          .get(row.ownerId ?? '')
          ?.toLowerCase()
          .includes(term)
      );
    });
  }, [followUpFilters.assignees, nameById, rows, search, view]);

  const followUpBucketCounts = useMemo<FollowUpBucketCounts>(
    () => ({
      all: followUpBaseRows.length,
      overdue: followUpBaseRows.filter((row) => row.issues.includes('overdue'))
        .length,
      today: followUpBaseRows.filter((row) => row.issues.includes('due_today'))
        .length,
      upcoming: followUpBaseRows.filter((row) =>
        row.issues.includes('upcoming')
      ).length,
    }),
    [followUpBaseRows]
  );

  const filteredRows = useMemo(() => {
    if (view === 'followups') {
      const bucket = followUpFilters.buckets[0];
      const filtered = bucket
        ? followUpBaseRows.filter((row) =>
            row.issues.includes(bucket === 'today' ? 'due_today' : bucket)
          )
        : followUpBaseRows;
      if (!prefs.sort) return filtered;

      const direction = prefs.sort.dir === 'asc' ? 1 : -1;
      return [...filtered].sort((a, b) => {
        let comparison = 0;
        switch (prefs.sort?.key) {
          case 'name':
            comparison = (a.lead.name ?? a.lead.phone).localeCompare(
              b.lead.name ?? b.lead.phone
            );
            break;
          case 'due_date':
            comparison = (a.followUp?.due_date ?? '').localeCompare(
              b.followUp?.due_date ?? ''
            );
            break;
          case 'task_type':
            comparison = (a.followUp?.task_type ?? '').localeCompare(
              b.followUp?.task_type ?? ''
            );
            break;
          case 'status':
            comparison = fieldOptions
              .statusFor(a.lead.lead_status)
              .label.localeCompare(
                fieldOptions.statusFor(b.lead.lead_status).label
              );
            break;
          case 'stage_age':
            comparison = a.stageAgeDays - b.stageAgeDays;
            break;
          case 'created_at':
            comparison = (a.followUp?.created_at ?? '').localeCompare(
              b.followUp?.created_at ?? ''
            );
            break;
        }
        return comparison * direction;
      });
    }

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
  }, [
    filter,
    followUpBaseRows,
    followUpFilters.buckets,
    fieldOptions,
    nameById,
    prefs.sort,
    rows,
    search,
    view,
  ]);

  const pageKey = `${view}:${scope}:${filter}:${search}:${JSON.stringify(
    followUpFilters
  )}:${JSON.stringify(prefs.sort)}`;
  const [previousPageKey, setPreviousPageKey] = useState(pageKey);
  if (pageKey !== previousPageKey) {
    setPreviousPageKey(pageKey);
    setPage(0);
    setSelected(new Set());
  }

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const visibleRows = filteredRows.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE
  );

  function refetch() {
    setCompleting(null);
    setBulkCompleteOpen(false);
    setSelected(new Set());
    setNonce((value) => value + 1);
  }

  function startResize(event: React.MouseEvent, column: LeadFollowUpColumn) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widthOf(column);
    function onMove(moveEvent: MouseEvent) {
      setResizing({
        key: column.key,
        width: Math.max(
          column.minWidth,
          startWidth + (moveEvent.clientX - startX)
        ),
      });
    }
    function onUp(upEvent: MouseEvent) {
      const width = Math.max(
        column.minWidth,
        startWidth + (upEvent.clientX - startX)
      );
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setResizing(null);
      setPrefs((current) => ({
        ...current,
        widths: { ...current.widths, [column.key]: width },
      }));
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function hideColumn(key: string) {
    setPrefs((current) => ({
      ...current,
      hidden: current.hidden.includes(key)
        ? current.hidden
        : [...current.hidden, key],
    }));
  }

  function toggleColumnVisible(key: string) {
    setPrefs((current) => ({
      ...current,
      hidden: current.hidden.includes(key)
        ? current.hidden.filter((item) => item !== key)
        : [...current.hidden, key],
    }));
  }

  function sortByColumn(key: string, dir: SortDir) {
    setPrefs((current) => ({ ...current, sort: { key, dir } }));
  }

  function toggleFollowUpFilter(dim: LeadFollowUpFilterDim, value: string) {
    setFollowUpFilters((current) => {
      const values = current[dim] as string[];
      if (dim === 'buckets') {
        return {
          ...current,
          buckets: exclusiveFollowUpBucket(
            value as FollowUpBucket,
            !values.includes(value)
          ),
        };
      }
      const next = values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value];
      return { ...current, [dim]: next } as FollowUpFilterState;
    });
  }

  function columnFilter(
    column: LeadFollowUpColumn
  ): ColumnFilterProp | undefined {
    if (!column.filterDim) return undefined;
    const options =
      column.filterDim === 'buckets'
        ? FOLLOW_UP_BUCKET_OPTIONS
        : [
            { value: UNASSIGNED_FOLLOW_UP, label: 'Unassigned' },
            ...staff.map((member) => ({
              value: member.user_id,
              label: member.full_name,
            })),
          ];
    return {
      options,
      selected: followUpFilters[column.filterDim] as string[],
      onToggle: (value) => toggleFollowUpFilter(column.filterDim!, value),
    };
  }

  async function commitAssignee(
    followUp: AccountabilityFollowUp,
    rawValue: string
  ) {
    const assignedTo = rawValue || null;
    if (assignedTo === (followUp.assigned_to ?? null)) {
      setEditingAssigneeId(null);
      return;
    }

    setSavingCell(true);
    try {
      const { data, error } = await supabase
        .from('follow_ups')
        .update({ assigned_to: assignedTo })
        .eq('id', followUp.id)
        .eq('status', 'open')
        .select('id')
        .maybeSingle();
      if (error || !data) {
        toast.error(getErrorMessage(error, 'Failed to reassign follow-up'));
        return;
      }
      setFollowUps((current) =>
        current.map((item) =>
          item.id === followUp.id ? { ...item, assigned_to: assignedTo } : item
        )
      );
      toast.success('Follow-up reassigned');
    } finally {
      setSavingCell(false);
      setEditingAssigneeId(null);
    }
  }

  function renderAssignee(ownerId: string | null) {
    if (!ownerId) {
      return <span className="text-muted-foreground text-sm">Unassigned</span>;
    }
    return (
      <AssigneeDisplay
        name={nameById.get(ownerId) ?? 'Teammate'}
        avatarUrl={avatarById.get(ownerId)}
      />
    );
  }

  const visibleFollowUpIds = visibleRows.flatMap((row) =>
    row.followUp ? [row.followUp.id] : []
  );
  const allOnPageSelected =
    visibleFollowUpIds.length > 0 &&
    visibleFollowUpIds.every((id) => selected.has(id));
  const someOnPageSelected = visibleFollowUpIds.some((id) => selected.has(id));

  function toggleSelect(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((current) => {
      const next = new Set(current);
      if (allOnPageSelected) {
        visibleFollowUpIds.forEach((id) => next.delete(id));
      } else {
        visibleFollowUpIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function selectAllMatching() {
    setSelected(
      new Set(
        filteredRows.flatMap((row) => (row.followUp ? [row.followUp.id] : []))
      )
    );
  }

  function renderLeadCell(key: string, row: (typeof visibleRows)[number]) {
    const followUp = row.followUp;
    switch (key) {
      case 'name':
        return (
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
        );
      case 'dueStatus':
        return followUp ? (
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
          <div className="flex flex-wrap gap-1">
            {row.issues.includes('first_response_overdue') ? (
              <Badge variant={ISSUE_BADGE.first_response_overdue.variant}>
                {ISSUE_BADGE.first_response_overdue.label}
              </Badge>
            ) : (
              <Badge variant="info">Within {FIRST_RESPONSE_HOURS}h</Badge>
            )}
            <Badge variant="info">No follow-up</Badge>
          </div>
        );
      case 'followUp':
        return (
          <FollowUpTaskSummary
            taskType={followUp?.task_type}
            note={followUp?.note}
          />
        );
      case 'dueDate':
        return followUp ? (
          <span className="text-muted-foreground text-sm tabular-nums">
            {fmt.date(followUp.due_date)}
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        );
      case 'status':
        return (
          <StatusBadge column={fieldOptions.statusFor(row.lead.lead_status)} />
        );
      case 'stageAge':
        return (
          <span className="text-muted-foreground text-sm tabular-nums">
            {row.stageAgeDays === 0 ? 'Today' : `${row.stageAgeDays}d`}
          </span>
        );
      case 'assignee':
        return renderAssignee(row.ownerId);
      case 'actions':
        return followUp ? (
          <GatedButton
            variant="ghost"
            size="sm"
            canAct={canEdit}
            gateReason="complete follow-ups"
            onClick={() => setCompleting({ followUp, lead: row.lead })}
          >
            <CheckCircle2 className="size-4" />
            Complete
          </GatedButton>
        ) : (
          <FollowUpButton
            canAct={canEdit}
            onClick={() => setCreatingFor(row.lead)}
          />
        );
      default:
        return null;
    }
  }

  const searchPlaceholder =
    view === 'followups' ? 'Search follow-ups…' : 'Search first response…';
  const searchLabel =
    view === 'followups' ? 'Search follow-ups' : 'Search first response';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section className="border-border bg-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border">
        {view === 'followups' ? (
          <FollowUpQueueControls
            search={search}
            onSearchChange={setSearch}
            filters={followUpFilters}
            onFiltersChange={setFollowUpFilters}
            staff={staff}
            showReasons={false}
            sort={prefs.sort}
            onSortChange={(next) =>
              setPrefs((current) => ({ ...current, sort: next }))
            }
            sortColumns={LEAD_FOLLOW_UP_SORT_COLUMNS}
            scope={scope}
            onScopeChange={setScope}
            counts={followUpBucketCounts}
            actions={
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Manage columns"
                      title="Manage columns"
                    />
                  }
                >
                  <Settings className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-48">
                  {LEAD_FOLLOW_UP_COLUMNS.map((column) => {
                    const shown = !prefs.hidden.includes(column.key);
                    return (
                      <DropdownMenuItem
                        key={column.key}
                        closeOnClick={false}
                        disabled={column.required}
                        onClick={() => toggleColumnVisible(column.key)}
                        className="gap-2"
                      >
                        <span
                          className={cn(
                            'flex size-4 shrink-0 items-center justify-center rounded-[4px] border',
                            shown
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-input-border bg-card'
                          )}
                        >
                          {shown && <Check className="size-3.5" />}
                        </span>
                        <span className="truncate">{column.label}</span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />
        ) : (
          <div className="border-border flex shrink-0 flex-wrap items-center gap-2 border-b p-2">
            <SearchInput
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
                aria-label="First response filters"
              >
                <QueueChip
                  value="all"
                  label="All"
                  count={rows.length}
                  helpText="Leads still in New and awaiting their first response."
                />
                <QueueChip
                  value="overdue"
                  label="Overdue"
                  count={summary.firstResponseOverdue}
                  helpText={`Leads that missed the ${FIRST_RESPONSE_HOURS}-hour first-response target.`}
                />
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
                <QueueChip
                  value="unassigned"
                  label="Unassigned"
                  count={summary.unassigned}
                  helpText="Work without a responsible salesperson."
                />
              </ChipGroup>
            </TooltipProvider>

            <Toolbar className="ml-auto" aria-label="First response scope">
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
        )}

        {view === 'followups' && (
          <Collapse open={selected.size > 0}>
            <div className="border-border bg-muted/20 flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="group font-semibold"
                    />
                  }
                >
                  {bulkCount} follow-up{bulkCount === 1 ? '' : 's'} selected
                  <ChevronDown className="size-4 transition-transform duration-150 group-data-[popup-open]:rotate-180" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-56">
                  <DropdownMenuItem onClick={() => setSelected(new Set())}>
                    <X className="size-4" />
                    None
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={selectAllMatching}>
                    <ListChecks className="size-4" />
                    All {filteredRows.length} matching
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="bg-border mx-0.5 h-4 w-px" />

              <GatedButton
                variant="ghost"
                size="sm"
                canAct={canEdit}
                gateReason="complete follow-ups"
                onClick={() => setBulkCompleteOpen(true)}
              >
                <CheckCircle2 />
                Complete
              </GatedButton>

              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setSelected(new Set())}
                aria-label="Clear selection"
                className="ml-auto"
              >
                <X />
              </Button>
            </div>
          </Collapse>
        )}

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
            <Table
              className="table-fixed"
              style={{
                minWidth: tableWidth,
              }}
            >
              <colgroup>
                {view === 'followups' && (
                  <col style={{ width: CHECKBOX_COL_WIDTH }} />
                )}
                {tableColumns.map((column) => (
                  <col
                    key={column.key}
                    style={{ width: displayWidthOf(column) }}
                  />
                ))}
              </colgroup>
              <TableHeader>
                <TableRow>
                  {view === 'followups' && (
                    <TableHead className="px-0">
                      <div className="flex items-center justify-center">
                        <Checkbox
                          checked={allOnPageSelected}
                          indeterminate={
                            !allOnPageSelected && someOnPageSelected
                          }
                          onCheckedChange={toggleSelectAll}
                          disabled={visibleFollowUpIds.length === 0}
                          aria-label="Select all follow-ups on this page"
                        />
                      </div>
                    </TableHead>
                  )}
                  {tableColumns.map((column) => (
                    <TableHead
                      key={column.key}
                      className="text-muted-foreground relative select-none"
                    >
                      {view === 'followups' ? (
                        <>
                          <ColumnHeader
                            label={column.label}
                            sortable={Boolean(column.sortKey)}
                            sortDir={
                              column.sortKey &&
                              prefs.sort?.key === column.sortKey
                                ? prefs.sort.dir
                                : null
                            }
                            onSort={(dir) =>
                              column.sortKey &&
                              sortByColumn(column.sortKey, dir)
                            }
                            filter={columnFilter(column)}
                            onHide={
                              column.required
                                ? undefined
                                : () => hideColumn(column.key)
                            }
                          />
                          <span
                            role="separator"
                            aria-orientation="vertical"
                            onMouseDown={(event) => startResize(event, column)}
                            className="border-border hover:border-primary absolute top-2 right-0 bottom-2 w-1.5 cursor-col-resize border-r hover:border-r-2"
                          />
                        </>
                      ) : column.key === 'dueStatus' ? (
                        'Response window'
                      ) : column.key === 'stageAge' ? (
                        'Waiting'
                      ) : (
                        column.label
                      )}
                    </TableHead>
                  ))}
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
                      tabIndex={0}
                      aria-label={`Open ${row.lead.name || 'lead'} details`}
                      onKeyDown={(event) => {
                        if (event.currentTarget !== event.target) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onOpenLead(row.lead.id, Boolean(followUp));
                        }
                      }}
                    >
                      {view === 'followups' && followUp && (
                        <TableCell
                          className="px-0"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className="flex items-center justify-center">
                            <Checkbox
                              checked={selected.has(followUp.id)}
                              onCheckedChange={() => toggleSelect(followUp.id)}
                              aria-label={`Select ${row.lead.name || 'follow-up'}`}
                            />
                          </div>
                        </TableCell>
                      )}
                      {tableColumns.map((column) => (
                        <TableCell
                          key={column.key}
                          className={cn(
                            'overflow-hidden',
                            column.key === 'assignee' &&
                              view === 'followups' &&
                              canEdit &&
                              'p-0'
                          )}
                          onClick={
                            column.key === 'actions'
                              ? (event) => event.stopPropagation()
                              : undefined
                          }
                        >
                          {column.key === 'assignee' &&
                          view === 'followups' &&
                          followUp &&
                          canEdit ? (
                            <EditableCell
                              editing={editingAssigneeId === followUp.id}
                              saving={savingCell}
                              kind="select"
                              value={followUp.assigned_to ?? ''}
                              options={assigneeCellOptions(staff)}
                              display={renderAssignee(row.ownerId)}
                              onStart={() => setEditingAssigneeId(followUp.id)}
                              onCommit={(value) =>
                                void commitAssignee(followUp, value)
                              }
                              onCancel={() => setEditingAssigneeId(null)}
                            />
                          ) : (
                            renderLeadCell(column.key, row)
                          )}
                        </TableCell>
                      ))}
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
      {creatingFor && (
        <FollowUpDialog
          open
          onOpenChange={(open) => !open && setCreatingFor(null)}
          contactId={creatingFor.id}
          contactName={creatingFor.name}
          onSaved={() => {
            setCreatingFor(null);
            refetch();
          }}
        />
      )}
      <BulkCompleteFollowUpsDialog
        open={bulkCompleteOpen}
        onOpenChange={setBulkCompleteOpen}
        followUpIds={[...selected]}
        context="lead"
        onSaved={refetch}
      />
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
