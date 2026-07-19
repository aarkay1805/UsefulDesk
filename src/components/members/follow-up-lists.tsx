'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { toast } from 'sonner';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  ClipboardCheck,
  ListChecks,
  Loader2,
  Settings,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/lib/errors';
import { createClient } from '@/lib/supabase/client';
import { useLocale } from '@/hooks/use-locale';
import { useTablePrefs } from '@/hooks/use-table-prefs';
import {
  activeFollowUpFilterCount,
  applyFollowUpFilters,
  EMPTY_FOLLOW_UP_FILTERS,
  FOLLOW_UP_BUCKET_OPTIONS,
  UNASSIGNED_FOLLOW_UP,
  type FollowUpBucket,
  type FollowUpFilters as FollowUpFilterState,
} from '@/lib/memberships/follow-up-filters';
import { REASON_LABEL } from '@/lib/memberships/follow-ups';
import type { FollowUp, FollowUpReason } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapse } from '@/components/ui/collapse';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { GatedButton } from '@/components/ui/gated-button';
import { Separator } from '@/components/ui/separator';
import { Chip, ChipGroup } from '@/components/ui/chip';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EditableCell } from '@/components/leads/editable-cell';
import {
  AssigneeDisplay,
  assigneeCellOptions,
} from '@/components/leads/lead-cell-renderers';
import { LeadsSort, type SortState } from '@/components/leads/leads-sort';
import {
  ColumnHeader,
  type ColumnFilterProp,
  type SortDir,
} from '@/components/table/column-header';
import { MemberIdentity } from './member-identity';
import { FollowUpFilters } from './follow-up-filters';
import {
  BulkCompleteFollowUpsDialog,
  CompleteFollowUpDialog,
} from '@/components/follow-ups/complete-follow-up-dialog';
import {
  SendReminderButton,
  type ReminderReadiness,
} from './send-reminder-button';
import { useAccountStaff } from './use-account-staff';

const PAGE_SIZE = 25;
const FOLLOW_UP_SELECT =
  '*, contact:contacts!inner(*), membership:memberships(*, contact:contacts(*), plan:membership_plans(*))';
const FOLLOW_UP_ID_SELECT = 'id, contact:contacts!inner(id)';
const CHECKBOX_COL_WIDTH = 40;

const SORT_COLUMNS: { key: string; label: string }[] = [
  { key: 'customer', label: 'Name' },
  { key: 'due_date', label: 'Due date' },
  { key: 'reason', label: 'Reason' },
  { key: 'created_at', label: 'Created' },
];

type FollowUpFilterDim = 'buckets' | 'reasons' | 'assignees';

interface FollowUpColumn {
  key: string;
  label: string;
  defaultWidth: number;
  minWidth: number;
  required?: boolean;
  sortKey?: string;
  filterDim?: FollowUpFilterDim;
}

const FOLLOW_UP_COLUMNS: FollowUpColumn[] = [
  {
    key: 'customer',
    label: 'Name',
    defaultWidth: 250,
    minWidth: 180,
    required: true,
    sortKey: 'customer',
  },
  {
    key: 'dueDate',
    label: 'Due date',
    defaultWidth: 190,
    minWidth: 150,
    sortKey: 'due_date',
    filterDim: 'buckets',
  },
  {
    key: 'notes',
    label: 'Notes',
    defaultWidth: 320,
    minWidth: 190,
    sortKey: 'reason',
    filterDim: 'reasons',
  },
  {
    key: 'actions',
    label: 'Actions',
    defaultWidth: 180,
    minWidth: 170,
  },
  {
    key: 'assignee',
    label: 'Assigned to',
    defaultWidth: 200,
    minWidth: 150,
    filterDim: 'assignees',
  },
];

const FOLLOW_UP_COLUMN_BY_KEY: Record<string, FollowUpColumn> =
  Object.fromEntries(FOLLOW_UP_COLUMNS.map((column) => [column.key, column]));

const REASON_OPTIONS = (Object.keys(REASON_LABEL) as FollowUpReason[]).map(
  (value) => ({ value, label: REASON_LABEL[value] })
);

