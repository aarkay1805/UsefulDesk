'use client';

// Leads — the merged Contacts + Pipelines section. A lead IS a
// contacts row (no separate entity); contacts that hold a membership
// are members and live under /members instead, so every query here
// anti-joins memberships. Two views over the same list:
//   table — the former Contacts table, plus a Status column
//   board — kanban by lead_status (the former pipeline board's role)

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { sourceLabel, genderLabel } from '@/lib/leads/attributes';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  Eye,
  MoreHorizontal,
  MoreVertical,
  Pencil,
  Trash2,
  Loader2,
  Users,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ListChecks,
  Settings,
  LayoutGrid,
  List,
  SquarePen,
  Search,
  Columns3,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Pin,
  X,
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
  type LeadFilters,
} from '@/components/leads/leads-filters';
import { LeadsSort } from '@/components/leads/leads-sort';
import { useAccountStaff } from '@/components/members/use-account-staff';
import {
  ManageColumnsDialog,
  type ManageColumn,
} from '@/components/contacts/manage-columns-dialog';
import { LeadsBoard } from '@/components/leads/leads-board';
import { EditableCell } from '@/components/leads/editable-cell';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { GatedButton } from '@/components/ui/gated-button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];
const PREFS_KEY = 'usefuldesk:leads:table-prefs';
// The board loads every column at once, so it is capped to the most
// recent leads rather than paginated. Past this size the owner should
// be working the table/action lists, not a 500-card wall.
const BOARD_LIMIT = 500;

// Fixed utility columns flank the managed columns and aren't user-editable.
const CHECKBOX_COL_WIDTH = 44;
const ACTIONS_COL_WIDTH = 48;

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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
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
  return <Badge color={col.color}>{col.label}</Badge>;
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
    render: (c) => (
      <span className="text-muted-foreground text-sm">
        {sourceLabel(c.source)}
      </span>
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
    key: 'tags',
    label: 'Tags',
    defaultWidth: 180,
    minWidth: 120,
    render: renderTags,
    edit: { kind: 'tags' },
    optionsField: 'tags',
  },
  {
    key: 'created',
    label: 'Created',
    defaultWidth: 120,
    minWidth: 100,
    sortColumn: 'created_at',
    render: (c) => (
      <span className="text-muted-foreground text-sm">
        {formatDate(c.created_at)}
      </span>
    ),
  },
];

// Map a custom field's data type to the inline editor's input kind.
function customEditKind(type?: string): 'text' | 'email' | 'number' | 'date' {
  switch (type) {
    case 'currency':
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    case 'email':
      return 'email';
    default:
      return 'text'; // text, phone, url
  }
}

function customColumn(field: CustomField, currency?: string): ColumnDef {
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
          {raw ? formatCustomFieldValue(raw, field.field_type, currency) : '-'}
        </span>
      );
    },
    edit: { kind: 'custom', fieldId: field.id },
  };
}

