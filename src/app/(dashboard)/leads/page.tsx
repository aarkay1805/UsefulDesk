'use client';

// Leads — the merged Contacts + Pipelines section. A lead IS a
// contacts row (no separate entity); contacts that hold a membership
// are members and live under /members instead, so every query here
// anti-joins memberships. Two views over the same list:
//   table — the former Contacts table, plus a Status column
//   board — kanban by lead_status (the former pipeline board's role)

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  startTransition,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type {
  Contact,
  LeadStatus,
  Tag,
  ContactTag,
  CustomField,
} from '@/types';
import {
  columnToStatus,
  leadColumnKey,
  type LeadColumnKey,
} from '@/lib/leads/status';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import {
  sourceLabel,
  genderLabel,
  autoReceivedLabel,
} from '@/lib/leads/attributes';
import { toCsv, downloadCsv } from '@/lib/csv/export';
import {
  DEFAULT_FIELD_OPTIONS,
  statusColumn,
  statusColumns,
  type LeadFieldKind,
} from '@/lib/leads/field-options';
import { useLeadFieldOptions } from '@/hooks/use-lead-field-options';
import { EditFieldOptionsDialog } from '@/components/leads/edit-field-options-dialog';
import { formatCustomFieldValue } from '@/lib/contacts/custom-fields';
import { currencySymbol } from '@/lib/currency';
import { useLocale } from '@/hooks/use-locale';
import { Badge } from '@/components/ui/badge';
import { UserAvatar } from '@/components/ui/user-avatar';
import { Button } from '@/components/ui/button';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Plus,
  Upload,
  Download,
  Eye,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  StickyNote,
  UserCheck,
  Users,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ListChecks,
  Settings,
  LayoutGrid,
  List,
  Columns3,
  X,
  Check,
  Ban,
} from 'lucide-react';
import { PageHeaderActions } from '@/components/layout/page-header-actions';
import { ContactForm } from '@/components/contacts/contact-form';
import { ContactDetailView } from '@/components/contacts/contact-detail-view';
import { ImportWizard } from '@/components/contacts/import-wizard';
import { ViewSettingsSheet } from '@/components/leads/view-settings-sheet';
import {
  LeadsFilters,
  EMPTY_FILTERS,
  activeFilterCount,
  UNASSIGNED,
  PENDING_FILTER_PREFIX,
  type LeadFilters,
} from '@/components/leads/leads-filters';
import { LeadsSort } from '@/components/leads/leads-sort';
import { useAccountStaff } from '@/components/members/use-account-staff';
import {
  ManageColumnsDialog,
  type ManageColumn,
} from '@/components/contacts/manage-columns-dialog';
import { LeadsBoardView } from '@/components/leads/leads-board-view';
import { ColumnHeader } from '@/components/table/column-header';
import type {
  BoardDensity,
  BoardSortWithin,
} from '@/components/leads/leads-board';
import { EditableCell } from '@/components/leads/editable-cell';
import {
  BulkEditDialog,
  type BulkEditProperty,
} from '@/components/leads/bulk-edit-dialog';
import { BulkAddNoteDialog } from '@/components/leads/bulk-add-note-dialog';
import { BulkConvertDialog } from '@/components/leads/bulk-convert-dialog';
import { SourceIcon } from '@/components/leads/source-icon';
import {
  AssigneeDisplay,
  PendingAssigneeDisplay,
  StatusBadge,
  TransferPendingDisplay,
  assigneeCellOptions,
  customEditKind,
  genderCellOptions,
  sourceCellOptions,
  statusCellOptions,
} from '@/components/leads/lead-cell-renderers';
import { TransferRequestDialog } from '@/components/leads/transfer-request-dialog';
import {
  cancelLeadAssignment,
  cancelLeadTransfer,
  fetchPendingTransfers,
  pendingTransferMap,
  requestLeadAssignment,
  requestLeadTransfer,
  respondLeadAssignment,
  respondLeadTransfer,
} from '@/lib/leads/transfers';
import {
  canDeleteAnyLead,
  canDeleteLead,
  canReassignLeadsDirectly,
  canRequestLeadTransfer,
  canResolveAnyLeadTransfer,
} from '@/lib/auth/roles';
import type { LeadTransfer } from '@/types';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { useTablePrefs } from '@/hooks/use-table-prefs';
import { GatedButton } from '@/components/ui/gated-button';
import { SearchInput } from '@/components/ui/search-input';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Collapse } from '@/components/ui/collapse';

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];
// Names this surface's saved view in `table_preferences` (per-user,
// per-account). Was a global localStorage key until migration 053.
const PREFS_VIEW_KEY = 'leads';
// The board loads every column at once, so it is capped to the most
// recent leads rather than paginated. Past this size the owner should
// be working the table/action lists, not a 500-card wall.
const BOARD_LIMIT = 500;

// Fixed utility columns flank the managed columns and aren't user-editable.
const CHECKBOX_COL_WIDTH = 44;
const ACTIONS_COL_WIDTH = 48;

// Applied to every cell of the column being dragged (header + body) so the
// whole strip reads as "picked up": the opaque card surface, which cleanly
// occludes the columns it slides over (no text bleed-through, zero GPU
// cost), lifted above its neighbours (z-20). The drop shadow is NOT here —
// a per-cell box-shadow both seams between rows and is swallowed entirely
// by a `border-collapse: collapse` table (Tailwind's preflight default).
// Instead one overlay element draws a single continuous column shadow (see
// the drag-shadow overlay in the table below).
const DRAG_COLUMN_CLASS = 'relative z-20 bg-card';

type ViewMode = 'wrap' | 'clip';
type LeadsView = 'table' | 'board';

interface TablePrefs {
  order: string[];
  hidden: string[];
  widths: Record<string, number>;
  pageSize: number;
  viewMode: ViewMode;
  view: LeadsView;
  // Active column sort (null = default created_at desc).
  sort: SortState | null;
  // Number of leading visible columns pinned to the left (sticky).
  frozenCount: number;
  // Board view settings (Tier 1) — density + card order within a column.
  // Shares this 'leads' prefs row (migration 053); the table ignores it.
  board: {
    density: BoardDensity;
    sortWithin: BoardSortWithin;
    collapseEmpty: boolean;
  };
}

const DEFAULT_PREFS: TablePrefs = {
  order: [],
  hidden: [],
  widths: {},
  pageSize: DEFAULT_PAGE_SIZE,
  viewMode: 'clip',
  view: 'table',
  sort: null,
  frozenCount: 0,
  board: { density: 'comfortable', sortWithin: 'newest', collapseEmpty: false },
};

interface ContactWithData extends Contact {
  tags?: Tag[];
  customValues?: Record<string, string>;
}

// How a cell edits inline. `column` writes a contacts row column;
// 'status' writes lead_status; 'select' picks a preset for a free-text
// column (source/gender); 'tags' toggles contact_tags rows; 'custom'
// upserts a contact_custom_values row. Two columns stay read-only by
// design: `name` (clicking it opens the detail sheet — the row's main
// affordance) and `created` (system audit column).
type EditSpec =
  | { kind: 'text'; column: 'company' | 'phone' }
  | { kind: 'email'; column: 'email' }
  | { kind: 'select'; column: 'source' | 'gender' }
  | { kind: 'status' }
  // Lead owner — writes contacts.assigned_to (profiles user_id, '' = unassigned).
  | { kind: 'assignee' }
  | { kind: 'tags' }
  | { kind: 'custom'; fieldId: string };

interface ColumnDef {
  key: string;
  label: string;
  required?: boolean;
  isCustom?: boolean;
  defaultWidth: number;
  minWidth: number;
  render: (c: ContactWithData) => React.ReactNode;
  edit?: EditSpec;
  // The `contacts` column this maps to for server-side sorting. Columns
  // without one (custom fields — values live in a join table) can't
  // be sorted and hide their sort controls.
  sortColumn?: string;
  // Columns whose values can't be server-`.order()`d — person uuids that
  // only mean something once resolved to a name, or tags in a join table.
  // These sort client-side over the full filtered id set (like custom
  // fields). See fetchContacts' clientSort branch.
  clientSort?:
    | { kind: 'person'; column: 'assigned_to' | 'created_by' }
    | { kind: 'tags' };
  // For custom columns: the field's stored data type (see CUSTOM_FIELD_TYPES).
  customType?: string;
  // Option-backed columns: which editable option list feeds this
  // column. Drives the header menu's "Edit options" item ('tags'
  // routes to the tag manager in Settings).
  optionsField?: LeadFieldKind | 'tags';
}

type SortDir = 'asc' | 'desc';
interface SortState {
  key: string;
  dir: SortDir;
}

// A resolved client-side sort — the active sort maps to a column with no
// server-orderable `contacts` column, so fetchContacts orders the full
// filtered id set in JS. `custom` reads contact_custom_values; `person`
// resolves a uuid column to a teammate name; `tags` reads the join table.
type ClientSort =
  | { kind: 'custom'; fieldId: string; type: string; dir: SortDir }
  | { kind: 'person'; column: 'assigned_to' | 'created_by'; dir: SortDir }
  | { kind: 'tags'; dir: SortDir };

// Per-column Excel-style value filter, threaded from the page into each
// header's overflow menu. `selected` mirrors the shared LeadFilters state
// so the column filter and the global Filters panel never drift.
interface ColumnFilterProp {
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}

function renderTags(c: ContactWithData) {
  if (!c.tags || c.tags.length === 0) {
    return <span className="text-muted-foreground text-xs">-</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {c.tags.slice(0, 3).map((tag) => (
        <Badge key={tag.id} variant="neutral">
          {tag.name}
        </Badge>
      ))}
      {c.tags.length > 3 && (
        <span className="text-muted-foreground text-[10px]">
          +{c.tags.length - 3}
        </span>
      )}
    </div>
  );
}

// Default-status fallback render — liveColumns overrides it with the
// account's list; this keeps the static defs crash-safe for any key.
const DEFAULT_STATUS_COLUMNS = statusColumns(DEFAULT_FIELD_OPTIONS.status);

function renderLeadStatus(c: ContactWithData) {
  const col = statusColumn(DEFAULT_STATUS_COLUMNS, c.lead_status);
  return <StatusBadge column={col} />;
}

const BUILTIN_COLUMNS: ColumnDef[] = [
  {
    key: 'name',
    label: 'Name',
    required: true,
    defaultWidth: 220,
    minWidth: 120,
    sortColumn: 'name',
    render: (c) =>
      c.name ? (
        <span className="text-foreground font-medium">{c.name}</span>
      ) : (
        <span className="text-muted-foreground italic">Unnamed</span>
      ),
  },
  {
    key: 'status',
    label: 'Status',
    defaultWidth: 150,
    minWidth: 110,
    sortColumn: 'lead_status',
    render: renderLeadStatus,
    edit: { kind: 'status' },
    optionsField: 'status',
  },
  {
    key: 'phone',
    label: 'Phone',
    defaultWidth: 150,
    minWidth: 110,
    sortColumn: 'phone',
    render: (c) => (
      <span className="text-muted-foreground font-mono text-sm">{c.phone}</span>
    ),
    edit: { kind: 'text', column: 'phone' },
  },
  {
    key: 'email',
    label: 'Email',
    defaultWidth: 240,
    minWidth: 140,
    sortColumn: 'email',
    render: (c) => (
      <span className="text-muted-foreground text-sm">{c.email || '-'}</span>
    ),
    edit: { kind: 'email', column: 'email' },
  },
  {
    key: 'company',
    label: 'Company',
    defaultWidth: 160,
    minWidth: 120,
    sortColumn: 'company',
    render: (c) => (
      <span className="text-muted-foreground text-sm">{c.company || '-'}</span>
    ),
    edit: { kind: 'text', column: 'company' },
  },
  {
    key: 'source',
    label: 'Source',
    defaultWidth: 130,
    minWidth: 100,
    sortColumn: 'source',
    render: (c) =>
      c.source ? (
        <SourceIcon source={c.source} label={sourceLabel(c.source)} />
      ) : (
        <span className="text-muted-foreground text-sm">—</span>
      ),
    edit: { kind: 'select', column: 'source' },
    optionsField: 'source',
  },
  {
    key: 'gender',
    label: 'Gender',
    defaultWidth: 110,
    minWidth: 90,
    sortColumn: 'gender',
    render: (c) => (
      <span className="text-muted-foreground text-sm">
        {genderLabel(c.gender)}
      </span>
    ),
    edit: { kind: 'select', column: 'gender' },
    optionsField: 'gender',
  },
  {
    key: 'assignee',
    label: 'Assigned to',
    defaultWidth: 170,
    minWidth: 130,
    // assigned_to is a uuid — ordering by it raw is noise, so sort
    // client-side by the resolved teammate name instead.
    clientSort: { kind: 'person', column: 'assigned_to' },
    // Static fallback; liveColumns overrides with the staff roster
    // (names + avatars) once useAccountStaff resolves.
    render: (c) =>
      c.assigned_to ? (
        <span className="text-muted-foreground text-sm">Assigned</span>
      ) : (
        <span className="text-muted-foreground text-sm">Unassigned</span>
      ),
    edit: { kind: 'assignee' },
  },
  {
    key: 'received_by',
    label: 'Received By',
    defaultWidth: 170,
    minWidth: 130,
    // Groups leads by origin channel; ordering by the raw text is useful
    // (all "Auto · WhatsApp" together), unlike the assignee uuid.
    sortColumn: 'received_via',
    // Immutable origin — no `edit`. Static fallback renders the auto pill
    // only; liveColumns overrides it to show the creating teammate for
    // human origins (needs the staff roster).
    render: (c) => {
      const auto = autoReceivedLabel(c.received_via);
      return auto ? (
        <Badge variant="neutral">{auto}</Badge>
      ) : (
        <span className="text-muted-foreground text-sm">—</span>
      );
    },
  },
  {
    key: 'created_by',
    label: 'Created by',
    defaultWidth: 160,
    minWidth: 120,
    // Immutable original creator (migration 051) — audit; never changes on
    // transfer. No edit. created_by is a uuid, so sort client-side by the
    // resolved teammate name. Static fallback; liveColumns overrides to
    // show the teammate once the staff roster resolves.
    clientSort: { kind: 'person', column: 'created_by' },
    render: (c) =>
      c.created_by ? (
        <span className="text-muted-foreground text-sm">Created</span>
      ) : (
        <span className="text-muted-foreground text-sm">—</span>
      ),
  },
  {
    key: 'tags',
    label: 'Tags',
    defaultWidth: 180,
    minWidth: 120,
    // Tags live in a join table — sort client-side by each lead's
    // alphabetically-first tag name.
    clientSort: { kind: 'tags' },
    render: renderTags,
    edit: { kind: 'tags' },
    optionsField: 'tags',
  },
  {
    key: 'created',
    label: 'Created on',
    defaultWidth: 120,
    minWidth: 100,
    sortColumn: 'created_at',
    render: (c) => <CreatedDateCell value={c.created_at} />,
  },
];

// Column defs are module constants with no hook access — dates render
// through this tiny component so they follow the account locale.
function CreatedDateCell({ value }: { value: string }) {
  const { fmt } = useLocale();
  return (
    <span className="text-muted-foreground text-sm">{fmt.date(value)}</span>
  );
}