interface FollowUpTablePrefs {
  pageSize: number;
  sort: SortState | null;
  order: string[];
  hidden: string[];
  widths: Record<string, number>;
}

const DEFAULT_PREFS: FollowUpTablePrefs = {
  pageSize: PAGE_SIZE,
  sort: null,
  order: [],
  hidden: [],
  widths: {},
};

interface FollowUpListsProps {
  readiness: ReminderReadiness;
  onSelect: (membershipId: string) => void;
  reloadKey: number;
  onChanged: () => void;
  canEdit: boolean;
}

/**
 * The member Follow-ups tab as a contextual data table. It intentionally
 * mirrors All members (server pagination, shared filters/sort, persisted
 * columns, resize, selection, and bulk actions) while keeping only
 * task-specific controls and columns.
 */
export function FollowUpLists({
  readiness,
  onSelect,
  reloadKey,
  onChanged,
  canEdit,
}: FollowUpListsProps) {
  const supabase = useMemo(() => createClient(), []);
  const { fmt } = useLocale();
  const reduceMotion = useReducedMotion();
  const { staff, nameById, avatarById } = useAccountStaff();

  const [rows, setRows] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<FollowUpFilterState>(
    EMPTY_FOLLOW_UP_FILTERS
  );
  const [prefs, setPrefs] = useTablePrefs<FollowUpTablePrefs>(
    'members-follow-ups',
    DEFAULT_PREFS
  );
  const fetchSeq = useRef(0);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [completing, setCompleting] = useState<FollowUp | null>(null);
  const [bulkCompleteOpen, setBulkCompleteOpen] = useState(false);
  const [editingAssigneeId, setEditingAssigneeId] = useState<string | null>(
    null
  );
  const [savingCell, setSavingCell] = useState(false);

  const [bulkCount, setBulkCount] = useState(0);
  if (selected.size > 0 && selected.size !== bulkCount) {
    setBulkCount(selected.size);
  }

  const filterSig = JSON.stringify(filters);
  const [prevFilterSig, setPrevFilterSig] = useState(filterSig);
  if (filterSig !== prevFilterSig) {
    setPrevFilterSig(filterSig);
    setPage(0);
    setSelected(new Set());
  }

  const pageSize = prefs.pageSize || PAGE_SIZE;
  const sort = prefs.sort;
  const today = fmt.today();

  const orderedKeys = useMemo(() => {
    const known = FOLLOW_UP_COLUMNS.map((column) => column.key);
    const saved = prefs.order.filter((key) => known.includes(key));
    const missing = known.filter((key) => !saved.includes(key));
    return [...saved, ...missing];
  }, [prefs.order]);

  const visibleColumns = useMemo(
    () =>
      orderedKeys
        .map((key) => FOLLOW_UP_COLUMN_BY_KEY[key])
        .filter(
          (column): column is FollowUpColumn =>
            Boolean(column) && !prefs.hidden.includes(column.key)
        ),
    [orderedKeys, prefs.hidden]
  );

  const [resizing, setResizing] = useState<{
    key: string;
    width: number;
  } | null>(null);

  function widthOf(column: FollowUpColumn) {
    if (resizing?.key === column.key) return resizing.width;
    return prefs.widths[column.key] ?? column.defaultWidth;
  }

  const totalWidth =
    CHECKBOX_COL_WIDTH +
    visibleColumns.reduce((sum, column) => sum + widthOf(column), 0);

  function startResize(e: React.MouseEvent, column: FollowUpColumn) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = widthOf(column);
    function onMove(event: MouseEvent) {
      const width = Math.max(
        column.minWidth,
        startWidth + (event.clientX - startX)
      );
      setResizing({ key: column.key, width });
    }
    function onUp(event: MouseEvent) {
      const width = Math.max(
        column.minWidth,
        startWidth + (event.clientX - startX)
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

  function toggleColumnFilter(dim: FollowUpFilterDim, value: string) {
    setFilters((current) => {
      const selectedValues = current[dim] as string[];
      const next = selectedValues.includes(value)
        ? selectedValues.filter((item) => item !== value)
        : [...selectedValues, value];
      return { ...current, [dim]: next } as FollowUpFilterState;
    });
  }

  function filterFor(column: FollowUpColumn): ColumnFilterProp | undefined {
    if (!column.filterDim) return undefined;
    const options =
      column.filterDim === 'buckets'
        ? FOLLOW_UP_BUCKET_OPTIONS
        : column.filterDim === 'reasons'
          ? REASON_OPTIONS
          : [
              { value: UNASSIGNED_FOLLOW_UP, label: 'Unassigned' },
              ...staff.map((member) => ({
                value: member.user_id,
                label: member.full_name,
              })),
            ];
    return {
      options,
      selected: filters[column.filterDim] as string[],
      onToggle: (value) => toggleColumnFilter(column.filterDim!, value),
    };
  }

  function setBuckets(buckets: FollowUpBucket[]) {
    setFilters((current) => ({
      ...current,
      buckets,
    }));
  }

  async function commitAssignee(followUp: FollowUp, rawValue: string) {
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
      setRows((current) =>
        current.map((row) =>
          row.id === followUp.id ? { ...row, assigned_to: assignedTo } : row
        )
      );
      toast.success('Follow-up reassigned');
    } finally {
      setSavingCell(false);
      setEditingAssigneeId(null);
    }
  }

  function renderAssignee(followUp: FollowUp) {
    if (!followUp.assigned_to) {
      return <span className="text-muted-foreground text-sm">Unassigned</span>;
    }
    return (
      <AssigneeDisplay
        name={nameById.get(followUp.assigned_to) ?? 'Teammate'}
        avatarUrl={avatarById.get(followUp.assigned_to)}
      />
    );
  }

  function renderCell(key: string, followUp: FollowUp) {
    switch (key) {
      case 'customer':
        return (
          <MemberIdentity
            name={followUp.contact?.name}
            secondary={followUp.contact?.phone || followUp.contact?.email}
            src={followUp.contact?.avatar_url}
          />
        );
      case 'dueDate': {
        const bucket: FollowUpBucket =
          followUp.due_date < today
            ? 'overdue'
            : followUp.due_date === today
              ? 'today'
              : 'upcoming';
        const variant =
          bucket === 'overdue'
            ? 'danger'
            : bucket === 'today'
              ? 'warning'
              : 'neutral';
        return (
          <div className="flex items-center gap-2">
            <Badge variant={variant}>
              {FOLLOW_UP_BUCKET_OPTIONS.find(
                (option) => option.value === bucket
              )?.label ?? 'Upcoming'}
            </Badge>
            <span className="text-muted-foreground text-xs tabular-nums">
              {fmt.date(followUp.due_date)}
            </span>
          </div>
        );
      }
      case 'notes':
        return (
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant="neutral">{REASON_LABEL[followUp.reason]}</Badge>
            <span
              className="text-muted-foreground min-w-0 truncate text-sm"
              title={followUp.note ?? undefined}
            >
              {followUp.note || 'No note'}
            </span>
          </div>
        );
      case 'actions':
        return (
          <div className="flex items-center gap-1">
            <GatedButton
              size="sm"
              variant="ghost"
              canAct={canEdit}
              gateReason="complete follow-ups"
              onClick={() => setCompleting(followUp)}
            >
              <CircleCheck className="size-3.5" />
              Done
            </GatedButton>
            {followUp.membership && (
              <SendReminderButton
                membership={followUp.membership}
                readiness={readiness}
              />
            )}
          </div>
        );
      case 'assignee':
        return renderAssignee(followUp);
      default:
        return null;
    }
  }

  useEffect(() => {
    const seq = ++fetchSeq.current;
    let cancelled = false;
    (async () => {
      setLoading(true);
      let query = supabase
        .from('follow_ups')
        .select(FOLLOW_UP_SELECT, { count: 'exact' })
        .eq('status', 'open')
        .not('membership_id', 'is', null);

      query = applyFollowUpFilters(query, filters, fmt.today());

      if (sort?.key === 'customer') {
        query = query.order('contact(name)', {
          ascending: sort.dir === 'asc',
        });
      } else if (sort) {
        query = query.order(sort.key, { ascending: sort.dir === 'asc' });
      } else {
        query = query.order('due_date', { ascending: true });
      }

      const from = page * pageSize;
      const { data, count, error } = await query.range(
        from,
        from + pageSize - 1
      );
      if (cancelled || seq !== fetchSeq.current) return;
      if (error) {
        toast.error(getErrorMessage(error, 'Failed to load follow-ups'));
      } else {
        setRows((data as FollowUp[]) ?? []);
        setTotalCount(count ?? 0);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, reloadKey, filters, sort, page, pageSize, fmt]);

  const totalPages = Math.ceil(totalCount / pageSize);
  const hasPrev = page > 0;
  const hasNext = page < totalPages - 1;
  const allOnPageSelected =
    rows.length > 0 && rows.every((row) => selected.has(row.id));
  const someOnPageSelected = rows.some((row) => selected.has(row.id));

  function toggleSelect(followUp: FollowUp) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(followUp.id)) next.delete(followUp.id);
      else next.add(followUp.id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((current) => {
      const next = new Set(current);
      if (allOnPageSelected) rows.forEach((row) => next.delete(row.id));
      else rows.forEach((row) => next.add(row.id));
      return next;
    });
  }

  async function selectAllMatching() {
    let query = supabase
      .from('follow_ups')
      .select(FOLLOW_UP_ID_SELECT)
      .eq('status', 'open')
      .not('membership_id', 'is', null);
    query = applyFollowUpFilters(query, filters, fmt.today());
    const { data, error } = await query;
    if (error) {
      toast.error(getErrorMessage(error, 'Failed to select follow-ups'));
      return;
    }
    setSelected(
      new Set(((data as { id: string }[]) ?? []).map((row) => row.id))
    );
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function saved() {
    setCompleting(null);
    setBulkCompleteOpen(false);
    setSelected(new Set());
    onChanged();
  }

  return (
    <>
      <section className="border-border bg-card overflow-hidden rounded-2xl border">
        <div className="border-border flex flex-wrap items-center gap-2 border-b p-2">
          <LayoutGroup id="follow-up-table-filter-controls">
            <div className="flex shrink-0 items-center gap-2">
              <FollowUpFilters
                value={filters}
                onChange={setFilters}
                staff={staff}
              />
              <motion.div
                layout="position"
                transition={{
                  duration: reduceMotion ? 0 : 0.2,
                  ease: [0.2, 0, 0, 1],
                }}
                className="flex items-center gap-2"
              >
                <LeadsSort
                  value={sort}
                  onChange={(next) =>
                    setPrefs((current) => ({ ...current, sort: next }))
                  }
                  columns={SORT_COLUMNS}
                />
                <Separator
                  orientation="vertical"
                  className="mx-0.5 h-5 data-vertical:self-center"
                />
                <ChipGroup<FollowUpBucket>
                  selectionMode="single"
                  value={filters.buckets}
                  onValueChange={setBuckets}
                  aria-label="Due date quick filters"
                >
                  {FOLLOW_UP_BUCKET_OPTIONS.map((option) => (
                    <Chip key={option.value} value={option.value}>
                      {option.label}
                    </Chip>
                  ))}
                </ChipGroup>
              </motion.div>
            </div>
          </LayoutGroup>

          <div className="ml-auto flex shrink-0 items-center">
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
                {FOLLOW_UP_COLUMNS.map((column) => {
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
          </div>
        </div>

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
                <DropdownMenuItem onClick={clearSelection}>
                  <X className="size-4" />
                  None
                </DropdownMenuItem>
                <DropdownMenuItem onClick={selectAllMatching}>
                  <ListChecks className="size-4" />
                  All {totalCount} matching
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
              <CircleCheck />
              Complete
            </GatedButton>

            <Button
              variant="ghost"
              size="icon-sm"
              onClick={clearSelection}
              aria-label="Clear selection"
              className="ml-auto"
            >
              <X />
            </Button>
          </div>
        </Collapse>

        {loading && rows.length === 0 ? (
          <div className="text-muted-foreground flex items-center gap-2 px-3 py-10 text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading follow-ups…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <ClipboardCheck className="text-muted-foreground size-8" />
            <p className="text-muted-foreground text-sm">
              {activeFollowUpFilterCount(filters) === 0
                ? 'No open member follow-ups.'
                : 'No follow-ups match your filters.'}
            </p>
          </div>
        ) : (
          <div className="min-w-0">
            <Table className="table-fixed" style={{ minWidth: totalWidth }}>
              <colgroup>
                <col style={{ width: CHECKBOX_COL_WIDTH }} />
                {visibleColumns.map((column) => (
                  <col key={column.key} style={{ width: widthOf(column) }} />
                ))}
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-0">
                    <div className="flex items-center justify-center">
                      <Checkbox
                        checked={allOnPageSelected}
                        indeterminate={!allOnPageSelected && someOnPageSelected}
                        onCheckedChange={toggleSelectAll}
                        disabled={rows.length === 0}
                        aria-label="Select all follow-ups on this page"
                      />
                    </div>
                  </TableHead>
                  {visibleColumns.map((column) => (
                    <TableHead
                      key={column.key}
                      className="text-muted-foreground relative select-none"
                    >
                      <ColumnHeader
                        label={column.label}
                        sortable={Boolean(column.sortKey)}
                        sortDir={
                          column.sortKey && sort?.key === column.sortKey
                            ? sort.dir
                            : null
                        }
                        onSort={(dir) =>
                          column.sortKey && sortByColumn(column.sortKey, dir)
                        }
                        filter={filterFor(column)}
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
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((followUp) => (
                  <TableRow
                    key={followUp.id}
                    className="cursor-pointer"
                    onClick={() => onSelect(followUp.membership_id!)}
                  >
                    <TableCell
                      className="px-0"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="flex items-center justify-center">
                        <Checkbox
                          checked={selected.has(followUp.id)}
                          onCheckedChange={() => toggleSelect(followUp)}
                          aria-label={`Select ${followUp.contact?.name || 'follow-up'}`}
                        />
                      </div>
                    </TableCell>
                    {visibleColumns.map((column) => (
                      <TableCell
                        key={column.key}
                        className={cn(
                          'overflow-hidden',
                          column.key === 'assignee' && canEdit && 'p-0'
                        )}
                        onClick={
                          column.key === 'actions'
                            ? (event) => event.stopPropagation()
                            : undefined
                        }
                      >
                        {column.key === 'assignee' && canEdit ? (
                          <EditableCell
                            editing={editingAssigneeId === followUp.id}
                            saving={savingCell}
                            kind="select"
                            value={followUp.assigned_to ?? ''}
                            options={assigneeCellOptions(staff)}
                            display={renderAssignee(followUp)}
                            onStart={() => setEditingAssigneeId(followUp.id)}
                            onCommit={(value) =>
                              void commitAssignee(followUp, value)
                            }
                            onCancel={() => setEditingAssigneeId(null)}
                          />
                        ) : (
                          renderCell(column.key, followUp)
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="border-border flex items-center justify-between border-t px-3 py-2">
              <p className="text-muted-foreground text-xs">
                {totalCount > 0
                  ? `${totalCount} follow-up${totalCount === 1 ? '' : 's'}`
                  : 'No follow-ups'}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={!hasPrev}
                  onClick={() => setPage((current) => current - 1)}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="text-muted-foreground px-2 text-xs">
                  Page {page + 1} of {Math.max(totalPages, 1)}
                </span>
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={!hasNext}
                  onClick={() => setPage((current) => current + 1)}
                  aria-label="Next page"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </section>

      {completing && (
        <CompleteFollowUpDialog
          open={Boolean(completing)}
          onOpenChange={(open) => {
            if (!open) setCompleting(null);
          }}
          followUp={completing}
          onSaved={saved}
        />
      )}
      <BulkCompleteFollowUpsDialog
        open={bulkCompleteOpen}
        onOpenChange={setBulkCompleteOpen}
        followUpIds={[...selected]}
        onSaved={saved}
      />
    </>
  );
}