// Per-column header (HubSpot-style). At rest shows just the label; on
// hover it reveals inline sort arrows and an overflow trigger. The
// overflow menu carries the full column actions (sort / freeze / add /
// remove). The active sort direction stays lit even without hover.
function HeaderCell({
  col,
  sortDir,
  frozen,
  onSort,
  onToggleFreeze,
  onAddColumn,
  onRemoveColumn,
  onEditOptions,
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
}) {
  const sortable = Boolean(col.sortColumn);
  return (
    <div className="group/th flex items-center gap-0.5 pr-2">
      <span className="min-w-0 flex-1 truncate">{col.label}</span>

      {/* Inline sort toggles — hidden until hover, but the active one
          stays visible so the current sort is always legible. */}
      {sortable && (
        <div
          className={cn(
            'flex items-center transition-opacity',
            sortDir ? 'opacity-100' : 'opacity-0 group-hover/th:opacity-100'
          )}
        >
          <button
            type="button"
            aria-label={`Sort ${col.label} ascending`}
            onClick={() => onSort('asc')}
            className={cn(
              'hover:bg-muted flex size-5 items-center justify-center rounded',
              sortDir === 'asc' ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            <ArrowUp className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={`Sort ${col.label} descending`}
            onClick={() => onSort('desc')}
            className={cn(
              'hover:bg-muted flex size-5 items-center justify-center rounded',
              sortDir === 'desc' ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            <ArrowDown className="size-3.5" />
          </button>
        </div>
      )}

      {/* Overflow menu */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={`${col.label} column options`}
              className="text-muted-foreground hover:bg-muted data-[popup-open]:bg-muted flex size-5 items-center justify-center rounded opacity-0 transition-opacity group-hover/th:opacity-100 data-[popup-open]:opacity-100"
            />
          }
        >
          <MoreVertical className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="bg-popover border-border min-w-52"
        >
          <DropdownMenuItem
            disabled={!sortable}
            onClick={() => onSort('asc')}
            className="text-popover-foreground focus:bg-muted focus:text-foreground"
          >
            <ArrowUp className="size-4" />
            Sort ascending
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!sortable}
            onClick={() => onSort('desc')}
            className="text-popover-foreground focus:bg-muted focus:text-foreground"
          >
            <ArrowDown className="size-4" />
            Sort descending
          </DropdownMenuItem>
          {/* Placeholder — no backing feature yet, matches HubSpot's greyed row */}
          <DropdownMenuItem
            disabled
            className="text-popover-foreground focus:bg-muted focus:text-foreground"
          >
            <Sparkles className="size-4" />
            Set up smart property
          </DropdownMenuItem>
          {onEditOptions && (
            <DropdownMenuItem
              onClick={onEditOptions}
              className="text-popover-foreground focus:bg-muted focus:text-foreground"
            >
              <ListChecks className="size-4" />
              Edit options
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator className="bg-border" />
          <DropdownMenuItem
            onClick={onToggleFreeze}
            className="text-popover-foreground focus:bg-muted focus:text-foreground"
          >
            <Pin className="size-4" />
            {frozen ? 'Unfreeze column' : 'Freeze column'}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onAddColumn}
            className="text-popover-foreground focus:bg-muted focus:text-foreground"
          >
            <Plus className="size-4" />
            Add column
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={col.required}
            onClick={onRemoveColumn}
            className="text-popover-foreground focus:bg-muted focus:text-foreground"
          >
            <X className="size-4" />
            Remove column
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
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

// Minimal chainable shape shared by the PostgREST filter builders we
// use — lets one helper apply the lead filters to any of them.
interface FilterableQuery<Q> {
  in(column: string, values: readonly string[]): Q;
  or(filters: string): Q;
  is(column: string, value: null): Q;
  gte(column: string, value: string): Q;
}

// Apply the Filters panel selections to a contacts query. `tagIds` is the
// pre-resolved tag → contact-id constraint (see resolveTagContactIds).
function applyLeadFilters<Q extends FilterableQuery<Q>>(
  query: Q,
  filters: LeadFilters,
  tagIds: string[] | null
): Q {
  let q = query;
  if (tagIds) q = q.in('id', tagIds);

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

  if (filters.assigned.length) {
    const hasUnassigned = filters.assigned.includes(UNASSIGNED);
    const ids = filters.assigned.filter((a) => a !== UNASSIGNED);
    if (hasUnassigned && ids.length) {
      q = q.or(`assigned_to.is.null,assigned_to.in.(${ids.join(',')})`);
    } else if (hasUnassigned) {
      q = q.is('assigned_to', null);
    } else {
      q = q.in('assigned_to', ids);
    }
  }

  const since = createdRangeSince(filters.createdRange);
  if (since) q = q.gte('created_at', since);
  return q;
}

export default function LeadsPage() {
  const supabase = createClient();
  const router = useRouter();
  const { defaultCurrency } = useAuth();
  const canEdit = useCan('send-messages');
  const canEditSettings = useCan('edit-settings');

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

  // Filters (Filters panel) + teammate list for owner/assignee filters.
  const [filters, setFilters] = useState<LeadFilters>(EMPTY_FILTERS);
  const { staff } = useAccountStaff();

  const [contacts, setContacts] = useState<ContactWithData[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  // All tags (for the tags column render + Filters panel).
  const [tagsMap, setTagsMap] = useState<Record<string, Tag>>({});

  // Board view data — fetched independently of the paginated table so
  // switching views doesn't fight the table's pagination window.
  const [boardLeads, setBoardLeads] = useState<Contact[]>([]);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardNonce, setBoardNonce] = useState(0);

  // Custom-field definitions — drive the dynamic columns.
  const [customFields, setCustomFields] = useState<CustomField[]>([]);

  // Table preferences (visibility, order, widths, page size, view mode),
  // persisted per-browser in localStorage.
  const [prefs, setPrefs] = useLocalStorage<TablePrefs>(
    PREFS_KEY,
    DEFAULT_PREFS
  );

  // Transient width during an active column drag (committed to prefs on drop).
  const [resizing, setResizing] = useState<{
    key: string;
    width: number;
  } | null>(null);

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [editContactTags, setEditContactTags] = useState<ContactTag[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailContactId, setDetailContactId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [viewSettingsOpen, setViewSettingsOpen] = useState(false);
  const [manageColumnsOpen, setManageColumnsOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Bulk selection (page-scoped — only the loaded rows are selectable)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

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

  const pageSize = prefs.pageSize;
  const viewMode = prefs.viewMode;
  const view = prefs.view ?? 'table';
  // Defensive reads — prefs saved before these fields existed omit them.
  const sort = prefs.sort ?? null;
  const frozenCountPref = prefs.frozenCount ?? 0;

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
          render: (c) => {
            const s = fieldOptions.statusFor(c.lead_status);
            return <Badge color={s.color}>{s.label}</Badge>;
          },
        };
      }
      if (col.key === 'source') {
        return {
          ...col,
          render: (c) => (
            <span className="text-muted-foreground text-sm">
              {fieldOptions.sourceLabel(c.source)}
            </span>
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
      return col;
    });
    return [
      ...builtins,
      ...customFields.map((f) => customColumn(f, defaultCurrency)),
    ];
  }, [customFields, defaultCurrency, fieldOptions]);

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

    // Tag filter → contact ids. An active filter that matches nothing
    // short-circuits to an empty result (skips the main query).
    const tagIds = await resolveTagContactIds(supabase, filters.tags);
    if (seq !== fetchSeq.current) return;
    if (tagIds && tagIds.length === 0) {
      setTotalCount(0);
      setContacts([]);
      setLoading(false);
      return;
    }

    // Leads = contacts without a membership: PostgREST anti-join via a
    // left embed filtered to null. Filters apply before order/range
    // (transform stage drops the filter methods).
    let query = supabase
      .from('contacts')
      .select('*, memberships!left(id)', { count: 'exact' })
      .is('memberships', null);
    if (term) {
      const like = `%${term}%`;
      query = query.or(
        `name.ilike.${like},phone.ilike.${like},email.ilike.${like}`
      );
    }
    query = applyLeadFilters(query, filters, tagIds);

    const {
      data,
      count: exactCount,
      error,
    } = await query
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
    const contactRows: Contact[] = data ?? [];

    setTotalCount(exactCount ?? 0);

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
    activeCustomKey,
    sortColumn,
    sort,
  ]);

  // Board data — all statuses at once, capped at BOARD_LIMIT most
  // recent. Respects the header search.
  const fetchBoard = useCallback(async () => {
    void boardNonce; // manual refetch trigger — bump to reload
    setBoardLoading(true);
    const term = search.trim();

    let query = supabase
      .from('contacts')
      .select('*, memberships!left(id)')
      .is('memberships', null)
      .order('created_at', { ascending: false })
      .limit(BOARD_LIMIT);

    if (term) {
      const like = `%${term}%`;
      query = query.or(
        `name.ilike.${like},phone.ilike.${like},email.ilike.${like}`
      );
    }

    const { data, error } = await query;
    if (error) {
      toast.error('Failed to load leads');
      setBoardLoading(false);
      return;
    }
    setBoardLeads((data ?? []) as Contact[]);
    setBoardLoading(false);
  }, [supabase, search, boardNonce]);

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
    setBoardNonce((n) => n + 1);
  }, [fetchContacts]);

  // Drag on the board rewrites the lead's status. Optimistic — the
  // card already landed in its new column; revert by refetch on error.
  const handleStatusChange = useCallback(
    async (contactId: string, status: LeadStatus | null) => {
      setBoardLeads((prev) =>
        prev.map((l) =>
          l.id === contactId ? { ...l, lead_status: status } : l
        )
      );
      const { error } = await supabase
        .from('contacts')
        .update({ lead_status: status })
        .eq('id', contactId);
      if (error) {
        toast.error('Failed to update lead status');
        setBoardNonce((n) => n + 1);
      } else {
        // Keep the table's Status column in sync for the next visit.
        setContacts((prev) =>
          prev.map((c) =>
            c.id === contactId ? { ...c, lead_status: status } : c
          )
        );
      }
    },
    [supabase]
  );

  // Current committed value for an editable cell — the editor's baseline.
  function readEditValue(c: ContactWithData, edit: EditSpec): string {
    switch (edit.kind) {
      case 'status':
        return leadColumnKey(c.lead_status);
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
    [supabase]
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

  function openDetail(contactId: string) {
    setDetailContactId(contactId);
    setDetailOpen(true);
  }

  function confirmDelete(contact: Contact) {
    setDeleteTarget(contact);
    setDeleteConfirmOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', deleteTarget.id);

    if (error) {
      toast.error('Failed to delete lead');
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
    const tagIds = await resolveTagContactIds(supabase, filters.tags);
    if (tagIds && tagIds.length === 0) {
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
    query = applyLeadFilters(query, filters, tagIds);
    const { data, error } = await query;
    if (error) {
      toast.error('Failed to select all leads');
      return;
    }
    setSelected(new Set((data ?? []).map((c) => c.id)));
  }

  async function handleBulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setDeleting(true);

    const { error } = await supabase.from('contacts').delete().in('id', ids);

    if (error) {
      toast.error('Failed to delete leads');
    } else {
      toast.success(`${ids.length} lead${ids.length === 1 ? '' : 's'} deleted`);
      setSelected(new Set());
      refreshAll();
    }

    setDeleting(false);
    setBulkDeleteOpen(false);
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

  // Sortable columns (have a DB mapping) for the Sort panel, in display order.
  const sortableColumns = useMemo(
    () =>
      visibleColumns
        .filter((c) => c.sortColumn)
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

  const manageColumns: ManageColumn[] = orderedKeys
    .map((k) => colByKey[k])
    .filter(Boolean)
    .map((c) => ({
      key: c.key,
      label: c.label,
      required: c.required,
      isCustom: c.isCustom,
      fieldType: c.customType,
    }));
  const hiddenForDialog = orderedKeys.filter((k) => !isVisible(k));

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
          variant="outline"
          canAct={canEdit}
          gateReason="add or import leads"
          onClick={() => setImportOpen(true)}
          className="border-border text-muted-foreground hover:bg-muted"
        >
          <Upload className="size-4" />
          Import
        </GatedButton>
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

      {/* Bulk-selection bar — appears only while table rows are selected. */}
      {view === 'table' && selected.size > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:gap-4">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="group text-foreground hover:bg-muted -ml-2.5 flex h-8 items-center gap-1.5 rounded-md px-2.5 text-base font-semibold whitespace-nowrap"
                />
              }
            >
              {selected.size} record{selected.size === 1 ? '' : 's'} selected
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
          <div className="flex flex-wrap items-center gap-2">
            {/* Placeholder — no backing feature yet */}
            <Button
              variant="outline"
              disabled
              className="border-border text-muted-foreground hover:bg-muted"
            >
              <SquarePen className="size-4" />
              Mass update
            </Button>
            <GatedButton
              variant="destructive"
              canAct={canEdit}
              gateReason="delete leads"
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2 className="size-4" />
              Delete selected
            </GatedButton>
          </div>
          <Button
            variant="ghost"
            onClick={() => setSelected(new Set())}
            className="text-foreground hover:bg-muted"
          >
            Clear
          </Button>
        </div>
      )}

      {/* Row 2 — search capped on the left; view / settings / columns /
          filters / sort cluster trails on the right (HubSpot-style),
          with the leftover space opening up between the two groups. */}
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="relative max-w-[560px] min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search leads…"
            className="border-border bg-card text-foreground placeholder:text-muted-foreground rounded-full pl-9"
          />
        </div>

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
                      'border-border text-muted-foreground hover:bg-muted focus-visible:z-10',
                      view === 'table' && 'rounded-r-none'
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
                    view === 'table' ? 'text-primary' : 'text-popover-foreground'
                  )}
                >
                  <List className="size-4" />
                  Table view
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setLeadsView('board')}
                  className={cn(
                    'focus:bg-muted focus:text-foreground',
                    view === 'board' ? 'text-primary' : 'text-popover-foreground'
                  )}
                >
                  <LayoutGrid className="size-4" />
                  Board view
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {view === 'table' && (
              /* Table settings (pagination, cell text, custom fields) */
              <Button
                variant="outline"
                size="icon"
                onClick={() => setViewSettingsOpen(true)}
                aria-label="Table settings"
                title="Table settings"
                className="border-border text-muted-foreground hover:bg-muted -ml-px rounded-l-none focus-visible:z-10"
              >
                <Settings className="size-4" />
              </Button>
            )}
          </div>

          {view === 'table' && (
            <>
              <Button
                variant="outline"
                onClick={() => setManageColumnsOpen(true)}
                className="border-border text-muted-foreground hover:bg-muted"
              >
                <Columns3 className="size-4" />
                <span className="hidden sm:inline">Edit columns</span>
              </Button>
              <LeadsFilters
                value={filters}
                onChange={setFilters}
                staff={staff}
                tags={allTags}
                statuses={fieldOptions.statuses}
                sources={fieldOptions.sources}
                genders={fieldOptions.genders}
              />
              <LeadsSort
                value={sort}
                onChange={(next) => {
                  setPrefs((p) => ({ ...p, sort: next }));
                  setPage(0);
                }}
                columns={sortableColumns}
              />
            </>
          )}
        </div>
      </div>

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
          ) : (
            <>
              {boardLeads.length >= BOARD_LIMIT && (
                <p className="text-muted-foreground mb-2 text-xs">
                  Showing the {BOARD_LIMIT} most recent leads — use the table
                  view to reach the rest.
                </p>
              )}
              <LeadsBoard
                leads={boardLeads}
                columns={fieldOptions.statuses}
                onStatusChange={handleStatusChange}
                onOpenLead={openDetail}
                canEdit={canEdit}
              />
            </>
          )}
        </div>
      ) : (
        <>
          {/* Table — this is the single bounded scroll region. It fills the
              remaining height (flex-1) so its horizontal scrollbar stays in view
              at the bottom edge and the header sticks while the body scrolls. */}
          <div className="border-border bg-card min-h-0 flex-1 overflow-auto rounded-lg border">
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
                    className={cn(hasFrozen && 'bg-card sticky left-0 z-20')}
                  >
                    <Checkbox
                      checked={allOnPageSelected}
                      indeterminate={!allOnPageSelected && someOnPageSelected}
                      onCheckedChange={toggleSelectAll}
                      disabled={contacts.length === 0}
                      aria-label="Select all leads on this page"
                    />
                  </TableHead>
                  {arrangedColumns.map((col, i) => {
                    const isFrozen = frozenKeySet.has(col.key);
                    return (
                      <TableHead
                        key={col.key}
                        style={frozenCellStyle(col.key)}
                        className={cn(
                          'text-muted-foreground select-none',
                          // Positioned ancestor for the resize grip — sticky
                          // frozen cells already establish one.
                          isFrozen ? 'bg-card z-20' : 'relative'
                        )}
                      >
                        <HeaderCell
                          col={col}
                          sortDir={sort?.key === col.key ? sort.dir : null}
                          frozen={isFrozen}
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
                        />
                        {/* Resize grip on the right edge */}
                        <span
                          role="separator"
                          aria-orientation="vertical"
                          onMouseDown={(e) => startResize(e, col)}
                          className="border-border hover:border-primary absolute top-2 right-0 bottom-2 w-1.5 cursor-col-resize border-r hover:border-r-2"
                        />
                      </TableHead>
                    );
                  })}
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
                          hasFrozen &&
                            'bg-card group-hover:bg-muted/50 sticky left-0 z-10'
                        )}
                      >
                        <Checkbox
                          checked={selected.has(contact.id)}
                          onCheckedChange={() => toggleSelect(contact.id)}
                          aria-label={`Select ${contact.name || contact.phone}`}
                        />
                      </TableCell>
                      {arrangedColumns.map((col) => (
                        <TableCell
                          key={col.key}
                          style={frozenCellStyle(col.key)}
                          className={cn(
                            'align-middle',
                            // The editor supplies its own padding so the
                            // input fills the cell edge-to-edge.
                            col.edit && canEdit && 'p-0',
                            // Frozen cells need an opaque base so scrolled
                            // content can't bleed through; the layered
                            // hover tint matches the row's own hover.
                            frozenKeySet.has(col.key) &&
                              'bg-card group-hover:bg-muted/50 z-10'
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
                                  : col.edit.kind
                              }
                              value={readEditValue(contact, col.edit)}
                              options={
                                col.edit.kind === 'status'
                                  ? fieldOptions.statuses.map((c) => ({
                                      value: c.key,
                                      label: c.label,
                                      color: c.color,
                                    }))
                                  : col.edit.kind === 'select'
                                    ? (col.edit.column === 'source'
                                        ? fieldOptions.sources
                                        : fieldOptions.genders
                                      ).map((o) => ({
                                        value: o.key,
                                        label: o.label,
                                      }))
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
                                  ? (tagId) => toggleContactTag(contact, tagId)
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
                                setEditingCell({ id: contact.id, key: col.key })
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
                      ))}
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
                            <DropdownMenuSeparator className="bg-border" />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => confirmDelete(contact)}
                            >
                              <Trash2 className="size-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                      <TableCell aria-hidden />
                    </TableRow>
                  ))
                )}
              </TableBody>
            </table>
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
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={setPageSize}
        cellText={viewMode}
        onCellTextChange={setViewMode}
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
        onUpdated={refreshAll}
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

      {/* Import Wizard */}
      <ImportWizard
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
    </div>
  );
}