function customColumn(
  field: CustomField,
  currency?: string,
  localeTag?: string,
): ColumnDef {
  return {
    key: `cf:${field.id}`,
    label: field.field_name,
    isCustom: true,
    customType: field.field_type,
    defaultWidth: 160,
    minWidth: 120,
    render: (c) => {
      const raw = c.customValues?.[field.id];
      return (
        <span className="text-muted-foreground text-sm">
          {raw
            ? formatCustomFieldValue(raw, field.field_type, currency, localeTag)
            : '-'}
        </span>
      );
    },
    edit: { kind: 'custom', fieldId: field.id },
  };
}

// Per-column header (HubSpot-style). Thin adapter over the shared
// `ColumnHeader` (src/components/table/column-header.tsx) — maps this
// page's ColumnDef onto the generic surface and opts into the full set of
// column actions (freeze / add / edit-options / smart-property placeholder).
// The all-members table renders the same ColumnHeader with a lighter set.
function HeaderCell({
  col,
  sortDir,
  frozen,
  onSort,
  onToggleFreeze,
  onAddColumn,
  onRemoveColumn,
  onEditOptions,
  filter,
  dragHandleProps,
}: {
  col: ColumnDef;
  sortDir: SortDir | null;
  frozen: boolean;
  onSort: (dir: SortDir) => void;
  onToggleFreeze: () => void;
  onAddColumn: () => void;
  onRemoveColumn: () => void;
  /** Option-backed columns only (admins): edit the column's choices. */
  onEditOptions?: () => void;
  /** Excel-style value filter for enumerable columns — a checkbox list
      of the column's possible values that show/hide rows. Absent for
      free-text columns (name/phone/email/…). */
  filter?: ColumnFilterProp;
  /** Sortable drag listeners+attributes — spread on the label (the grab
      surface). Absent when column drag is disabled. */
  dragHandleProps?: React.HTMLAttributes<HTMLSpanElement>;
}) {
  const sortable =
    Boolean(col.sortColumn) || Boolean(col.isCustom) || Boolean(col.clientSort);
  return (
    <ColumnHeader
      label={col.label}
      sortable={sortable}
      sortDir={sortDir}
      onSort={onSort}
      filter={filter}
      onHide={onRemoveColumn}
      hideDisabled={col.required}
      frozen={frozen}
      onToggleFreeze={onToggleFreeze}
      onAddColumn={onAddColumn}
      onEditOptions={onEditOptions}
      smartPropertyPlaceholder
      dragHandleProps={dragHandleProps}
    />
  );
}

// A header cell wrapped as a horizontal sortable item. Owns the <th>
// (so the sortable ref/transform live on it) and threads the drag
// listeners down to HeaderCell's label. Resize grip + sticky freeze
// styling ride along unchanged — the grip uses mouse events so it never
// collides with the pointer-based drag sensor, and the label-only handle
// keeps the sort arrows / overflow menu clickable.
function DraggableHeaderCell({
  col,
  isFrozen,
  frozenStyle,
  dragX,
  sortDir,
  onSort,
  onToggleFreeze,
  onAddColumn,
  onRemoveColumn,
  onEditOptions,
  filter,
  onResizeStart,
}: {
  col: ColumnDef;
  isFrozen: boolean;
  frozenStyle?: React.CSSProperties;
  /** Live pointer delta while THIS column is the one being dragged. */
  dragX: number;
  sortDir: SortDir | null;
  onSort: (dir: SortDir) => void;
  onToggleFreeze: () => void;
  onAddColumn: () => void;
  onRemoveColumn: () => void;
  onEditOptions?: () => void;
  filter?: ColumnFilterProp;
  onResizeStart: (e: React.MouseEvent) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: col.key });

  const style: React.CSSProperties = {
    ...frozenStyle,
    // For the dragged header, ignore dnd-kit's transform (it carries a Y
    // offset + scaleX/scaleY sized to the hovered column, which distorts
    // the label) and use a pure X translate matching the body cells, so
    // the whole strip moves as one rigid column. Other headers keep their
    // dnd transform to shift open the drop slot.
    transform: isDragging
      ? `translateX(${dragX}px)`
      : CSS.Transform.toString(transform),
    // No transition on the active header so it tracks the pointer instantly
    // (in lockstep with the body); neighbours keep their shift animation.
    transition: isDragging ? 'none' : transition,
    // Lift the dragged header above its sticky/frozen neighbours.
    ...(isDragging ? { zIndex: 40 } : {}),
  };

  return (
    <TableHead
      ref={setNodeRef}
      style={style}
      className={cn(
        'text-muted-foreground select-none',
        // Positioned ancestor for the resize grip — sticky frozen cells
        // already establish one.
        isFrozen ? 'bg-card z-20' : 'relative',
        // Elevated look while this header is the one being dragged.
        isDragging && DRAG_COLUMN_CLASS
      )}
    >
      <HeaderCell
        col={col}
        sortDir={sortDir}
        frozen={isFrozen}
        onSort={onSort}
        onToggleFreeze={onToggleFreeze}
        onAddColumn={onAddColumn}
        onRemoveColumn={onRemoveColumn}
        onEditOptions={onEditOptions}
        filter={filter}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
      {/* Resize grip on the right edge */}
      <span
        role="separator"
        aria-orientation="vertical"
        onMouseDown={onResizeStart}
        className={cn(
          'border-border hover:border-primary absolute top-2 right-0 bottom-2 w-1.5 cursor-col-resize',
          // Drop the resize grip's border while dragging so it doesn't read
          // as a stray separator stuck to the lifted column's right edge.
          isDragging ? 'border-r-0' : 'border-r hover:border-r-2'
        )}
      />
    </TableHead>
  );
}

// Debounce a rapidly-changing value (e.g. the search input) so the fetch
// fires on a pause, not every keystroke.
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

// Resolve a create-date preset to an ISO lower bound (or null for "any").
function createdRangeSince(range: LeadFilters['createdRange']): string | null {
  if (!range) return null;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (range) {
    case 'today':
      return start.toISOString();
    case '7d':
      start.setDate(start.getDate() - 6);
      return start.toISOString();
    case '30d':
      start.setDate(start.getDate() - 29);
      return start.toISOString();
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }
}

// Resolve the Tags filter to the contact ids carrying any of the selected
// tags (null = no tag filter, [] = filter active but nothing matches).
async function resolveTagContactIds(
  supabase: ReturnType<typeof createClient>,
  tagIds: string[]
): Promise<string[] | null> {
  if (tagIds.length === 0) return null;
  const { data } = await supabase
    .from('contact_tags')
    .select('contact_id')
    .in('tag_id', tagIds);
  return [...new Set((data ?? []).map((r) => r.contact_id))];
}

// Custom-field types that get a value filter — enumerable/scannable ones.
// Excludes email/phone/url/date (a distinct-value checkbox list is noise
// there; email/phone/url aren't bucketed, dates want a range).
const CUSTOM_FILTER_TYPES = new Set(['text', 'number', 'currency']);

// Resolve a custom-field value filter to the contact ids whose stored value
// for that field is one of `values`.
async function resolveCustomValueContactIds(
  supabase: ReturnType<typeof createClient>,
  fieldId: string,
  values: string[]
): Promise<string[]> {
  const { data } = await supabase
    .from('contact_custom_values')
    .select('contact_id')
    .eq('custom_field_id', fieldId)
    .in('value', values);
  return [...new Set((data ?? []).map((r) => r.contact_id))];
}

// Combine every contact-id-restricting filter (tags + custom-field values)
// into one id list — AND across dimensions (a lead must satisfy them all),
// so the sets are intersected. Returns null when no id-based filter is
// active, or [] when one is active but matches nothing (caller
// short-circuits to an empty result).
async function resolveContactIdFilter(
  supabase: ReturnType<typeof createClient>,
  filters: LeadFilters
): Promise<string[] | null> {
  const sets: string[][] = [];
  const tagIds = await resolveTagContactIds(supabase, filters.tags);
  if (tagIds) sets.push(tagIds);
  for (const [fieldId, vals] of Object.entries(filters.customValues)) {
    if (!vals.length) continue;
    sets.push(await resolveCustomValueContactIds(supabase, fieldId, vals));
  }
  if (sets.length === 0) return null;
  let acc = sets[0];
  for (let i = 1; i < sets.length; i++) {
    const s = new Set(sets[i]);
    acc = acc.filter((id) => s.has(id));
  }
  return acc;
}

// Minimal chainable shape shared by the PostgREST filter builders we
// use — lets one helper apply the lead filters to any of them.
interface FilterableQuery<Q> {
  in(column: string, values: readonly string[]): Q;
  or(filters: string): Q;
  is(column: string, value: null): Q;
  gte(column: string, value: string): Q;
}

// Apply the Filters panel selections to a contacts query. `idFilter` is the
// pre-resolved tag + custom-value → contact-id constraint (intersection;
// see resolveContactIdFilter).
function applyLeadFilters<Q extends FilterableQuery<Q>>(
  query: Q,
  filters: LeadFilters,
  idFilter: string[] | null
): Q {
  let q = query;
  if (idFilter) q = q.in('id', idFilter);

  if (filters.leadStatus.length) {
    const hasNew = filters.leadStatus.includes('new');
    const statuses = filters.leadStatus.filter((k) => k !== 'new');
    if (hasNew && statuses.length) {
      q = q.or(`lead_status.is.null,lead_status.in.(${statuses.join(',')})`);
    } else if (hasNew) {
      q = q.is('lead_status', null);
    } else {
      q = q.in('lead_status', statuses);
    }
  }
  if (filters.source.length) q = q.in('source', filters.source);
  if (filters.gender.length) q = q.in('gender', filters.gender);
  if (filters.owner.length) q = q.in('user_id', filters.owner);
  if (filters.createdBy.length) q = q.in('created_by', filters.createdBy);

  if (filters.assigned.length) {
    // The "Assigned to" filter mixes three buckets, OR'd together:
    // Unassigned, real staff (assigned_to), and pending invites
    // (pending_invitation_id, values prefixed `pending:`).
    const parts: string[] = [];
    if (filters.assigned.includes(UNASSIGNED)) parts.push('assigned_to.is.null');
    const realIds = filters.assigned.filter(
      (a) => a !== UNASSIGNED && !a.startsWith(PENDING_FILTER_PREFIX)
    );
    if (realIds.length) parts.push(`assigned_to.in.(${realIds.join(',')})`);
    const pendingIds = filters.assigned
      .filter((a) => a.startsWith(PENDING_FILTER_PREFIX))
      .map((a) => a.slice(PENDING_FILTER_PREFIX.length));
    if (pendingIds.length)
      parts.push(`pending_invitation_id.in.(${pendingIds.join(',')})`);
    if (parts.length) q = q.or(parts.join(','));
  }

  const since = createdRangeSince(filters.createdRange);
  if (since) q = q.gte('created_at', since);
  return q;
}

// Order two stored custom-field values. Numeric types compare numerically;
// everything else lexically — imported dates are stored ISO (YYYY-MM-DD), so
// text order is chronological. Empty/missing always sorts last, both
// directions (a blank cell is never "the smallest date").
function compareCustomValues(
  a: string | undefined,
  b: string | undefined,
  type: string,
  dir: SortDir
): number {
  const aEmpty = a == null || a === '';
  const bEmpty = b == null || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  const numeric = type === 'number' || type === 'currency';
  const r = numeric
    ? (Number.parseFloat(a) || 0) - (Number.parseFloat(b) || 0)
    : a.localeCompare(b);
  return dir === 'asc' ? r : -r;
}

export default function LeadsPage() {
  const supabase = createClient();
  const router = useRouter();
  const { defaultCurrency, user, profile } = useAuth();
  const { locale, fmt } = useLocale();
  const canEdit = useCan('send-messages');
  const canEditSettings = useCan('edit-settings');

  // Lead-transfer capabilities (migration 050). admin/owner reassign
  // instantly + get bulk assign; agents open an accept-gated request.
  const role = profile?.account_role ?? null;
  // Delete gating (migration 066). Admins delete any lead; an agent only a
  // lead they created via a human action (auto-captured + teammates' leads
  // are off-limits). canDeleteAny → the bulk-delete "some may be skipped"
  // hint; canDeleteThisLead gates the per-row + board menus. RLS mirrors both.
  const canDeleteAny = role ? canDeleteAnyLead(role) : false;
  const canDeleteThisLead = useCallback(
    (c: Contact) =>
      role
        ? canDeleteLead(role, {
            createdBy: c.created_by ?? null,
            userId: user?.id ?? null,
            receivedVia: c.received_via ?? null,
          })
        : false,
    [role, user?.id],
  );
  const canReassignDirect = role ? canReassignLeadsDirectly(role) : false;
  const canTransfer = role ? canRequestLeadTransfer(role) : false;
  const canResolveAnyTransfer = role ? canResolveAnyLeadTransfer(role) : false;

  // Account-editable option lists (status/source/gender) — drive the
  // status pills, board columns, cell editors, filters and the header
  // menus' "Edit options" dialog.
  const fieldOptions = useLeadFieldOptions();
  const [editOptionsKind, setEditOptionsKind] = useState<LeadFieldKind | null>(
    null
  );

  // Search — a page-level input in the toolbar. Seeded from `?search=`
  // so deep links still land here, then owned locally and debounced.
  const searchParams = useSearchParams();
  const urlSearch = searchParams.get('search') ?? '';
  const [searchInput, setSearchInput] = useState(urlSearch);
  const search = useDebounced(searchInput, 250);
  // Mirror external navigations (deep links) into the input.
  useEffect(() => {
    setSearchInput(urlSearch);
  }, [urlSearch]);

  // Filters (Filters panel) + teammate list for owner/assignee filters,
  // the Assigned-to column render, and its inline picker.
  const [filters, setFilters] = useState<LeadFilters>(EMPTY_FILTERS);
  const { staff, nameById, avatarById } = useAccountStaff();

  const [contacts, setContacts] = useState<ContactWithData[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  // All tags (for the tags column render + Filters panel).
  const [tagsMap, setTagsMap] = useState<Record<string, Tag>>({});

  // Distinct pending-invite owners in use (migration 049) — Assigned-to
  // filter options, so you can select a pending teammate's leads and
  // bulk-reassign them.
  const [pendingAssignees, setPendingAssignees] = useState<
    { id: string; name: string }[]
  >([]);

  // In-flight ownership transfers (Received-by), keyed by contact_id
  // (migration 050). Overlays a "transfer pending → X" badge on that cell.
  const [transfers, setTransfers] = useState<Record<string, LeadTransfer>>({});
  // In-flight assignment requests (Assigned-to), keyed by contact_id
  // (migration 052) — owner-approval flow, overlaid on the Assignee cell.
  const [assignmentRequests, setAssignmentRequests] = useState<
    Record<string, LeadTransfer>
  >({});
  // Agent peer-handoff confirm: the lead + chosen target awaiting a note.
  const [transferDialog, setTransferDialog] = useState<{
    contact: ContactWithData;
    targetId: string;
  } | null>(null);
  const [transferSubmitting, setTransferSubmitting] = useState(false);

  // Board view data — fetched independently of the paginated table so
  // switching views doesn't fight the table's pagination window. Rows are
  // enriched with tags (same shape as the table) for the card chips.
  const [boardLeads, setBoardLeads] = useState<ContactWithData[]>([]);
  // Starts true so the first board visit shows the skeleton, not a
  // one-frame "No leads yet" flash before the fetch effect fires.
  const [boardLoading, setBoardLoading] = useState(true);
  const [boardNonce, setBoardNonce] = useState(0);

  // Custom-field definitions — drive the dynamic columns.
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  // Distinct values present for each filterable custom field (custom_field_id
  // → sorted values), feeding that column's value-filter checkbox list.
  const [customFilterOptions, setCustomFilterOptions] = useState<
    Record<string, string[]>
  >({});

  // Table preferences (visibility, order, widths, page size, view mode),
  // persisted per-browser in localStorage.
  const [prefs, setPrefs] = useTablePrefs<TablePrefs>(
    PREFS_VIEW_KEY,
    DEFAULT_PREFS
  );

  // Transient width during an active column drag (committed to prefs on drop).
  const [resizing, setResizing] = useState<{
    key: string;
    width: number;
  } | null>(null);

  // Key of the column currently being drag-reordered (null = not dragging).
  // Drives the whole-column tint + elevation while a header is picked up.
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  // Live horizontal pointer delta during a column drag. The header follows
  // the cursor via dnd-kit's own transform; we mirror that same delta onto
  // the dragged column's body cells so the whole strip travels together.
  const [dragX, setDragX] = useState(0);
  // Key of the column currently under the drag (the drop target). dnd-kit
  // shifts the other HEADERS open to preview the slot; we read this to
  // shift their body cells the same way so whole columns displace as one.
  const [overKey, setOverKey] = useState<string | null>(null);

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [editContactTags, setEditContactTags] = useState<ContactTag[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailContactId, setDetailContactId] = useState<string | null>(null);
  // Where the detail sheet should land on open. A follow-up-reminder
  // notification deep-links with `?focus=followup` so the sheet opens on
  // the notes/follow-up composer instead of the top of the record.
  const [detailFocus, setDetailFocus] = useState<'followup' | null>(null);
  // Deep link from a notification: `?contact=<id>` opens that lead's
  // detail sheet, and `?focus=followup` (follow-up reminders) lands it on
  // the notes/follow-up composer. Runs only when the params change, so
  // manually closing the sheet doesn't fight the URL.
  const urlContact = searchParams.get('contact');
  const urlFocus = searchParams.get('focus');
  useEffect(() => {
    if (!urlContact) return;
    setDetailContactId(urlContact);
    setDetailFocus(urlFocus === 'followup' ? 'followup' : null);
    setDetailOpen(true);
  }, [urlContact, urlFocus]);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [viewSettingsOpen, setViewSettingsOpen] = useState(false);
  const [manageColumnsOpen, setManageColumnsOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Bulk selection (page-scoped — only the loaded rows are selectable)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkNoteOpen, setBulkNoteOpen] = useState(false);
  const [bulkConvertOpen, setBulkConvertOpen] = useState(false);
  // The bulk toolbar animates open/closed instead of mounting/unmounting,
  // so on exit (selection cleared) it lingers ~300ms while collapsing. We
  // freeze the last non-zero count here so the label doesn't flash "0
  // records" mid-collapse. Adjusted during render (no effect needed).
  const [bulkCount, setBulkCount] = useState(0);
  if (selected.size > 0 && selected.size !== bulkCount) {
    setBulkCount(selected.size);
  }

  // Inline cell editing (HubSpot-style). Only one cell edits at a time.
  const [editingCell, setEditingCell] = useState<{
    id: string;
    key: string;
  } | null>(null);
  const [savingCell, setSavingCell] = useState(false);

  // Guards against out-of-order fetch responses: each fetchContacts run
  // claims a sequence number and only the latest is allowed to commit its
  // results. Without this, rapidly changing the search/page could let a
  // slower earlier request resolve last and render stale rows.
  const fetchSeq = useRef(0);
  // Same guard for the board's independent fetch.
  const boardFetchSeq = useRef(0);

  // Latest fetchContacts held in a ref so the transfers realtime channel can
  // trigger an owner-flip refetch without re-subscribing on every filter/sort
  // change (fetchContacts' identity churns; fetchTransfers is stable).
  const fetchContactsRef = useRef<() => void>(() => {});

  // Transfer-cell actions are defined far below (after refreshAll); the
  // assignee column's render closure reaches them through this ref so the
  // liveColumns memo doesn't take a TDZ dep on a later const.
  const transferActionRef = useRef<
    (id: string, action: 'accept' | 'decline' | 'cancel') => void
  >(() => {});

  // Start a transfer from the Received-by cell's owner picker (same TDZ
  // dodge — the handler is defined after refreshAll).
  const initiateTransferRef = useRef<
    (contact: ContactWithData, targetId: string) => void
  >(() => {});

  // Resolve an assignment request from the Assignee-cell overlay menu.
  const assignmentActionRef = useRef<
    (id: string, action: 'approve' | 'reject' | 'cancel') => void
  >(() => {});

  // Column drag-reorder. A 6px activation distance means a plain click on
  // the header label (to no effect) or on the sort arrows / overflow menu
  // never starts a drag — only a deliberate pull does.
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const pageSize = prefs.pageSize;
  const viewMode = prefs.viewMode;
  const view = prefs.view ?? 'table';
  // Defensive reads — prefs saved before these fields existed omit them.
  const sort = prefs.sort ?? null;
  const frozenCountPref = prefs.frozenCount ?? 0;
  const boardDensity = prefs.board?.density ?? DEFAULT_PREFS.board.density;
  const boardSortWithin =
    prefs.board?.sortWithin ?? DEFAULT_PREFS.board.sortWithin;
  const boardCollapseEmpty =
    prefs.board?.collapseEmpty ?? DEFAULT_PREFS.board.collapseEmpty;

  // ---- Column resolution --------------------------------------------------
  // Live columns = built-ins + one per custom field. Effective order applies
  // saved order for keys that still exist and appends any new columns; dead
  // keys are dropped. Custom columns default to hidden until the user saves
  // them via Manage Columns (i.e. their key appears in prefs.order).
  // The option-backed built-ins (status/source/gender) re-render with
  // the ACCOUNT's option lists here — their static defs only know the
  // built-in defaults.
  const liveColumns = useMemo<ColumnDef[]>(() => {
    const builtins = BUILTIN_COLUMNS.map((col): ColumnDef => {
      if (col.key === 'status') {
        return {
          ...col,
          render: (c) => (
            <StatusBadge column={fieldOptions.statusFor(c.lead_status)} />
          ),
        };
      }
      if (col.key === 'source') {
        return {
          ...col,
          render: (c) =>
            c.source ? (
              <SourceIcon
                source={c.source}
                label={fieldOptions.sourceLabel(c.source)}
              />
            ) : (
              <span className="text-muted-foreground text-sm">—</span>
            ),
        };
      }
      if (col.key === 'gender') {
        return {
          ...col,
          render: (c) => (
            <span className="text-muted-foreground text-sm">
              {fieldOptions.genderLabel(c.gender)}
            </span>
          ),
        };
      }
      if (col.key === 'assignee') {
        return {
          ...col,
          render: (c) => {
            // A pending assignment request (migration 052) overlays the
            // cell: the change hasn't applied yet, awaiting the OWNER's
            // approval. Owner/admin see Approve/Reject; the requester sees
            // Withdraw.
            const req = assignmentRequests[c.id];
            if (req) {
              const fromId = req.from_user_id ?? c.assigned_to ?? null;
              const targetName = req.to_user_id
                ? nameById.get(req.to_user_id) ?? 'Teammate'
                : 'Unassign';
              const badge = (
                <TransferPendingDisplay
                  ownerName={fromId ? nameById.get(fromId) ?? 'Unassigned' : null}
                  ownerAvatarUrl={fromId ? avatarById.get(fromId) : null}
                  targetName={targetName}
                />
              );
              const canApprove =
                req.approver_user_id === user?.id || canResolveAnyTransfer;
              const canCancel =
                req.requested_by === user?.id || canResolveAnyTransfer;
              if (!canApprove && !canCancel) return badge;
              return (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button
                        type="button"
                        className="min-w-0 max-w-full text-left"
                        onClick={(e) => e.stopPropagation()}
                      />
                    }
                  >
                    {badge}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="bg-popover border-border min-w-48"
                  >
                    {canApprove && (
                      <>
                        <DropdownMenuItem
                          onClick={() =>
                            assignmentActionRef.current(req.id, 'approve')
                          }
                          className="text-popover-foreground focus:bg-muted"
                        >
                          <Check className="size-4" />
                          Approve assignment
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            assignmentActionRef.current(req.id, 'reject')
                          }
                          className="text-popover-foreground focus:bg-muted"
                        >
                          <X className="size-4" />
                          Reject
                        </DropdownMenuItem>
                      </>
                    )}
                    {canCancel && (
                      <DropdownMenuItem
                        onClick={() =>
                          assignmentActionRef.current(req.id, 'cancel')
                        }
                        className="text-popover-foreground focus:bg-muted"
                      >
                        <Ban className="size-4" />
                        Withdraw request
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            }
            // A pending-invite owner overrides the display — the lead is
            // parked on a teammate who hasn't joined yet (migration 049).
            if (c.pending_invitation_id && c.pending_assignee_name) {
              return <PendingAssigneeDisplay name={c.pending_assignee_name} />;
            }
            if (!c.assigned_to) {
              return (
                <span className="text-muted-foreground text-sm">
                  Unassigned
                </span>
              );
            }
            return (
              <AssigneeDisplay
                name={nameById.get(c.assigned_to) ?? 'Teammate'}
                avatarUrl={avatarById.get(c.assigned_to)}
              />
            );
          },
        };
      }
      if (col.key === 'received_by') {
        return {
          ...col,
          render: (c) => {
            // System-generated capture → locked "Auto · <channel>" pill,
            // never transferable (no human owner).
            const auto = autoReceivedLabel(c.received_via);
            if (auto) return <Badge variant="neutral">{auto}</Badge>;

            // Ownership = the human "Received by" (contacts.user_id).
            // A pending transfer (migration 050) overlays it: ownership
            // hasn't moved yet, so show current owner → target with
            // contextual Accept/Decline/Withdraw for the target /
            // requester / admin.
            const transfer = transfers[c.id];
            if (transfer) {
              const ownerId = transfer.from_user_id ?? c.user_id ?? null;
              const badge = (
                <TransferPendingDisplay
                  ownerName={ownerId ? nameById.get(ownerId) ?? 'Teammate' : null}
                  ownerAvatarUrl={ownerId ? avatarById.get(ownerId) : null}
                  targetName={
                    transfer.to_user_id
                      ? nameById.get(transfer.to_user_id) ?? 'Teammate'
                      : 'Teammate'
                  }
                  incoming={transfer.to_user_id === user?.id}
                />
              );
              const canAccept =
                transfer.to_user_id === user?.id || canResolveAnyTransfer;
              const canCancel =
                transfer.requested_by === user?.id || canResolveAnyTransfer;
              if (!canAccept && !canCancel) return badge;
              return (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button
                        type="button"
                        className="min-w-0 max-w-full text-left"
                        onClick={(e) => e.stopPropagation()}
                      />
                    }
                  >
                    {badge}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="bg-popover border-border min-w-48"
                  >
                    {canAccept && (
                      <>
                        <DropdownMenuItem
                          onClick={() =>
                            transferActionRef.current(transfer.id, 'accept')
                          }
                          className="text-popover-foreground focus:bg-muted"
                        >
                          <Check className="size-4" />
                          Accept transfer
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            transferActionRef.current(transfer.id, 'decline')
                          }
                          className="text-popover-foreground focus:bg-muted"
                        >
                          <X className="size-4" />
                          Decline
                        </DropdownMenuItem>
                      </>
                    )}
                    {canCancel && (
                      <DropdownMenuItem
                        onClick={() =>
                          transferActionRef.current(transfer.id, 'cancel')
                        }
                        className="text-popover-foreground focus:bg-muted"
                      >
                        <Ban className="size-4" />
                        Withdraw request
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            }

            const ownerChip = (
              <AssigneeDisplay
                name={nameById.get(c.user_id) ?? 'Teammate'}
                avatarUrl={avatarById.get(c.user_id)}
              />
            );
            // Who can start a transfer: admins on any human lead; an agent
            // on a lead they own. Everyone else sees a static owner.
            const canInitiate =
              canReassignDirect || (canTransfer && c.user_id === user?.id);
            if (!canInitiate) return ownerChip;
            return (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      className="min-w-0 max-w-full text-left"
                      onClick={(e) => e.stopPropagation()}
                    />
                  }
                >
                  {ownerChip}
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="bg-popover border-border max-h-72 min-w-52 overflow-auto"
                >
                  <div className="text-muted-foreground px-2 py-1.5 text-[11px]">
                    {canReassignDirect
                      ? 'Transfer ownership to…'
                      : 'Request transfer to…'}
                  </div>
                  {staff
                    .filter((s) => s.user_id !== c.user_id)
                    .map((s) => (
                      <DropdownMenuItem
                        key={s.user_id}
                        onClick={() => initiateTransferRef.current(c, s.user_id)}
                        className="text-popover-foreground focus:bg-muted gap-2"
                      >
                        <UserAvatar
                          name={s.full_name}
                          src={s.avatar_url}
                          className="size-5 shrink-0"
                          fallbackClassName="text-[10px]"
                        />
                        <span className="truncate">{s.full_name}</span>
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
            );
          },
        };
      }
      if (col.key === 'created_by') {
        return {
          ...col,
          // Immutable original creator (migration 051). Auto-captured leads
          // may have no human creator → em dash.
          render: (c) =>
            c.created_by ? (
              <AssigneeDisplay
                name={nameById.get(c.created_by) ?? 'Teammate'}
                avatarUrl={avatarById.get(c.created_by)}
              />
            ) : (
              <span className="text-muted-foreground text-sm">—</span>
            ),
        };
      }
      return col;
    });
    return [
      ...builtins,
      ...customFields.map((f) => customColumn(f, defaultCurrency, locale.locale)),
    ];
  }, [
    customFields,
    defaultCurrency,
    locale.locale,
    fieldOptions,
    nameById,
    avatarById,
    transfers,
    assignmentRequests,
    user,
    staff,
    canReassignDirect,
    canTransfer,
    canResolveAnyTransfer,
  ]);

  const colByKey = useMemo(() => {
    const map: Record<string, ColumnDef> = {};
    liveColumns.forEach((c) => (map[c.key] = c));
    return map;
  }, [liveColumns]);

  // Every account tag as checklist options for the tags cell editor.
  const allTagOptions = useMemo(
    () =>
      Object.values(tagsMap)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => ({ value: t.id, label: t.name })),
    [tagsMap]
  );

  const orderedKeys = useMemo(() => {
    const liveKeys = liveColumns.map((c) => c.key);
    const saved = prefs.order.filter((k) => liveKeys.includes(k));
    const appended = liveKeys.filter((k) => !saved.includes(k));
    return [...saved, ...appended];
  }, [liveColumns, prefs.order]);

  const isVisible = useCallback(
    (key: string) => {
      if (prefs.hidden.includes(key)) return false;
      const col = colByKey[key];
      if (col?.isCustom) return prefs.order.includes(key);
      return true;
    },
    [prefs.hidden, prefs.order, colByKey]
  );

  const visibleColumns = useMemo(
    () => orderedKeys.filter(isVisible).map((k) => colByKey[k]),
    [orderedKeys, isVisible, colByKey]
  );

  // Freeze uses a count: the leading N visible columns are pinned
  // sticky-left. No reordering needed — they already lead the order.
  const frozenCount = Math.min(frozenCountPref, visibleColumns.length);
  const arrangedColumns = visibleColumns;
  const frozenKeySet = useMemo(
    () => new Set(visibleColumns.slice(0, frozenCount).map((c) => c.key)),
    [visibleColumns, frozenCount]
  );

  // The DB column the current sort maps to (null when the sorted column
  // isn't server-sortable, e.g. tags — falls back to created_at desc).
  const sortColumn = useMemo(
    () => (sort ? (colByKey[sort.key]?.sortColumn ?? null) : null),
    [sort, colByKey]
  );

  // Active sort on a column that can't be server-`.order()`d — a custom
  // field (values in contact_custom_values), a person uuid resolved to a
  // name, or tags (join table). fetchContacts sorts the full filtered id
  // set client-side instead. Mutually exclusive with sortColumn (these
  // columns have no sortColumn).
  const clientSort = useMemo((): ClientSort | null => {
    if (!sort) return null;
    const col = colByKey[sort.key];
    if (!col) return null;
    if (col.isCustom) {
      return {
        kind: 'custom',
        fieldId: col.key.slice(3), // strip "cf:"
        type: col.customType ?? 'text',
        dir: sort.dir,
      };
    }
    if (col.clientSort?.kind === 'person') {
      return { kind: 'person', column: col.clientSort.column, dir: sort.dir };
    }
    if (col.clientSort?.kind === 'tags') {
      return { kind: 'tags', dir: sort.dir };
    }
    return null;
  }, [sort, colByKey]);

  // Custom field ids whose column is currently shown — only these need their
  // per-contact values fetched. Joined to a stable string for fetch deps.
  const activeCustomFieldIds = useMemo(
    () => visibleColumns.filter((c) => c.isCustom).map((c) => c.key.slice(3)), // strip "cf:"
    [visibleColumns]
  );
  const activeCustomKey = activeCustomFieldIds.join(',');

  function widthOf(col: ColumnDef) {
    if (resizing?.key === col.key) return resizing.width;
    return prefs.widths[col.key] ?? col.defaultWidth;
  }

  const totalWidth =
    CHECKBOX_COL_WIDTH +
    ACTIONS_COL_WIDTH +
    visibleColumns.reduce((sum, c) => sum + widthOf(c), 0);

  // Left offset (px) for each frozen column's sticky position — walk the
  // leading N columns left-to-right, past the (also-sticky) checkbox
  // column. Recomputed each render so live resizes track.
  const hasFrozen = frozenCount > 0;
  const frozenLeft: Record<string, number> = {};
  {
    let acc = CHECKBOX_COL_WIDTH;
    for (const c of visibleColumns.slice(0, frozenCount)) {
      frozenLeft[c.key] = acc;
      acc += widthOf(c);
    }
  }
  // Sticky positioning for a frozen header/body cell (undefined otherwise).
  function frozenCellStyle(key: string): React.CSSProperties | undefined {
    if (!frozenKeySet.has(key)) return undefined;
    return { position: 'sticky', left: frozenLeft[key] };
  }

  const fetchCustomFields = useCallback(async () => {
    const { data } = await supabase
      .from('custom_fields')
      .select('*')
      .order('field_name');
    if (data) setCustomFields(data);
  }, [supabase]);

  const fetchTags = useCallback(async () => {
    const { data } = await supabase.from('tags').select('*');
    if (data) {
      const map: Record<string, Tag> = {};
      data.forEach((t) => (map[t.id] = t));
      setTagsMap(map);
    }
  }, [supabase]);

  // Distinct pending invites currently parked on leads. Cheap — the
  // partial index idx_contacts_pending_invitation covers the predicate.
  const fetchPendingAssignees = useCallback(async () => {
    const { data } = await supabase
      .from('contacts')
      .select('pending_invitation_id, pending_assignee_name')
      .not('pending_invitation_id', 'is', null);
    if (!data) return;
    const byId = new Map<string, string>();
    for (const r of data as {
      pending_invitation_id: string | null;
      pending_assignee_name: string | null;
    }[]) {
      if (r.pending_invitation_id && !byId.has(r.pending_invitation_id)) {
        byId.set(r.pending_invitation_id, r.pending_assignee_name ?? 'Pending');
      }
    }
    setPendingAssignees(
      [...byId.entries()].map(([id, name]) => ({ id, name }))
    );
  }, [supabase]);

  // In-flight requests → split by kind into the two cell overlays.
  const fetchTransfers = useCallback(async () => {
    const rows = await fetchPendingTransfers(supabase);
    setTransfers(pendingTransferMap(rows, 'ownership'));
    setAssignmentRequests(pendingTransferMap(rows, 'assignment'));
  }, [supabase]);

  const fetchContacts = useCallback(async () => {
    const seq = ++fetchSeq.current;
    setLoading(true);
    // The visible rows are about to change — drop any selection that
    // referred to the old page/search results so the bulk bar can't
    // act on rows the user can no longer see.
    setSelected(new Set());

    const from = page * pageSize;
    const to = from + pageSize - 1;
    const term = search.trim();

    // Tag + custom-value filters → contact ids. An active id filter that
    // matches nothing short-circuits to an empty result (skips the query).
    const idFilter = await resolveContactIdFilter(supabase, filters);
    if (seq !== fetchSeq.current) return;
    if (idFilter && idFilter.length === 0) {
      setTotalCount(0);
      setContacts([]);
      setLoading(false);
      return;
    }

    // Leads = contacts without a membership: PostgREST anti-join via a left
    // embed filtered to null. Shared by the server-sorted path and the
    // custom-field-sort path so their filters can't drift. Filters apply
    // before order/range (transform stage drops the filter methods).
    const buildFiltered = (select: string, opts?: { count: 'exact' }) => {
      let q = supabase
        .from('contacts')
        .select(select, opts)
        .is('memberships', null);
      if (term) {
        const like = `%${term}%`;
        q = q.or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like}`);
      }
      return applyLeadFilters(q, filters, idFilter);
    };

    let contactRows: Contact[] = [];

    if (clientSort) {
      // The sort column has no server-orderable `contacts` column (custom
      // field, person uuid → name, or tags). Pull ALL filtered lead ids,
      // build a per-lead sort key, order the whole set client-side (so
      // paging is correct across pages), then fetch only the current page's
      // full rows. created_at desc is the stable tiebreak for equal/missing
      // keys. For the person kind we select the uuid column alongside the id.
      const idSelect =
        clientSort.kind === 'person'
          ? `id, ${clientSort.column}, memberships!left(id)`
          : 'id, memberships!left(id)';
      const { data: idData, error: idErr } = await buildFiltered(
        idSelect
      ).order('created_at', { ascending: false });
      if (seq !== fetchSeq.current) return;
      if (idErr) {
        toast.error('Failed to load leads');
        setLoading(false);
        return;
      }
      const idRows = (idData ?? []) as unknown as Record<
        string,
        string | null
      >[];
      const allIds = idRows.map((r) => r.id as string);

      // Sort key per lead + the compare type. Blank/missing keys always
      // sort last (see compareCustomValues), both directions.
      const keyById = new Map<string, string>();
      let cmpType = 'text';
      if (clientSort.kind === 'custom') {
        cmpType = clientSort.type;
        // All stored values for the sort field (RLS scopes to this account —
        // no id list in the URL, so this stays a single light request).
        const { data: valData } = await supabase
          .from('contact_custom_values')
          .select('contact_id, value')
          .eq('custom_field_id', clientSort.fieldId);
        if (seq !== fetchSeq.current) return;
        for (const v of (valData ?? []) as {
          contact_id: string;
          value: string | null;
        }[]) {
          if (v.value != null) keyById.set(v.contact_id, v.value);
        }
      } else if (clientSort.kind === 'person') {
        // Resolve the uuid column to the teammate's name (sorted alpha).
        for (const r of idRows) {
          const uid = r[clientSort.column];
          const name = uid ? nameById.get(uid) : undefined;
          if (name) keyById.set(r.id as string, name);
        }
      } else {
        // Tags — key on each lead's alphabetically-first tag name. One
        // account-scoped read (no id list in the URL), like the custom path.
        const { data: tagLinks } = await supabase
          .from('contact_tags')
          .select('contact_id, tag_id');
        if (seq !== fetchSeq.current) return;
        const firstTag = new Map<string, string>();
        for (const l of (tagLinks ?? []) as {
          contact_id: string;
          tag_id: string;
        }[]) {
          const name = tagsMap[l.tag_id]?.name;
          if (!name) continue;
          const cur = firstTag.get(l.contact_id);
          if (cur == null || name.localeCompare(cur) < 0)
            firstTag.set(l.contact_id, name);
        }
        for (const [cid, name] of firstTag) keyById.set(cid, name);
      }

      const sortedIds = [...allIds].sort((a, b) =>
        compareCustomValues(
          keyById.get(a),
          keyById.get(b),
          cmpType,
          clientSort.dir
        )
      );
      setTotalCount(allIds.length);

      const pageIds = sortedIds.slice(from, from + pageSize);
      if (pageIds.length === 0) {
        setContacts([]);
        setLoading(false);
        return;
      }
      const { data: rowData, error: rowErr } = await supabase
        .from('contacts')
        .select('*')
        .in('id', pageIds);
      if (seq !== fetchSeq.current) return;
      if (rowErr) {
        toast.error('Failed to load leads');
        setLoading(false);
        return;
      }
      const byId = new Map(
        ((rowData ?? []) as unknown as Contact[]).map((r) => [r.id, r])
      );
      contactRows = pageIds
        .map((id) => byId.get(id))
        .filter((r): r is Contact => Boolean(r));
    } else {
      const {
        data,
        count: exactCount,
        error,
      } = await buildFiltered('*, memberships!left(id)', { count: 'exact' })
        // Sorted column when set + server-sortable, else newest first.
        .order(sortColumn ?? 'created_at', {
          ascending: sortColumn ? sort!.dir === 'asc' : false,
        })
        .range(from, to);
      if (seq !== fetchSeq.current) return; // superseded by a newer fetch
      if (error) {
        toast.error('Failed to load leads');
        setLoading(false);
        return;
      }
      contactRows = (data ?? []) as unknown as Contact[];
      setTotalCount(exactCount ?? 0);
    }

    if (contactRows.length === 0) {
      setContacts([]);
      setLoading(false);
      return;
    }

    const contactIds = contactRows.map((c) => c.id);

    // Tags + (optionally) custom-field values for the loaded rows, in
    // parallel. Custom values are only fetched when a custom column shows.
    const activeIds = activeCustomKey ? activeCustomKey.split(',') : [];
    const [contactTagsRes, customValuesRes] = await Promise.all([
      supabase
        .from('contact_tags')
        .select('contact_id, tag_id')
        .in('contact_id', contactIds),
      activeIds.length > 0
        ? supabase
            .from('contact_custom_values')
            .select('contact_id, custom_field_id, value')
            .in('contact_id', contactIds)
            .in('custom_field_id', activeIds)
        : Promise.resolve({
            data: [] as {
              contact_id: string;
              custom_field_id: string;
              value: string | null;
            }[],
          }),
    ]);
    if (seq !== fetchSeq.current) return; // superseded by a newer fetch

    const tagsByContact: Record<string, string[]> = {};
    contactTagsRes.data?.forEach((ct) => {
      (tagsByContact[ct.contact_id] ??= []).push(ct.tag_id);
    });

    const valuesByContact: Record<string, Record<string, string>> = {};
    customValuesRes.data?.forEach((v) => {
      (valuesByContact[v.contact_id] ??= {})[v.custom_field_id] = v.value ?? '';
    });

    const enriched: ContactWithData[] = contactRows.map((c) => ({
      ...c,
      tags: (tagsByContact[c.id] ?? [])
        .map((tid) => tagsMap[tid])
        .filter(Boolean),
      customValues: valuesByContact[c.id] ?? {},
    }));

    setContacts(enriched);
    setLoading(false);
  }, [
    supabase,
    page,
    pageSize,
    search,
    filters,
    tagsMap,
    nameById,
    activeCustomKey,
    sortColumn,
    clientSort,
    sort,
  ]);

  // Board data — all statuses at once, capped at BOARD_LIMIT most
  // recent. Respects the header search AND the shared Filters panel
  // (same applyLeadFilters + id-filter resolution the table uses, so the
  // two views — and the CSV export — can never disagree on the set).
  // Sequence-guarded like fetchContacts: only the latest run commits.
  const fetchBoard = useCallback(async () => {
    void boardNonce; // manual refetch trigger — bump to reload
    const seq = ++boardFetchSeq.current;
    setBoardLoading(true);
    const term = search.trim();

    const idFilter = await resolveContactIdFilter(supabase, filters);
    if (seq !== boardFetchSeq.current) return;
    if (idFilter && idFilter.length === 0) {
      setBoardLeads([]);
      setBoardLoading(false);
      return;
    }

    let query = supabase
      .from('contacts')
      .select('*, memberships!left(id)')
      .is('memberships', null);
    if (term) {
      const like = `%${term}%`;
      query = query.or(
        `name.ilike.${like},phone.ilike.${like},email.ilike.${like}`
      );
    }
    query = applyLeadFilters(query, filters, idFilter);

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(BOARD_LIMIT);
    if (seq !== boardFetchSeq.current) return; // superseded by a newer fetch
    if (error) {
      toast.error('Failed to load leads');
      setBoardLoading(false);
      return;
    }
    const rows = (data ?? []) as unknown as Contact[];

    // Tags for the card chips — one account-scoped read (RLS bounds it;
    // no 500-id list in the URL), same pattern as the tags client-sort.
    const { data: tagLinks } = await supabase
      .from('contact_tags')
      .select('contact_id, tag_id');
    if (seq !== boardFetchSeq.current) return;
    const tagsByContact: Record<string, Tag[]> = {};
    for (const l of (tagLinks ?? []) as {
      contact_id: string;
      tag_id: string;
    }[]) {
      const t = tagsMap[l.tag_id];
      if (t) (tagsByContact[l.contact_id] ??= []).push(t);
    }

    setBoardLeads(
      rows.map((c) => ({ ...c, tags: tagsByContact[c.id] ?? [] }))
    );
    setBoardLoading(false);
  }, [supabase, search, filters, tagsMap, boardNonce]);

  // Load-once-on-mount-ish data fetches. Each setter inside runs
  // inside an async promise completion (Supabase await), not
  // synchronously in the effect body, so the cascade the lint rule
  // warns about doesn't apply here.
  useEffect(() => {
    fetchCustomFields();
  }, [fetchCustomFields]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  useEffect(() => {
    fetchPendingAssignees();
  }, [fetchPendingAssignees]);

  useEffect(() => {
    fetchTransfers();
  }, [fetchTransfers]);

  useEffect(() => {
    fetchContactsRef.current = fetchContacts;
  }, [fetchContacts]);

  // Realtime: a transfer created/resolved anywhere refreshes the overlay
  // map and (for owner flips on accept) the rows. Subscribes once —
  // fetchTransfers is stable and fetchContacts rides the ref.
  useEffect(() => {
    const channel = supabase
      .channel('lead-transfers')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lead_transfers' },
        () => {
          fetchTransfers();
          fetchContactsRef.current();
          // Board cards render owner/pending chips too — refetch when
          // it's the live view (the effect below gates on view).
          setBoardNonce((n) => n + 1);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, fetchTransfers]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  useEffect(() => {
    if (view === 'board') fetchBoard();
  }, [view, fetchBoard]);

  // A new search term / filter set shrinks/grows the result set, so page N
  // may no longer be valid — reset to the first page whenever they change.
  useEffect(() => {
    setPage(0);
  }, [search, filters]);

  /** Refresh whichever views hold data after any mutation. */
  const refreshAll = useCallback(() => {
    fetchContacts();
    fetchPendingAssignees();
    fetchTransfers();
    setBoardNonce((n) => n + 1);
  }, [fetchContacts, fetchPendingAssignees, fetchTransfers]);

  // Agent peer-handoff confirm → send the pending request (migration 050).
  const submitTransferRequest = useCallback(
    async (note: string) => {
      if (!transferDialog) return;
      setTransferSubmitting(true);
      try {
        const outcome = await requestLeadTransfer(
          supabase,
          transferDialog.contact.id,
          transferDialog.targetId,
          note || undefined
        );
        toast.success(
          outcome === 'pending'
            ? 'Transfer request sent — waiting for them to accept.'
            : 'Lead reassigned'
        );
        setTransferDialog(null);
        refreshAll();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to send request');
      } finally {
        setTransferSubmitting(false);
      }
    },
    [supabase, transferDialog, refreshAll]
  );

  // Resolve a pending transfer from the assignee-cell overlay menu.
  const handleTransferAction = useCallback(
    async (transferId: string, action: 'accept' | 'decline' | 'cancel') => {
      try {
        if (action === 'cancel') {
          await cancelLeadTransfer(supabase, transferId);
          toast.success('Transfer request withdrawn');
        } else {
          await respondLeadTransfer(supabase, transferId, action === 'accept');
          toast.success(
            action === 'accept' ? 'Transfer accepted' : 'Transfer declined'
          );
        }
        refreshAll();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Action failed');
      }
    },
    [supabase, refreshAll]
  );

  useEffect(() => {
    transferActionRef.current = handleTransferAction;
  }, [handleTransferAction]);

  // Start an ownership transfer of the "Received by" owner (contacts.user_id,
  // migration 050). Admins move it instantly; an agent handing off a lead
  // they own opens the accept-gated request dialog.
  const initiateTransfer = useCallback(
    async (contact: ContactWithData, targetId: string) => {
      if (targetId === contact.user_id) return;
      if (canReassignDirect) {
        try {
          await requestLeadTransfer(supabase, contact.id, targetId);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Failed to transfer');
          return;
        }
        setContacts((prev) =>
          prev.map((c) =>
            c.id === contact.id ? { ...c, user_id: targetId } : c
          )
        );
        setBoardLeads((prev) =>
          prev.map((l) =>
            l.id === contact.id ? { ...l, user_id: targetId } : l
          )
        );
        fetchTransfers();
        toast.success('Ownership transferred');
        return;
      }
      if (!canTransfer || contact.user_id !== user?.id) {
        toast.error('Only the current owner or an admin can transfer this lead.');
        return;
      }
      setTransferDialog({ contact, targetId });
    },
    [supabase, canReassignDirect, canTransfer, user, fetchTransfers]
  );

  useEffect(() => {
    initiateTransferRef.current = initiateTransfer;
  }, [initiateTransfer]);

  // Owner/admin approves or rejects (or requester withdraws) an assignment
  // request from the Assignee-cell overlay (migration 052).
  const handleAssignmentAction = useCallback(
    async (requestId: string, action: 'approve' | 'reject' | 'cancel') => {
      try {
        if (action === 'cancel') {
          await cancelLeadAssignment(supabase, requestId);
          toast.success('Request withdrawn');
        } else {
          await respondLeadAssignment(supabase, requestId, action === 'approve');
          toast.success(
            action === 'approve' ? 'Assignment approved' : 'Assignment rejected'
          );
        }
        refreshAll();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Action failed');
      }
    },
    [supabase, refreshAll]
  );

  useEffect(() => {
    assignmentActionRef.current = handleAssignmentAction;
  }, [handleAssignmentAction]);

  // The board island (LeadsBoardView) owns the optimistic drag update + the
  // DB write, so a drop re-renders ONLY the board subtree — not this
  // ~4k-line page (with its toolbar, filters, and many always-mounted
  // dialogs). That page re-render is a fixed, card-count-independent cost
  // that on the drop frame competes with the card's FLIP settle and hitches
  // it. Once the write commits, the island calls this to sync the page's own
  // copies: its board mirror (so a table→board round-trip is fresh) and the
  // table's Status column (for the next visit). startTransition keeps the
  // sync low-priority so it can't interrupt the in-flight settle.
  const handleStatusPersisted = useCallback(
    (contactId: string, status: LeadStatus | null) => {
      const now = new Date().toISOString();
      startTransition(() => {
        setBoardLeads((prev) =>
          prev.map((l) =>
            l.id === contactId
              ? { ...l, lead_status: status, updated_at: now }
              : l
          )
        );
        setContacts((prev) =>
          prev.map((c) =>
            c.id === contactId
              ? { ...c, lead_status: status, updated_at: now }
              : c
          )
        );
      });
    },
    []
  );

  // Current committed value for an editable cell — the editor's baseline.
  function readEditValue(c: ContactWithData, edit: EditSpec): string {
    switch (edit.kind) {
      case 'status':
        return leadColumnKey(c.lead_status);
      case 'assignee':
        return c.assigned_to ?? '';
      case 'custom':
        return c.customValues?.[edit.fieldId] ?? '';
      case 'email':
        return c.email ?? '';
      case 'text':
      case 'select':
        return (c[edit.column] as string | undefined) ?? '';
      case 'tags':
        // Tags edit via per-toggle writes, not a committed string.
        return '';
    }
  }

  // Persist one inline cell edit. Optimistically patches the table (and
  // the board, for status) after a successful write; leaves the row
  // untouched on failure so the displayed value stays truthful.
  const commitCell = useCallback(
    async (contact: ContactWithData, edit: EditSpec, rawValue: string) => {
      // Tags never commit through here — each toggle writes immediately
      // via toggleContactTag.
      if (edit.kind === 'tags') return;
      setSavingCell(true);
      try {
        if (edit.kind === 'status') {
          const status = columnToStatus(rawValue as LeadColumnKey);
          const { error } = await supabase
            .from('contacts')
            .update({
              lead_status: status,
              updated_at: new Date().toISOString(),
            })
            .eq('id', contact.id);
          if (error) {
            toast.error('Failed to update status');
            return;
          }
          setContacts((prev) =>
            prev.map((c) =>
              c.id === contact.id ? { ...c, lead_status: status } : c
            )
          );
          setBoardLeads((prev) =>
            prev.map((l) =>
              l.id === contact.id ? { ...l, lead_status: status } : l
            )
          );
        } else if (edit.kind === 'assignee') {
          // Assignment goes through request_lead_assignment (migration 052):
          // the owner (Received-by) or an admin changes it instantly; any
          // other agent's change becomes a request the OWNER must approve.
          // '' = Unassign. (Ownership TRANSFER is the separate Received-by
          // flow — migration 050.)
          const target = rawValue || null;
          if (target === (contact.assigned_to ?? null)) return; // no-op
          let outcome: 'approved' | 'pending';
          try {
            outcome = await requestLeadAssignment(supabase, contact.id, target);
          } catch (e) {
            toast.error(
              e instanceof Error ? e.message : 'Failed to update assignee'
            );
            return;
          }
          if (outcome === 'approved') {
            const clearPending = {
              pending_invitation_id: null,
              pending_assignee_name: null,
            };
            setContacts((prev) =>
              prev.map((c) =>
                c.id === contact.id
                  ? { ...c, assigned_to: target, ...clearPending }
                  : c
              )
            );
            setBoardLeads((prev) =>
              prev.map((l) =>
                l.id === contact.id
                  ? { ...l, assigned_to: target, ...clearPending }
                  : l
              )
            );
          } else {
            // Pending the owner's approval — surface the overlay.
            fetchTransfers();
            toast.success('Sent to the lead owner for approval');
          }
        } else if (edit.kind === 'custom') {
          const trimmed = rawValue.trim();
          const { error } = trimmed
            ? await supabase.from('contact_custom_values').upsert(
                {
                  contact_id: contact.id,
                  custom_field_id: edit.fieldId,
                  value: trimmed,
                },
                { onConflict: 'contact_id,custom_field_id' }
              )
            : await supabase
                .from('contact_custom_values')
                .delete()
                .eq('contact_id', contact.id)
                .eq('custom_field_id', edit.fieldId);
          if (error) {
            toast.error('Failed to save');
            return;
          }
          setContacts((prev) =>
            prev.map((c) =>
              c.id === contact.id
                ? {
                    ...c,
                    customValues: {
                      ...c.customValues,
                      [edit.fieldId]: trimmed,
                    },
                  }
                : c
            )
          );
        } else {
          // Built-in contacts column (text/email/select).
          const trimmed = rawValue.trim();
          if (edit.column === 'phone' && !trimmed) {
            toast.error('Phone number is required');
            return;
          }
          const { error } = await supabase
            .from('contacts')
            .update({
              [edit.column]: trimmed || null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', contact.id);
          if (error) {
            if (isUniqueViolation(error)) {
              toast.error('A lead with this phone number already exists');
            } else {
              toast.error('Failed to save');
            }
            return;
          }
          setContacts((prev) =>
            prev.map((c) =>
              c.id === contact.id
                ? { ...c, [edit.column]: trimmed || undefined }
                : c
            )
          );
        }
      } finally {
        setSavingCell(false);
        setEditingCell(null);
      }
    },
    [supabase, fetchTransfers]
  );

  // One tag toggle from the tags cell's checklist. Optimistic — the row
  // updates immediately and reverts on a failed write, mirroring the
  // detail panel's tag toggles. The checklist stays open throughout.
  const toggleContactTag = useCallback(
    async (contact: ContactWithData, tagId: string) => {
      const tag = tagsMap[tagId];
      if (!tag) return;
      const had = contact.tags?.some((t) => t.id === tagId) ?? false;
      const apply = (add: boolean) => (c: ContactWithData) =>
        c.id === contact.id
          ? {
              ...c,
              tags: add
                ? [...(c.tags ?? []), tag]
                : (c.tags ?? []).filter((t) => t.id !== tagId),
            }
          : c;
      setContacts((prev) => prev.map(apply(!had)));
      const { error } = had
        ? await supabase
            .from('contact_tags')
            .delete()
            .eq('contact_id', contact.id)
            .eq('tag_id', tagId)
        : await supabase
            .from('contact_tags')
            .insert({ contact_id: contact.id, tag_id: tagId });
      if (error) {
        toast.error('Failed to update tags');
        setContacts((prev) => prev.map(apply(had)));
      }
    },
    [supabase, tagsMap]
  );

  function openAddForm() {
    setEditContact(null);
    setEditContactTags([]);
    setFormOpen(true);
  }

  async function openEditForm(contact: Contact) {
    const { data } = await supabase
      .from('contact_tags')
      .select('*')
      .eq('contact_id', contact.id);
    setEditContact(contact);
    setEditContactTags(data ?? []);
    setFormOpen(true);
  }

  function openDetail(contactId: string, focus: 'followup' | null = null) {
    setDetailContactId(contactId);
    setDetailFocus(focus);
    setDetailOpen(true);
  }

  function confirmDelete(contact: Contact) {
    setDeleteTarget(contact);
    setDeleteConfirmOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    // .select('id') so an RLS-blocked delete (no error, zero rows — e.g. an
    // agent hitting a lead they didn't create) surfaces as a failure rather
    // than a false "deleted" toast.
    const { data, error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', deleteTarget.id)
      .select('id');

    if (error || !data || data.length === 0) {
      toast.error("Failed to delete lead — you can only delete leads you created");
    } else {
      toast.success('Lead deleted');
      refreshAll();
    }

    setDeleting(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }

  const allOnPageSelected =
    contacts.length > 0 && contacts.every((c) => selected.has(c.id));
  const someOnPageSelected = contacts.some((c) => selected.has(c.id));

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        contacts.forEach((c) => next.delete(c.id));
      } else {
        contacts.forEach((c) => next.add(c.id));
      }
      return next;
    });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Select every lead matching the current search + filters — including
  // rows on other pages that aren't loaded. Mirrors fetchContacts' filter
  // logic but pulls only ids (no pagination window).
  async function selectAllMatching() {
    const term = search.trim();
    const idFilter = await resolveContactIdFilter(supabase, filters);
    if (idFilter && idFilter.length === 0) {
      setSelected(new Set());
      return;
    }
    let query = supabase
      .from('contacts')
      .select('id, memberships!left(id)')
      .is('memberships', null);
    if (term) {
      const like = `%${term}%`;
      query = query.or(
        `name.ilike.${like},phone.ilike.${like},email.ilike.${like}`
      );
    }
    query = applyLeadFilters(query, filters, idFilter);
    const { data, error } = await query;
    if (error) {
      toast.error('Failed to select all leads');
      return;
    }
    setSelected(new Set((data ?? []).map((c) => c.id)));
  }

  // Export every lead matching the current search + filters to CSV (not
  // just the loaded page). Reuses the exact same query the table builds,
  // then resolves each cell through the same display helpers the table
  // renders with (status/source/gender labels, assignee + creator names,
  // received-via pill). Tags are pulled in a second query, like the table.
  async function handleExport() {
    setExporting(true);
    try {
      const term = search.trim();
      const idFilter = await resolveContactIdFilter(supabase, filters);
      if (idFilter && idFilter.length === 0) {
        toast.error('No leads to export');
        return;
      }
      let query = supabase
        .from('contacts')
        .select('*, memberships!left(id)')
        .is('memberships', null);
      if (term) {
        const like = `%${term}%`;
        query = query.or(
          `name.ilike.${like},phone.ilike.${like},email.ilike.${like}`
        );
      }
      query = applyLeadFilters(query, filters, idFilter);
      const { data, error } = await query.order('created_at', {
        ascending: false,
      });
      if (error) {
        toast.error('Failed to export leads');
        return;
      }
      const rows = (data ?? []) as Contact[];
      if (rows.length === 0) {
        toast.error('No leads to export');
        return;
      }

      // Tag names per contact (second pass, mirrors the table's fetch).
      const ids = rows.map((r) => r.id);
      const { data: ctRows } = await supabase
        .from('contact_tags')
        .select('contact_id, tag_id')
        .in('contact_id', ids);
      const tagNamesByContact: Record<string, string[]> = {};
      ctRows?.forEach((r) => {
        const t = tagsMap[r.tag_id];
        if (t) (tagNamesByContact[r.contact_id] ??= []).push(t.name);
      });

      const headers = [
        'Name',
        'Phone',
        'Email',
        'Company',
        'Status',
        'Source',
        'Gender',
        'Assigned To',
        'Received By',
        'Tags',
        'Created On',
      ];
      const body = rows.map((c) => {
        const auto = autoReceivedLabel(c.received_via);
        const receivedBy = auto ?? (nameById.get(c.user_id) ?? 'Teammate');
        return [
          c.name ?? '',
          c.phone,
          c.email ?? '',
          c.company ?? '',
          fieldOptions.statusFor(c.lead_status).label,
          c.source ? fieldOptions.sourceLabel(c.source) : '',
          c.gender ? fieldOptions.genderLabel(c.gender) : '',
          c.assigned_to ? (nameById.get(c.assigned_to) ?? 'Teammate') : '',
          receivedBy,
          (tagNamesByContact[c.id] ?? []).join(', '),
          fmt.date(c.created_at),
        ];
      });

      const stamp = new Date().toISOString().slice(0, 10);
      downloadCsv(`leads-${stamp}.csv`, toCsv(headers, body));
      toast.success(`Exported ${rows.length} lead${rows.length === 1 ? '' : 's'}`);
    } finally {
      setExporting(false);
    }
  }

  async function handleBulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setDeleting(true);

    // RLS decides which of the selected leads the caller may actually delete
    // (admins: all; agents: only their own human-created leads). .select('id')
    // returns the rows that were really removed, so we can report the skipped
    // remainder honestly instead of claiming a full delete the DB refused.
    const { data, error } = await supabase
      .from('contacts')
      .delete()
      .in('id', ids)
      .select('id');

    if (error) {
      toast.error('Failed to delete leads');
    } else {
      const removed = data?.length ?? 0;
      const skipped = ids.length - removed;
      if (removed === 0) {
        toast.error('You can only delete leads you created');
      } else if (skipped > 0) {
        toast.success(
          `${removed} lead${removed === 1 ? '' : 's'} deleted · ${skipped} skipped (you can only delete leads you created)`,
        );
      } else {
        toast.success(`${removed} lead${removed === 1 ? '' : 's'} deleted`);
      }
      setSelected(new Set());
      refreshAll();
    }

    setDeleting(false);
    setBulkDeleteOpen(false);
  }

  // Properties the bulk-edit dialog can set in one shot. Single-value
  // fields only — identity columns (name/phone/email) and the multi-value
  // tags column are intentionally excluded. Option lists come from the
  // account's own field options + staff roster, so the dialog offers the
  // same choices as the inline cell editors.
  const bulkEditProperties = useMemo<BulkEditProperty[]>(() => {
    const assigneeOptions = [
      { value: UNASSIGNED, label: 'Unassigned' },
      ...staff.map((s) => ({
        value: s.user_id,
        label: s.full_name,
        // Same avatar glyph the Assigned-to cell shows in the table.
        icon: (
          <UserAvatar
            name={s.full_name}
            src={s.avatar_url}
            className="size-5 shrink-0"
            fallbackClassName="text-[10px]"
          />
        ),
      })),
    ];
    return [
      {
        key: 'status',
        label: 'Lead status',
        group: 'Lead fields',
        editor: {
          kind: 'select',
          // Coloured pills, matching the Status cell editor.
          variant: 'pill',
          options: fieldOptions.statuses.map((s) => ({
            value: s.key,
            label: s.label,
            color: s.color,
          })),
        },
      },
      {
        key: 'assignee',
        label: 'Assigned to',
        group: 'Lead fields',
        editor: { kind: 'select', variant: 'plain', options: assigneeOptions },
      },
      // Ownership ("Received by" = contacts.user_id). Moves through the
      // transfer flow, not a column write — gate on canTransfer (agent+),
      // matching the inline cell picker. No "Unassigned" (ownership can't
      // be cleared). Per-lead who-can-move-what is enforced server-side.
      ...(canTransfer
        ? [
            {
              key: 'received_by',
              label: 'Received by',
              group: 'Lead fields' as const,
              editor: {
                kind: 'select' as const,
                variant: 'plain' as const,
                options: staff.map((s) => ({
                  value: s.user_id,
                  label: s.full_name,
                  icon: (
                    <UserAvatar
                      name={s.full_name}
                      src={s.avatar_url}
                      className="size-5 shrink-0"
                      fallbackClassName="text-[10px]"
                    />
                  ),
                })),
              },
            },
          ]
        : []),
      {
        key: 'source',
        label: 'Source',
        group: 'Lead fields',
        editor: {
          kind: 'select',
          variant: 'plain',
          options: fieldOptions.sources.map((o) => ({
            value: o.key,
            label: o.label,
            // Same brand glyph the Source cell editor shows.
            icon: <SourceIcon source={o.key} label={o.label} />,
          })),
        },
      },
      {
        key: 'gender',
        label: 'Gender',
        group: 'Lead fields',
        editor: {
          kind: 'select',
          variant: 'plain',
          options: fieldOptions.genders.map((o) => ({
            value: o.key,
            label: o.label,
          })),
        },
      },
      {
        key: 'company',
        label: 'Company',
        group: 'Lead fields',
        editor: { kind: 'text' },
      },
      ...customFields.map(
        (f): BulkEditProperty => ({
          key: `cf:${f.id}`,
          label: f.field_name,
          group: 'Custom fields',
          editor: { kind: customEditKind(f.field_type) },
        })
      ),
    ];
  }, [fieldOptions, staff, customFields, canTransfer]);

  // Apply one property to every selected lead. Returns true on success so
  // the dialog can close; each failure toasts and keeps it open. Custom
  // fields fan out to one upsert per contact (join-table rows); built-in
  // columns update in a single query. The `.select('id')` on the contacts
  // update turns an RLS-blocked write (silent zero rows) into a failure.
  async function handleBulkEdit(
    property: BulkEditProperty,
    value: string
  ): Promise<boolean> {
    const ids = [...selected];
    if (ids.length === 0) return false;

    if (property.key.startsWith('cf:')) {
      const fieldId = property.key.slice(3);
      const trimmed = value.trim();
      const { error } = await supabase.from('contact_custom_values').upsert(
        ids.map((id) => ({
          contact_id: id,
          custom_field_id: fieldId,
          value: trimmed,
        })),
        { onConflict: 'contact_id,custom_field_id' }
      );
      if (error) {
        toast.error('Failed to update leads');
        return false;
      }
      toast.success(`Updated ${ids.length} lead${ids.length === 1 ? '' : 's'}`);
      setSelected(new Set());
      refreshAll();
      return true;
    }

    // Assignment goes through request_lead_assignment per lead (migration
    // 052) so a non-owner agent can't bulk-bypass the owner's approval:
    // owner/admin changes apply instantly; others become pending requests.
    if (property.key === 'assignee') {
      const target = value === UNASSIGNED ? null : value;
      let approved = 0;
      let pending = 0;
      let skipped = 0;
      for (const id of ids) {
        try {
          const outcome = await requestLeadAssignment(supabase, id, target);
          if (outcome === 'approved') approved++;
          else pending++;
        } catch {
          // No-op (already assigned that way) or not permitted → skip.
          skipped++;
        }
      }
      const parts: string[] = [];
      if (approved) parts.push(`${approved} updated`);
      if (pending) parts.push(`${pending} sent for approval`);
      if (skipped) parts.push(`${skipped} skipped`);
      toast.success(parts.join(' · ') || 'No changes');
      setSelected(new Set());
      refreshAll();
      return true;
    }

    // Ownership ("Received by" = contacts.user_id) moves through the
    // transfer flow (migration 050), not a column write. Loop
    // request_lead_transfer per lead so the server gates who can move what:
    // admin/owner move instantly ('accepted'); an agent's own leads become
    // pending requests; system-generated / not-owned leads throw → skipped.
    if (property.key === 'received_by') {
      let transferred = 0;
      let pending = 0;
      let skipped = 0;
      for (const id of ids) {
        try {
          const outcome = await requestLeadTransfer(supabase, id, value);
          if (outcome === 'accepted') transferred++;
          else pending++;
        } catch {
          skipped++;
        }
      }
      const parts: string[] = [];
      if (transferred) parts.push(`${transferred} transferred`);
      if (pending) parts.push(`${pending} sent for approval`);
      if (skipped) parts.push(`${skipped} skipped`);
      toast.success(parts.join(' · ') || 'No changes');
      setSelected(new Set());
      refreshAll();
      return true;
    }

    let patch: Record<string, unknown>;
    if (property.key === 'status') {
      patch = { lead_status: columnToStatus(value as LeadColumnKey) };
    } else {
      // source / gender / company — raw contacts column, '' clears it.
      patch = { [property.key]: value.trim() || null };
    }

    const { data, error } = await supabase
      .from('contacts')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .in('id', ids)
      .select('id');
    if (error || !data || data.length === 0) {
      toast.error('Failed to update leads');
      return false;
    }
    toast.success(`Updated ${data.length} lead${data.length === 1 ? '' : 's'}`);
    setSelected(new Set());
    refreshAll();
    return true;
  }

  const totalPages = Math.ceil(totalCount / pageSize);
  const hasNext = page < totalPages - 1;
  const hasPrev = page > 0;

  const filterCount = activeFilterCount(filters);
  const hasActiveFilters = search.trim().length > 0 || filterCount > 0;

  // Tags sorted for the Filters panel.
  const allTags = useMemo(
    () => Object.values(tagsMap).sort((a, b) => a.name.localeCompare(b.name)),
    [tagsMap]
  );

  // Enumerable columns get an Excel-style value filter in their header
  // menu. Each maps to a shared LeadFilters dimension (so the column filter
  // and the Filters panel can't drift) plus the checkbox options to offer.
  // Free-text columns (name/phone/email/company/dates/custom) aren't listed
  // — their menus simply omit the Filter item. received_by → owner and
  // created_by → createdBy both filter on the underlying uuid column.
  const columnFilterConfig = useMemo<
    Record<
      string,
      { dim: keyof LeadFilters; options: { value: string; label: string }[] }
    >
  >(() => {
    const staffOptions = staff.map((s) => ({
      value: s.user_id,
      label: s.full_name,
    }));
    const pendingOptions = pendingAssignees.map((p) => ({
      value: `${PENDING_FILTER_PREFIX}${p.id}`,
      label: `${p.name} · pending`,
    }));
    return {
      status: {
        dim: 'leadStatus',
        options: fieldOptions.statuses.map((c) => ({
          value: c.key,
          label: c.label,
        })),
      },
      source: {
        dim: 'source',
        options: fieldOptions.sources.map((o) => ({
          value: o.key,
          label: o.label,
        })),
      },
      gender: {
        dim: 'gender',
        options: fieldOptions.genders.map((o) => ({
          value: o.key,
          label: o.label,
        })),
      },
      tags: {
        dim: 'tags',
        options: allTags.map((t) => ({ value: t.id, label: t.name })),
      },
      assignee: {
        dim: 'assigned',
        options: [
          { value: UNASSIGNED, label: 'Unassigned' },
          ...staffOptions,
          ...pendingOptions,
        ],
      },
      received_by: { dim: 'owner', options: staffOptions },
      created_by: { dim: 'createdBy', options: staffOptions },
    };
  }, [fieldOptions, allTags, staff, pendingAssignees]);

  // Toggle one value of a column's value filter — writes into the shared
  // LeadFilters state (page resets to 0 via the search/filters effect).
  function toggleColumnFilter(dim: keyof LeadFilters, value: string) {
    setFilters((f) => {
      const cur = f[dim];
      if (!Array.isArray(cur)) return f; // only array dimensions are filtered here
      const next = cur.includes(value)
        ? cur.filter((x) => x !== value)
        : [...cur, value];
      return { ...f, [dim]: next };
    });
  }

  // Visible custom columns whose type supports a value filter (text/number).
  const filterableCustomFields = useMemo(
    () =>
      customFields.filter(
        (f) =>
          CUSTOM_FILTER_TYPES.has(f.field_type) &&
          visibleColumns.some((c) => c.key === `cf:${f.id}`)
      ),
    [customFields, visibleColumns]
  );
  const filterableCustomKey = filterableCustomFields.map((f) => f.id).join(',');

  // Load the distinct stored values for each filterable custom column, so its
  // header menu can offer them as checkboxes. One account-scoped read (RLS),
  // deduped client-side — mirrors the customSort value fetch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!filterableCustomKey) {
        if (!cancelled) setCustomFilterOptions({});
        return;
      }
      const ids = filterableCustomKey.split(',');
      const { data } = await supabase
        .from('contact_custom_values')
        .select('custom_field_id, value')
        .in('custom_field_id', ids);
      if (cancelled) return;
      const seen: Record<string, Set<string>> = {};
      for (const r of (data ?? []) as {
        custom_field_id: string;
        value: string | null;
      }[]) {
        const v = r.value?.trim();
        if (!v) continue;
        (seen[r.custom_field_id] ??= new Set<string>()).add(v);
      }
      const map: Record<string, string[]> = {};
      for (const [fid, set] of Object.entries(seen))
        map[fid] = [...set].sort((a, b) => a.localeCompare(b));
      setCustomFilterOptions(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, filterableCustomKey]);

  // Toggle one value of a custom-field value filter (custom_field_id → values).
  function toggleCustomValueFilter(fieldId: string, value: string) {
    setFilters((f) => {
      const cur = f.customValues[fieldId] ?? [];
      const next = cur.includes(value)
        ? cur.filter((x) => x !== value)
        : [...cur, value];
      const customValues = { ...f.customValues };
      if (next.length) customValues[fieldId] = next;
      else delete customValues[fieldId];
      return { ...f, customValues };
    });
  }

  // Sortable columns for the Sort panel, in display order. Real contacts
  // columns sort server-side (sortColumn); custom fields sort client-side
  // over the full filtered id set (see fetchContacts' customSort branch).
  const sortableColumns = useMemo(
    () =>
      visibleColumns
        .filter((c) => c.sortColumn || c.isCustom || c.clientSort)
        .map((c) => ({ key: c.key, label: c.label })),
    [visibleColumns]
  );

  // ---- Display-menu actions ----------------------------------------------
  function setPageSize(n: number) {
    setPrefs((p) => ({ ...p, pageSize: n }));
    setPage(0);
  }

  function setViewMode(mode: ViewMode) {
    setPrefs((p) => ({ ...p, viewMode: mode }));
  }

  function setLeadsView(v: LeadsView) {
    setPrefs((p) => ({ ...p, view: v }));
  }

  function setBoardDensity(density: BoardDensity) {
    setPrefs((p) => ({
      ...p,
      board: { ...(p.board ?? DEFAULT_PREFS.board), density },
    }));
  }

  function setBoardSortWithin(sortWithin: BoardSortWithin) {
    setPrefs((p) => ({
      ...p,
      board: { ...(p.board ?? DEFAULT_PREFS.board), sortWithin },
    }));
  }

  function setBoardCollapseEmpty(collapseEmpty: boolean) {
    setPrefs((p) => ({
      ...p,
      board: { ...(p.board ?? DEFAULT_PREFS.board), collapseEmpty },
    }));
  }

  function resetColumnSizes() {
    setPrefs((p) => ({ ...p, widths: {} }));
  }

  // ---- Column header actions ---------------------------------------------
  // Sort on a column. Re-picking the active direction clears the sort
  // (back to newest-first); page resets since the ordering changed.
  function sortByColumn(key: string, dir: SortDir) {
    setPrefs((p) => {
      const current = p.sort ?? null;
      const same = current?.key === key && current?.dir === dir;
      return { ...p, sort: same ? null : { key, dir } };
    });
    setPage(0);
  }

  // Freeze the leading `n` visible columns (count model). The header menu
  // toggles between "freeze up to here" (index + 1) and "unfreeze" (index).
  function setFrozenColumnCount(n: number) {
    setPrefs((p) => ({ ...p, frozenCount: Math.max(0, n) }));
  }

  function hideColumn(key: string) {
    setPrefs((p) => ({
      ...p,
      hidden: p.hidden.includes(key) ? p.hidden : [...p.hidden, key],
    }));
  }

  function saveColumns(order: string[], hidden: string[], nextFrozen: number) {
    setPrefs((p) => ({ ...p, order, hidden, frozenCount: nextFrozen }));
  }

  // Drop after a header drag → persist the new column order. Reorders the
  // visible keys among themselves and splices them back into the full
  // order (hidden keys stay put). Cross-freeze-boundary moves are rejected
  // so the "leading N are frozen" invariant survives untouched.
  function handleColumnDragEnd(e: DragEndEvent) {
    setDraggingKey(null);
    setOverKey(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const visibleKeys = visibleColumns.map((c) => c.key);
    const oldIndex = visibleKeys.indexOf(String(active.id));
    const newIndex = visibleKeys.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const bothFrozen = oldIndex < frozenCount && newIndex < frozenCount;
    const bothUnfrozen = oldIndex >= frozenCount && newIndex >= frozenCount;
    if (!bothFrozen && !bothUnfrozen) return; // don't cross the freeze line

    const nextVisible = arrayMove(visibleKeys, oldIndex, newIndex);
    const visibleSet = new Set(visibleKeys);
    const queue = [...nextVisible];
    const nextOrder = orderedKeys.map((k) =>
      visibleSet.has(k) ? queue.shift()! : k
    );
    saveColumns(nextOrder, prefs.hidden, frozenCount);
  }

  // Column resize — drag the header's right edge. Width tracks the pointer
  // live (transient state) and commits to prefs on release.
  function startResize(e: React.MouseEvent, col: ColumnDef) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = widthOf(col);

    function onMove(ev: MouseEvent) {
      const w = Math.max(col.minWidth, startWidth + (ev.clientX - startX));
      setResizing({ key: col.key, width: w });
    }
    function onUp(ev: MouseEvent) {
      const w = Math.max(col.minWidth, startWidth + (ev.clientX - startX));
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setResizing(null);
      setPrefs((p) => ({ ...p, widths: { ...p.widths, [col.key]: w } }));
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // Memoised so the Manage Columns dialog (always mounted) gets a STABLE
  // `columns`/`hidden` identity. Recomputing these inline handed the dialog
  // a fresh array every render — including every drag frame — which fired
  // its column-sync effect nonstop and blew the max-update-depth limit.
  const manageColumns: ManageColumn[] = useMemo(
    () =>
      orderedKeys
        .map((k) => colByKey[k])
        .filter(Boolean)
        .map((c) => ({
          key: c.key,
          label: c.label,
          required: c.required,
          isCustom: c.isCustom,
          fieldType: c.customType,
        })),
    [orderedKeys, colByKey]
  );
  const hiddenForDialog = useMemo(
    () => orderedKeys.filter((k) => !isVisible(k)),
    [orderedKeys, isVisible]
  );

  // During a column drag, how far each column's cells slide so the body
  // tracks its (already-shifting) header. The dragged column follows the
  // pointer (dragX); the columns the drag has passed over shift by the
  // dragged column's width toward its vacated slot — mirroring dnd-kit's
  // horizontalListSortingStrategy so header and body displace as one.
  const dragActiveIndex = draggingKey
    ? arrangedColumns.findIndex((c) => c.key === draggingKey)
    : -1;
  const dragOverIndex = overKey
    ? arrangedColumns.findIndex((c) => c.key === overKey)
    : -1;
  const draggedWidth =
    dragActiveIndex >= 0 ? widthOf(arrangedColumns[dragActiveIndex]) : 0;
  function columnDragShift(index: number): number {
    if (dragActiveIndex < 0 || dragOverIndex < 0) return 0;
    if (index === dragActiveIndex) return dragX;
    if (
      dragActiveIndex < dragOverIndex &&
      index > dragActiveIndex &&
      index <= dragOverIndex
    ) {
      return -draggedWidth;
    }
    if (
      dragActiveIndex > dragOverIndex &&
      index < dragActiveIndex &&
      index >= dragOverIndex
    ) {
      return draggedWidth;
    }
    return 0;
  }

  // Geometry for the single drag-shadow overlay (one continuous column
  // shadow, vs a seamy per-cell one). Left edge = checkbox column + the
  // widths of every visible column ahead of the dragged one; it then rides
  // the same dragX translate as the column's cells.
  let dragColLeft = CHECKBOX_COL_WIDTH;
  for (let i = 0; i < dragActiveIndex; i++) {
    dragColLeft += widthOf(arrangedColumns[i]);
  }
  const dragColWidth = draggedWidth;

  const cellClamp =
    viewMode === 'clip' ? 'truncate' : 'whitespace-normal break-words';
  // checkbox + managed columns + actions + trailing spacer
  const totalCols = visibleColumns.length + 3;

  return (
    <div className="flex h-full flex-col gap-3">
      {/* App-bar actions — portalled into the shared header next to the
          page title, so the page doesn't own a second title row. */}
      <PageHeaderActions>
        <GatedButton
          variant="ghost"
          canAct={canEdit}
          gateReason="add or import leads"
          onClick={() => setImportOpen(true)}
          className="text-muted-foreground hover:bg-muted"
        >
          <Download className="size-4" />
          Import
        </GatedButton>
        <Button
          variant="ghost"
          onClick={handleExport}
          disabled={exporting}
          className="text-muted-foreground hover:bg-muted"
        >
          {exporting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          Export
        </Button>
        <GatedButton
          canAct={canEdit}
          gateReason="add or import leads"
          onClick={openAddForm}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          <Plus className="size-4" />
          Add Lead
        </GatedButton>
      </PageHeaderActions>

      {/* Row 2 — search capped on the left; view / settings / columns /
          filters / sort cluster trails on the right (HubSpot-style),
          with the leftover space opening up between the two groups. */}
      <div className="flex shrink-0 items-center justify-between gap-2">
        <SearchInput
          containerClassName="max-w-[560px] min-w-0 flex-1"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search leads…"
        />

        <div className="flex shrink-0 items-center gap-2">
          {/* View type + table settings — one split button group
              (HubSpot-style): the view picker is the main segment, the
              gear a fused right segment. Segments share the middle
              border via -ml-px; focus rings pop above it with z-10. */}
          <div className="flex items-center">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    className={cn(
                      // The settings gear is fused on the right in BOTH views.
                      'border-border text-muted-foreground hover:bg-muted rounded-r-none focus-visible:z-10'
                    )}
                  />
                }
              >
                {view === 'table' ? (
                  <List className="size-4" />
                ) : (
                  <LayoutGrid className="size-4" />
                )}
                <span className="hidden sm:inline">
                  {view === 'table' ? 'Table view' : 'Board view'}
                </span>
                <ChevronDown className="text-muted-foreground size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="bg-popover border-border min-w-44"
              >
                <DropdownMenuItem
                  onClick={() => setLeadsView('table')}
                  className={cn(
                    'focus:bg-muted focus:text-foreground',
                    view === 'table'
                      ? 'text-primary-text'
                      : 'text-popover-foreground'
                  )}
                >
                  <List className="size-4" />
                  Table view
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setLeadsView('board')}
                  className={cn(
                    'focus:bg-muted focus:text-foreground',
                    view === 'board'
                      ? 'text-primary-text'
                      : 'text-popover-foreground'
                  )}
                >
                  <LayoutGrid className="size-4" />
                  Board view
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* Settings gear — fused right segment, both views. Opens the
                active view's own settings (table: pagination / cell text;
                board: card density / sort). */}
            <Button
              variant="outline"
              size="icon"
              onClick={() => setViewSettingsOpen(true)}
              aria-label={view === 'board' ? 'Board settings' : 'Table settings'}
              title={view === 'board' ? 'Board settings' : 'Table settings'}
              className="border-border text-muted-foreground hover:bg-muted -ml-px rounded-l-none focus-visible:z-10"
            >
              <Settings className="size-4" />
            </Button>
          </div>

          {view === 'table' && (
            <Button
              variant="outline"
              onClick={() => setManageColumnsOpen(true)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              <Columns3 className="size-4" />
              <span className="hidden sm:inline">Edit columns</span>
            </Button>
          )}
          {/* Filters constrain the DATA (both views + the CSV export), so
              the panel lives in both — unlike Sort / Edit columns, which
              are table presentation only. Without this, a filter set in
              the table would silently keep applying to the export while
              being invisible (and uncloseable) from the board. */}
          <LeadsFilters
            value={filters}
            onChange={setFilters}
            staff={staff}
            tags={allTags}
            statuses={fieldOptions.statuses}
            sources={fieldOptions.sources}
            genders={fieldOptions.genders}
            pendingInvites={pendingAssignees}
          />
          {view === 'table' && (
            <LeadsSort
              value={sort}
              onChange={(next) => {
                setPrefs((p) => ({ ...p, sort: next }));
                setPage(0);
              }}
              columns={sortableColumns}
            />
          )}
        </div>
      </div>

      {/* Bulk-selection toolbar — one encapsulated row below the search
          toolbar, above the table. `Collapse` (Motion) animates the height +
          fade on both entering and exiting multi-select mode and unmounts the
          row when empty, so the flex gap above the table closes on its own
          (no `-mt-3` hack). `bulkCount` (frozen in the caller) keeps the count
          from flashing "0" during the exit. */}
      {view === 'table' && (
        <Collapse open={selected.size > 0}>
            <div className="border-border bg-card flex flex-wrap items-center gap-0.5 rounded-lg border px-1.5 py-1">
              {/* Selection count + scope menu (None / All in Leads) */}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      className="group text-foreground hover:bg-muted flex h-7 items-center gap-1 rounded-md px-2 text-[0.8rem] font-semibold whitespace-nowrap"
                    />
                  }
                >
                  {bulkCount} record{bulkCount === 1 ? '' : 's'} selected
                  <ChevronDown className="text-muted-foreground size-4 transition-transform duration-150 group-data-[popup-open]:rotate-180" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="bg-popover border-border min-w-56"
                >
                  <DropdownMenuItem
                    onClick={() => setSelected(new Set())}
                    className="text-popover-foreground focus:bg-muted focus:text-foreground"
                  >
                    <X className="size-4" />
                    None
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={selectAllMatching}
                    className="text-popover-foreground focus:bg-muted focus:text-foreground"
                  >
                    <ListChecks className="size-4" />
                    All {totalCount} in Leads
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="bg-border mx-0.5 h-4 w-px" />

              {/* Actions — Edit / Delete / Add note / Convert to member.
                  (Assign lives inside Edit → Assigned to.) */}
              <GatedButton
                variant="ghost"
                size="sm"
                canAct={canEdit}
                gateReason="edit leads"
                onClick={() => setBulkEditOpen(true)}
                className="text-foreground"
              >
                <Pencil />
                Edit
              </GatedButton>
              <GatedButton
                variant="ghost"
                size="sm"
                canAct={canEdit}
                gateReason="delete leads"
                onClick={() => setBulkDeleteOpen(true)}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 />
                Delete
              </GatedButton>
              <GatedButton
                variant="ghost"
                size="sm"
                canAct={canEdit}
                gateReason="add notes"
                onClick={() => setBulkNoteOpen(true)}
                className="text-foreground"
              >
                <StickyNote />
                Add note
              </GatedButton>
              <GatedButton
                variant="ghost"
                size="sm"
                canAct={canEdit}
                gateReason="convert leads to members"
                onClick={() => setBulkConvertOpen(true)}
                className="text-foreground"
              >
                <UserCheck />
                Convert to member
              </GatedButton>

              {/* Close — clears the selection, trailing edge. */}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setSelected(new Set())}
                aria-label="Clear selection"
                className="text-muted-foreground hover:text-foreground ml-auto"
              >
                <X />
              </Button>
            </div>
        </Collapse>
      )}

      {view === 'board' ? (
        <div className="min-h-0 flex-1">
          {boardLoading && boardLeads.length === 0 ? (
            <div className="flex gap-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="bg-muted/50 h-96 flex-1 animate-pulse rounded-xl"
                />
              ))}
            </div>
          ) : boardLeads.length === 0 ? (
            // Whole-board empty state (mirrors the table's) — five "drop a
            // lead here" ghost columns say nothing when there's nothing to
            // drag.
            <div className="border-border bg-card flex h-full flex-col items-center justify-center gap-2 rounded-lg border py-12">
              <Users className="text-muted-foreground size-8" />
              <p className="text-muted-foreground text-sm">
                {hasActiveFilters
                  ? 'No leads match your filters.'
                  : 'No leads yet.'}
              </p>
              {!hasActiveFilters && (
                <GatedButton
                  canAct={canEdit}
                  gateReason="add or import leads"
                  variant="outline"
                  size="sm"
                  onClick={openAddForm}
                  className="border-border text-muted-foreground hover:bg-muted mt-2"
                >
                  <Plus className="size-3.5" />
                  Add your first lead
                </GatedButton>
              )}
            </div>
          ) : (
            <LeadsBoardView
              leads={boardLeads}
              columns={fieldOptions.statuses}
              onStatusPersisted={handleStatusPersisted}
              onOpenLead={openDetail}
              onEditLead={openEditForm}
              onDeleteLead={confirmDelete}
              canEdit={canEdit}
              accountRole={role}
              nameById={nameById}
              avatarById={avatarById}
              transfers={transfers}
              assignmentRequests={assignmentRequests}
              currentUserId={user?.id}
              sourceLabel={fieldOptions.sourceLabel}
              density={boardDensity}
              sortWithin={boardSortWithin}
              collapseEmpty={boardCollapseEmpty}
              supabase={supabase}
            />
          )}
        </div>
      ) : (
        <>
          {/* Table — this is the single bounded scroll region. It fills the
              remaining height (flex-1) so its horizontal scrollbar stays in view
              at the bottom edge and the header sticks while the body scrolls. */}
          <div className="border-border bg-card min-h-0 flex-1 overflow-auto rounded-lg border">
            {/* DndContext wraps the whole <table>, never a <tr>: it emits a
                hidden accessibility live-region <div>, which is invalid HTML
                inside a <tr> (hydration error). SortableContext renders no
                DOM, so it can stay on the header row. */}
            <DndContext
              sensors={dndSensors}
              collisionDetection={closestCenter}
              onDragStart={(e) => {
                setDraggingKey(String(e.active.id));
                setOverKey(String(e.active.id));
                setDragX(0);
              }}
              onDragMove={(e) => setDragX(e.delta.x)}
              onDragOver={(e) => setOverKey(e.over ? String(e.over.id) : null)}
              onDragCancel={() => {
                setDraggingKey(null);
                setOverKey(null);
              }}
              onDragEnd={handleColumnDragEnd}
            >
              {/* Relative wrapper sized to the table so the drag-shadow
                  overlay positions in table coordinates and scrolls with
                  the content. */}
              <div className="relative" style={{ minWidth: totalWidth }}>
                <table
                  className="w-full table-fixed caption-bottom text-sm"
                  style={{ minWidth: totalWidth }}
                >
                  <colgroup>
                    <col style={{ width: CHECKBOX_COL_WIDTH }} />
                    {arrangedColumns.map((col) => (
                      <col key={col.key} style={{ width: widthOf(col) }} />
                    ))}
                    <col style={{ width: ACTIONS_COL_WIDTH }} />
                    <col />
                  </colgroup>
                  <TableHeader className="bg-card sticky top-0 z-10">
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead
                        className={cn(
                          'px-0',
                          hasFrozen && 'bg-card sticky left-0 z-20'
                        )}
                      >
                        <div className="flex items-center justify-center">
                          <Checkbox
                            checked={allOnPageSelected}
                            indeterminate={
                              !allOnPageSelected && someOnPageSelected
                            }
                            onCheckedChange={toggleSelectAll}
                            disabled={contacts.length === 0}
                            aria-label="Select all leads on this page"
                          />
                        </div>
                      </TableHead>
                      <SortableContext
                        items={arrangedColumns.map((c) => c.key)}
                        strategy={horizontalListSortingStrategy}
                      >
                        {arrangedColumns.map((col, i) => {
                          const isFrozen = frozenKeySet.has(col.key);
                          const fc = columnFilterConfig[col.key];
                          let filterProp: ColumnFilterProp | undefined;
                          if (fc) {
                            filterProp = {
                              options: fc.options,
                              selected: filters[fc.dim] as string[],
                              onToggle: (v) => toggleColumnFilter(fc.dim, v),
                            };
                          } else if (
                            col.isCustom &&
                            CUSTOM_FILTER_TYPES.has(col.customType ?? '')
                          ) {
                            const fieldId = col.key.slice(3); // strip "cf:"
                            filterProp = {
                              options: (
                                customFilterOptions[fieldId] ?? []
                              ).map((v) => ({
                                value: v,
                                label: formatCustomFieldValue(
                                  v,
                                  col.customType,
                                  defaultCurrency,
                                  locale.locale
                                ),
                              })),
                              selected: filters.customValues[fieldId] ?? [],
                              onToggle: (v) =>
                                toggleCustomValueFilter(fieldId, v),
                            };
                          }
                          return (
                            <DraggableHeaderCell
                              key={col.key}
                              col={col}
                              isFrozen={isFrozen}
                              filter={filterProp}
                              frozenStyle={frozenCellStyle(col.key)}
                              dragX={col.key === draggingKey ? dragX : 0}
                              sortDir={sort?.key === col.key ? sort.dir : null}
                              onSort={(dir) => sortByColumn(col.key, dir)}
                              // Count model: freeze up to this column (i + 1), or
                              // unfreeze back to just before it (i).
                              onToggleFreeze={() =>
                                setFrozenColumnCount(isFrozen ? i : i + 1)
                              }
                              onAddColumn={() => setManageColumnsOpen(true)}
                              onRemoveColumn={() => hideColumn(col.key)}
                              onEditOptions={
                                col.optionsField && canEditSettings
                                  ? col.optionsField === 'tags'
                                    ? () => router.push('/settings?tab=fields')
                                    : () =>
                                        setEditOptionsKind(
                                          col.optionsField as LeadFieldKind
                                        )
                                  : undefined
                              }
                              onResizeStart={(e) => startResize(e, col)}
                            />
                          );
                        })}
                      </SortableContext>
                      <TableHead />
                      <TableHead aria-hidden />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow className="border-border">
                        <TableCell
                          colSpan={totalCols}
                          className="py-12 text-center"
                        >
                          <div className="flex flex-col items-center gap-2">
                            <Loader2 className="text-primary size-6 animate-spin" />
                            <p className="text-muted-foreground text-sm">
                              Loading leads...
                            </p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : contacts.length === 0 ? (
                      <TableRow className="border-border">
                        <TableCell
                          colSpan={totalCols}
                          className="py-12 text-center"
                        >
                          <div className="flex flex-col items-center gap-2">
                            <Users className="text-muted-foreground size-8" />
                            <p className="text-muted-foreground text-sm">
                              {hasActiveFilters
                                ? 'No leads match your filters.'
                                : 'No leads yet.'}
                            </p>
                            {!hasActiveFilters && (
                              <GatedButton
                                canAct={canEdit}
                                gateReason="add or import leads"
                                variant="outline"
                                size="sm"
                                onClick={openAddForm}
                                className="border-border text-muted-foreground hover:bg-muted mt-2"
                              >
                                <Plus className="size-3.5" />
                                Add your first lead
                              </GatedButton>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      contacts.map((contact) => (
                        <TableRow
                          key={contact.id}
                          className="group border-border hover:bg-muted/50 cursor-pointer"
                          onClick={() => openDetail(contact.id)}
                        >
                          <TableCell
                            onClick={(e) => e.stopPropagation()}
                            className={cn(
                              'px-0',
                              hasFrozen &&
                                'bg-card group-hover:bg-muted/50 sticky left-0 z-10'
                            )}
                          >
                            <div className="flex items-center justify-center">
                              <Checkbox
                                checked={selected.has(contact.id)}
                                onCheckedChange={() => toggleSelect(contact.id)}
                                aria-label={`Select ${contact.name || contact.phone}`}
                              />
                            </div>
                          </TableCell>
                          {arrangedColumns.map((col, ci) => {
                            const shift = columnDragShift(ci);
                            const isDragged = col.key === draggingKey;
                            return (
                              <TableCell
                                key={col.key}
                                style={{
                                  ...frozenCellStyle(col.key),
                                  // The dragged column tracks the pointer; the
                                  // columns it displaces slide by its width — so
                                  // whole columns move as one (Sheets-style).
                                  transform: shift
                                    ? `translateX(${shift}px)`
                                    : undefined,
                                  // Dragged cells track instantly; displaced cells
                                  // ease like their headers. No transition idle.
                                  transition:
                                    draggingKey && !isDragged
                                      ? 'transform 200ms ease'
                                      : undefined,
                                }}
                                className={cn(
                                  'align-middle',
                                  // The editor supplies its own padding so the
                                  // input fills the cell edge-to-edge.
                                  col.edit && canEdit && 'p-0',
                                  // Frozen cells need an opaque base so scrolled
                                  // content can't bleed through; the layered
                                  // hover tint matches the row's own hover.
                                  frozenKeySet.has(col.key) &&
                                    'bg-card group-hover:bg-muted/50 z-10',
                                  // Elevated tint on the column being dragged —
                                  // last so it wins over the frozen/hover bg.
                                  col.key === draggingKey && DRAG_COLUMN_CLASS
                                )}
                              >
                                {col.edit && canEdit ? (
                                  <EditableCell
                                    editing={
                                      editingCell?.id === contact.id &&
                                      editingCell?.key === col.key
                                    }
                                    saving={savingCell}
                                    kind={
                                      col.edit.kind === 'custom'
                                        ? customEditKind(col.customType)
                                        : col.edit.kind === 'assignee'
                                          ? 'select'
                                          : col.edit.kind
                                    }
                                    value={readEditValue(contact, col.edit)}
                                    options={
                                      col.edit.kind === 'status'
                                        ? statusCellOptions(
                                            fieldOptions.statuses
                                          )
                                        : col.edit.kind === 'select'
                                          ? col.edit.column === 'source'
                                            ? sourceCellOptions(
                                                fieldOptions.sources
                                              )
                                            : genderCellOptions(
                                                fieldOptions.genders
                                              )
                                          : col.edit.kind === 'assignee'
                                            ? assigneeCellOptions(staff)
                                            : col.edit.kind === 'tags'
                                              ? allTagOptions
                                              : undefined
                                    }
                                    multiValue={
                                      col.edit.kind === 'tags'
                                        ? (contact.tags ?? []).map((t) => t.id)
                                        : undefined
                                    }
                                    onToggleOption={
                                      col.edit.kind === 'tags'
                                        ? (tagId) =>
                                            toggleContactTag(contact, tagId)
                                        : undefined
                                    }
                                    prefix={
                                      col.customType === 'currency'
                                        ? currencySymbol(defaultCurrency)
                                        : undefined
                                    }
                                    // Render mode content sits directly in the
                                    // editor's flex-centred slot — no line-box
                                    // wrapper, so the hover ring stays symmetric.
                                    display={col.render(contact)}
                                    onStart={() =>
                                      setEditingCell({
                                        id: contact.id,
                                        key: col.key,
                                      })
                                    }
                                    onCommit={(v) =>
                                      commitCell(contact, col.edit!, v)
                                    }
                                    onCancel={() => setEditingCell(null)}
                                  />
                                ) : (
                                  <div className={cn('min-w-0', cellClamp)}>
                                    {col.render(contact)}
                                  </div>
                                )}
                              </TableCell>
                            );
                          })}
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    className="text-muted-foreground hover:text-foreground"
                                  />
                                }
                              >
                                <MoreHorizontal className="size-4" />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="end"
                                className="bg-popover border-border"
                              >
                                <DropdownMenuItem
                                  onClick={() => openDetail(contact.id)}
                                  className="text-popover-foreground focus:bg-muted focus:text-foreground"
                                >
                                  <Eye className="size-4" />
                                  View details
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => openEditForm(contact)}
                                  className="text-popover-foreground focus:bg-muted focus:text-foreground"
                                >
                                  <Pencil className="size-4" />
                                  Edit
                                </DropdownMenuItem>
                                {canDeleteThisLead(contact) && (
                                  <>
                                    <DropdownMenuSeparator className="bg-border" />
                                    <DropdownMenuItem
                                      variant="destructive"
                                      onClick={() => confirmDelete(contact)}
                                    >
                                      <Trash2 className="size-4" />
                                      Delete
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                          <TableCell aria-hidden />
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </table>
                {/* Single drag-shadow overlay — one continuous shadow around
                  the whole dragged column, not a seamy per-cell one. It sits
                  ABOVE the table with a transparent interior, so its box
                  shadow paints over the neighbouring columns while the
                  dragged column's own opaque cells show through untouched.
                  pointer-events-none keeps the drag alive. */}
                {draggingKey && dragActiveIndex >= 0 && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute top-0 bottom-0 z-30 rounded-sm shadow-[0_0_18px_2px_rgba(0,0,0,0.10)]"
                    style={{
                      left: dragColLeft,
                      width: dragColWidth,
                      transform: `translateX(${dragX}px)`,
                    }}
                  />
                )}
              </div>
            </DndContext>
          </div>

          {/* Footer — pinned below the scroll region: record count left,
              pager right. Always visible. */}
          <div className="flex shrink-0 items-center justify-between">
            <p className="text-muted-foreground text-xs">
              {totalCount > 0
                ? `Showing ${page * pageSize + 1}-${Math.min((page + 1) * pageSize, totalCount)} of ${totalCount}`
                : 'No records'}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon-sm"
                disabled={!hasPrev}
                onClick={() => setPage((p) => p - 1)}
                className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
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
                onClick={() => setPage((p) => p + 1)}
                className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Table settings side sheet — pagination, cell text. */}
      <ViewSettingsSheet
        open={viewSettingsOpen}
        onOpenChange={setViewSettingsOpen}
        view={view}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={setPageSize}
        cellText={viewMode}
        onCellTextChange={setViewMode}
        density={boardDensity}
        onDensityChange={setBoardDensity}
        sortWithin={boardSortWithin}
        onSortWithinChange={setBoardSortWithin}
        collapseEmpty={boardCollapseEmpty}
        onCollapseEmptyChange={setBoardCollapseEmpty}
        boardLimit={BOARD_LIMIT}
      />

      {/* Edit columns — split-view picker (catalogue + custom fields on the
          left, ordered selection + freeze count on the right). */}
      <ManageColumnsDialog
        open={manageColumnsOpen}
        onOpenChange={setManageColumnsOpen}
        columns={manageColumns}
        hidden={hiddenForDialog}
        frozenCount={frozenCount}
        onSave={saveColumns}
        onResetWidths={resetColumnSizes}
        canManageFields={canEditSettings}
        onFieldsChanged={fetchCustomFields}
      />

      {/* Lead Form Dialog */}
      <ContactForm
        open={formOpen}
        onOpenChange={setFormOpen}
        contact={editContact}
        contactTags={editContactTags}
        onSaved={() => {
          refreshAll();
          fetchTags();
        }}
        onViewExisting={(id) => {
          setFormOpen(false);
          openDetail(id);
        }}
      />

      {/* Lead Detail Sheet */}
      <ContactDetailView
        open={detailOpen}
        onOpenChange={setDetailOpen}
        contactId={detailContactId}
        initialFocus={detailFocus}
        onUpdated={refreshAll}
      />

      {/* Agent peer-handoff confirm — sends the accept-gated transfer
          request (migration 050). Admins never reach this (instant). */}
      <TransferRequestDialog
        key={transferDialog?.contact.id ?? 'none'}
        open={transferDialog !== null}
        onOpenChange={(open) => {
          if (!open) setTransferDialog(null);
        }}
        targetName={
          transferDialog
            ? nameById.get(transferDialog.targetId) ?? 'Teammate'
            : ''
        }
        targetAvatarUrl={
          transferDialog ? avatarById.get(transferDialog.targetId) : null
        }
        leadName={
          transferDialog
            ? transferDialog.contact.name?.trim() ||
              transferDialog.contact.phone
            : ''
        }
        submitting={transferSubmitting}
        onConfirm={submitTransferRequest}
      />

      {/* "Edit options" — per-account option lists for the status /
          source / gender columns (opened from a column header menu). */}
      <EditFieldOptionsDialog
        kind={editOptionsKind}
        current={
          editOptionsKind === 'status'
            ? fieldOptions.statusOptions
            : editOptionsKind === 'source'
              ? fieldOptions.sources
              : fieldOptions.genders
        }
        onOpenChange={(open) => {
          if (!open) setEditOptionsKind(null);
        }}
        onSaved={fieldOptions.refetch}
      />

      {/* Import Wizard — leads variant: 4-step flow with the editable
          preview grid + Fix-values panel (PRDs/import_leads_ux.md). */}
      <ImportWizard
        variant="leads"
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={refreshAll}
      />

      {/* Delete Confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              Delete Lead
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Are you sure you want to delete{' '}
              <span className="text-popover-foreground font-medium">
                {deleteTarget?.name || deleteTarget?.phone}
              </span>
              ? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation */}
      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              Delete {selected.size} {selected.size === 1 ? 'Lead' : 'Leads'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Are you sure you want to delete{' '}
              <span className="text-popover-foreground font-medium">
                {selected.size} {selected.size === 1 ? 'lead' : 'leads'}
              </span>
              ? This action cannot be undone.
            </DialogDescription>
            {!canDeleteAny && (
              <p className="text-muted-foreground mt-1 text-xs">
                Only leads you created will be deleted — leads created by others
                or captured automatically are skipped.
              </p>
            )}
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setBulkDeleteOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Edit — update one property across the selected leads. */}
      <BulkEditDialog
        open={bulkEditOpen}
        onOpenChange={setBulkEditOpen}
        count={selected.size}
        properties={bulkEditProperties}
        onApply={handleBulkEdit}
      />

      {/* Bulk Add note — one note (+ optional follow-up) on every selected
          lead, reusing the detail sheet's composer. */}
      <BulkAddNoteDialog
        open={bulkNoteOpen}
        onOpenChange={setBulkNoteOpen}
        contactIds={[...selected]}
        onDone={() => {
          setSelected(new Set());
          refreshAll();
        }}
      />

      {/* Bulk Convert — turn the selected leads into members (starts a
          membership; they drop off the leads list). */}
      <BulkConvertDialog
        open={bulkConvertOpen}
        onOpenChange={setBulkConvertOpen}
        contactIds={[...selected]}
        onDone={() => {
          setSelected(new Set());
          refreshAll();
        }}
      />
    </div>
  );
}
