'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Contact, Tag, ContactTag, CustomField } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Table,
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
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Plus,
  Upload,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  Users,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ListChecks,
  SlidersHorizontal,
  Columns3,
  Columns2,
  Settings,
  Eye,
  List,
  Filter,
  Tag as TagIcon,
  SquarePen,
  X,
} from 'lucide-react';
import { ContactForm } from '@/components/contacts/contact-form';
import { ContactDetailView } from '@/components/contacts/contact-detail-view';
import { ImportModal } from '@/components/contacts/import-modal';
import { CustomFieldsManager } from '@/components/contacts/custom-fields-manager';
import {
  ManageColumnsDialog,
  type ManageColumn,
} from '@/components/contacts/manage-columns-dialog';
import { useCan } from '@/hooks/use-can';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { GatedButton } from '@/components/ui/gated-button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];
const PREFS_KEY = 'usefuldesk:contacts:table-prefs';

// Fixed utility columns flank the managed columns and aren't user-editable.
const CHECKBOX_COL_WIDTH = 44;
const ACTIONS_COL_WIDTH = 48;

type ViewMode = 'wrap' | 'clip';

interface TablePrefs {
  order: string[];
  hidden: string[];
  widths: Record<string, number>;
  pageSize: number;
  viewMode: ViewMode;
}

const DEFAULT_PREFS: TablePrefs = {
  order: [],
  hidden: [],
  widths: {},
  pageSize: DEFAULT_PAGE_SIZE,
  viewMode: 'clip',
};

interface ContactWithData extends Contact {
  tags?: Tag[];
  customValues?: Record<string, string>;
}

interface ColumnDef {
  key: string;
  label: string;
  required?: boolean;
  isCustom?: boolean;
  defaultWidth: number;
  minWidth: number;
  render: (c: ContactWithData) => React.ReactNode;
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
    return <span className="text-xs text-muted-foreground">-</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {c.tags.slice(0, 3).map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{ backgroundColor: tag.color + '20', color: tag.color }}
        >
          {tag.name}
        </span>
      ))}
      {c.tags.length > 3 && (
        <span className="text-[10px] text-muted-foreground">
          +{c.tags.length - 3}
        </span>
      )}
    </div>
  );
}

const BUILTIN_COLUMNS: ColumnDef[] = [
  {
    key: 'name',
    label: 'Name',
    required: true,
    defaultWidth: 220,
    minWidth: 120,
    render: (c) =>
      c.name ? (
        <span className="font-medium text-foreground">{c.name}</span>
      ) : (
        <span className="italic text-muted-foreground">Unnamed</span>
      ),
  },
  {
    key: 'phone',
    label: 'Phone',
    defaultWidth: 150,
    minWidth: 110,
    render: (c) => (
      <span className="font-mono text-xs text-muted-foreground">{c.phone}</span>
    ),
  },
  {
    key: 'email',
    label: 'Email',
    defaultWidth: 240,
    minWidth: 140,
    render: (c) => (
      <span className="text-sm text-muted-foreground">{c.email || '-'}</span>
    ),
  },
  {
    key: 'company',
    label: 'Company',
    defaultWidth: 160,
    minWidth: 120,
    render: (c) => (
      <span className="text-sm text-muted-foreground">{c.company || '-'}</span>
    ),
  },
  {
    key: 'tags',
    label: 'Tags',
    defaultWidth: 180,
    minWidth: 120,
    render: renderTags,
  },
  {
    key: 'created',
    label: 'Created',
    defaultWidth: 120,
    minWidth: 100,
    render: (c) => (
      <span className="text-xs text-muted-foreground">
        {formatDate(c.created_at)}
      </span>
    ),
  },
];

function customColumn(field: CustomField): ColumnDef {
  return {
    key: `cf:${field.id}`,
    label: field.field_name,
    isCustom: true,
    defaultWidth: 160,
    minWidth: 120,
    render: (c) => (
      <span className="text-sm text-muted-foreground">
        {c.customValues?.[field.id] || '-'}
      </span>
    ),
  };
}

export default function ContactsPage() {
  const supabase = createClient();
  const canEdit = useCan('send-messages');
  const canEditSettings = useCan('edit-settings');

  // Search is driven by the shared header's global search via the `?search=`
  // query param — there's no page-level search input anymore.
  const searchParams = useSearchParams();
  const search = searchParams.get('search') ?? '';

  const [contacts, setContacts] = useState<ContactWithData[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  // Tag filter — contacts shown must have ANY of these tags (OR).
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  // Custom-field definitions — drive the dynamic columns.
  const [customFields, setCustomFields] = useState<CustomField[]>([]);

  // Table preferences (visibility, order, widths, page size, view mode),
  // persisted per-browser in localStorage.
  const [prefs, setPrefs] = useLocalStorage<TablePrefs>(PREFS_KEY, DEFAULT_PREFS);

  // Transient width during an active column drag (committed to prefs on drop).
  const [resizing, setResizing] = useState<{ key: string; width: number } | null>(
    null
  );

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [editContactTags, setEditContactTags] = useState<ContactTag[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailContactId, setDetailContactId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [customFieldsOpen, setCustomFieldsOpen] = useState(false);
  const [manageColumnsOpen, setManageColumnsOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Bulk selection (page-scoped — only the loaded rows are selectable)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // All tags for display
  const [tagsMap, setTagsMap] = useState<Record<string, Tag>>({});

  // Guards against out-of-order fetch responses: each fetchContacts run
  // claims a sequence number and only the latest is allowed to commit its
  // results. Without this, rapidly toggling tag filters could let a slower
  // earlier request resolve last and render stale rows.
  const fetchSeq = useRef(0);

  const pageSize = prefs.pageSize;
  const viewMode = prefs.viewMode;

  // ---- Column resolution --------------------------------------------------
  // Live columns = built-ins + one per custom field. Effective order applies
  // saved order for keys that still exist and appends any new columns; dead
  // keys are dropped. Custom columns default to hidden until the user saves
  // them via Manage Columns (i.e. their key appears in prefs.order).
  const liveColumns = useMemo<ColumnDef[]>(
    () => [...BUILTIN_COLUMNS, ...customFields.map(customColumn)],
    [customFields]
  );

  const colByKey = useMemo(() => {
    const map: Record<string, ColumnDef> = {};
    liveColumns.forEach((c) => (map[c.key] = c));
    return map;
  }, [liveColumns]);

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

  // Custom field ids whose column is currently shown — only these need their
  // per-contact values fetched. Joined to a stable string for fetch deps.
  const activeCustomFieldIds = useMemo(
    () =>
      visibleColumns
        .filter((c) => c.isCustom)
        .map((c) => c.key.slice(3)), // strip "cf:"
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

  const fetchTags = useCallback(async () => {
    const { data } = await supabase.from('tags').select('*');
    if (data) {
      const map: Record<string, Tag> = {};
      data.forEach((t) => (map[t.id] = t));
      setTagsMap(map);
      // Drop any filter selections whose tag no longer exists (e.g. a tag
      // deleted elsewhere) so it can't linger invisibly in the query.
      setSelectedTagIds((prev) => {
        const pruned = prev.filter((id) => map[id]);
        return pruned.length === prev.length ? prev : pruned;
      });
    }
  }, [supabase]);

  const fetchCustomFields = useCallback(async () => {
    const { data } = await supabase
      .from('custom_fields')
      .select('*')
      .order('field_name');
    if (data) setCustomFields(data);
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

    let contactRows: Contact[];
    let count: number;

    if (selectedTagIds.length > 0) {
      // Tag filter active — resolve it server-side (join + distinct +
      // windowed total count + pagination) so a tag covering many
      // contacts can't silently truncate the result or overflow an IN
      // clause. See migration 025_filter_contacts_by_tags.
      const { data, error } = await supabase.rpc('filter_contacts_by_tags', {
        p_tag_ids: selectedTagIds,
        p_search: term || null,
        p_limit: pageSize,
        p_offset: from,
      });
      if (seq !== fetchSeq.current) return; // superseded by a newer fetch
      if (error) {
        toast.error('Failed to load contacts');
        setLoading(false);
        return;
      }
      const rows = (data ?? []) as { contact: Contact; total_count: number }[];
      contactRows = rows.map((r) => r.contact);
      count = rows.length > 0 ? Number(rows[0].total_count) : 0;
    } else {
      let query = supabase
        .from('contacts')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (term) {
        const like = `%${term}%`;
        query = query.or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like}`);
      }

      const { data, count: exactCount, error } = await query;
      if (seq !== fetchSeq.current) return; // superseded by a newer fetch
      if (error) {
        toast.error('Failed to load contacts');
        setLoading(false);
        return;
      }
      contactRows = data ?? [];
      count = exactCount ?? 0;
    }

    setTotalCount(count);

    if (contactRows.length === 0) {
      setContacts([]);
      setLoading(false);
      return;
    }

    const contactIds = contactRows.map((c) => c.id);

    // Tags + (optionally) custom-field values for the loaded rows, in
    // parallel. Custom values are only fetched when a custom column is shown.
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
        : Promise.resolve({ data: [] as { contact_id: string; custom_field_id: string; value: string | null }[] }),
    ]);
    if (seq !== fetchSeq.current) return; // superseded by a newer fetch

    const tagsByContact: Record<string, string[]> = {};
    contactTagsRes.data?.forEach((ct) => {
      if (!tagsByContact[ct.contact_id]) tagsByContact[ct.contact_id] = [];
      tagsByContact[ct.contact_id].push(ct.tag_id);
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
  }, [supabase, page, pageSize, search, selectedTagIds, tagsMap, activeCustomKey]);

  // Load-once-on-mount-ish data fetches. Each setter inside runs
  // inside an async promise completion (Supabase await), not
  // synchronously in the effect body, so the cascade the lint rule
  // warns about doesn't apply here.
  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  useEffect(() => {
    fetchCustomFields();
  }, [fetchCustomFields]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  // A new global-search term shrinks/grows the result set, so page N may no
  // longer be valid — reset to the first page whenever the term changes.
  useEffect(() => {
    setPage(0);
  }, [search]);

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
      toast.error('Failed to delete contact');
    } else {
      toast.success('Contact deleted');
      fetchContacts();
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

  // Select every contact matching the current search/tag filter — including
  // rows on other pages that aren't loaded. Reuses the same filter logic as
  // fetchContacts but pulls only ids (no pagination window).
  async function selectAllMatching() {
    const term = search.trim();
    let ids: string[] = [];

    if (selectedTagIds.length > 0) {
      const { data, error } = await supabase.rpc('filter_contacts_by_tags', {
        p_tag_ids: selectedTagIds,
        p_search: term || null,
        p_limit: totalCount || 100000,
        p_offset: 0,
      });
      if (error) {
        toast.error('Failed to select all contacts');
        return;
      }
      const rows = (data ?? []) as { contact: Contact }[];
      ids = rows.map((r) => r.contact.id);
    } else {
      let query = supabase.from('contacts').select('id');
      if (term) {
        const like = `%${term}%`;
        query = query.or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like}`);
      }
      const { data, error } = await query;
      if (error) {
        toast.error('Failed to select all contacts');
        return;
      }
      ids = (data ?? []).map((c) => c.id);
    }

    setSelected(new Set(ids));
  }

  async function handleBulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setDeleting(true);

    const { error } = await supabase.from('contacts').delete().in('id', ids);

    if (error) {
      toast.error('Failed to delete contacts');
    } else {
      toast.success(`${ids.length} contact${ids.length === 1 ? '' : 's'} deleted`);
      setSelected(new Set());
      fetchContacts();
    }

    setDeleting(false);
    setBulkDeleteOpen(false);
  }

  const totalPages = Math.ceil(totalCount / pageSize);
  const hasNext = page < totalPages - 1;
  const hasPrev = page > 0;

  // Tag filter helpers. Every change resets to page 0 — the result set
  // shrinks/grows so page N may no longer be valid (mirrors the search box).
  const allTags = Object.values(tagsMap).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const hasActiveFilters = search.trim().length > 0 || selectedTagIds.length > 0;

  function toggleTagFilter(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    );
    setPage(0);
  }

  function clearTagFilters() {
    setSelectedTagIds([]);
    setPage(0);
  }

  // ---- Display-menu actions ----------------------------------------------
  function setPageSize(n: number) {
    setPrefs((p) => ({ ...p, pageSize: n }));
    setPage(0);
  }

  function setViewMode(mode: ViewMode) {
    setPrefs((p) => ({ ...p, viewMode: mode }));
  }

  function resetColumnSizes() {
    setPrefs((p) => ({ ...p, widths: {} }));
  }

  function saveColumns(order: string[], hidden: string[]) {
    setPrefs((p) => ({ ...p, order, hidden }));
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
    .map((c) => ({ key: c.key, label: c.label, required: c.required }));
  const hiddenForDialog = orderedKeys.filter((k) => !isVisible(k));

  const cellClamp =
    viewMode === 'clip' ? 'truncate' : 'whitespace-normal break-words';
  // checkbox + managed columns + actions + trailing spacer
  const totalCols = visibleColumns.length + 3;

  return (
    <div className="space-y-6">
      {/* Toolbar — left cluster swaps between browse and selection modes;
          the right cluster (Import / Add) is constant. */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {selected.size > 0 ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      className="group -ml-2.5 flex h-8 items-center gap-1.5 rounded-md px-2.5 text-base font-semibold whitespace-nowrap text-foreground hover:bg-muted"
                    />
                  }
                >
                  {selected.size} record{selected.size === 1 ? '' : 's'} selected
                  <ChevronDown className="size-4 text-muted-foreground transition-transform duration-150 group-data-[popup-open]:rotate-180" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="min-w-56 bg-popover border-border"
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
                    All {totalCount} in Contacts
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="flex items-center gap-2">
                {/* Placeholder — no backing feature yet */}
                <Button
                  variant="outline"
                  disabled
                  className="border-border text-muted-foreground hover:bg-muted"
                >
                  <SquarePen className="size-4" />
                  Mass update
                </Button>
                {/* Placeholder — no backing feature yet */}
                <Button
                  variant="outline"
                  disabled
                  className="border-border text-muted-foreground hover:bg-muted"
                >
                  <TagIcon className="size-4" />
                  Tags
                </Button>
                <GatedButton
                  variant="destructive"
                  canAct={canEdit}
                  gateReason="delete contacts"
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
            </>
          ) : (
            <>
              <span className="text-base font-semibold text-foreground whitespace-nowrap">
                All contacts
              </span>
              <div className="flex items-center gap-2">
                <Popover>
                  <PopoverTrigger
                    render={
                      <Button
                        variant="outline"
                        className="border-border text-muted-foreground hover:bg-muted shrink-0"
                      />
                    }
                  >
                    <Filter className="size-4" />
                    Filter
                    {selectedTagIds.length > 0 && (
                      <span className="ml-1 inline-flex items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                        {selectedTagIds.length}
                      </span>
                    )}
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-64 p-0">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                      <span className="text-sm font-medium text-popover-foreground">
                        Filter by tags
                      </span>
                      {selectedTagIds.length > 0 && (
                        <button
                          onClick={clearTagFilters}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          Clear all
                        </button>
                      )}
                    </div>
                    {allTags.length === 0 ? (
                      <p className="px-3 py-4 text-sm text-muted-foreground text-center">
                        No tags yet.
                      </p>
                    ) : (
                      <div className="max-h-64 overflow-y-auto py-1">
                        {allTags.map((tag) => (
                          <label
                            key={tag.id}
                            className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-muted/50"
                          >
                            <Checkbox
                              checked={selectedTagIds.includes(tag.id)}
                              onCheckedChange={() => toggleTagFilter(tag.id)}
                              aria-label={`Filter by ${tag.name}`}
                            />
                            <span
                              className="size-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: tag.color }}
                            />
                            <span className="text-sm text-popover-foreground truncate">
                              {tag.name}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
                {canEditSettings && (
                  <Button
                    variant="outline"
                    onClick={() => setCustomFieldsOpen(true)}
                    className="border-border text-muted-foreground hover:bg-muted"
                  >
                    <SlidersHorizontal className="size-4" />
                    Custom fields
                  </Button>
                )}
                {/* Display — column/view settings menu (Zoho-style). */}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline"
                        className="border-border text-muted-foreground hover:bg-muted"
                      />
                    }
                  >
                    <Columns3 className="size-4" />
                    Display
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="min-w-60 bg-popover border-border"
                  >
                    <DropdownMenuItem
                      onClick={() => setManageColumnsOpen(true)}
                      className="text-popover-foreground focus:bg-muted focus:text-foreground"
                    >
                      <Settings className="size-4" />
                      Manage Columns
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={resetColumnSizes}
                      className="text-popover-foreground focus:bg-muted focus:text-foreground"
                    >
                      <Columns2 className="size-4" />
                      Reset Column Size
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-border" />
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="text-popover-foreground">
                        <List className="size-4" />
                        Records Per Page
                        <span className="ml-auto text-xs text-muted-foreground">
                          {pageSize}
                        </span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuRadioGroup
                          value={String(pageSize)}
                          onValueChange={(v) => setPageSize(Number(v))}
                        >
                          {PAGE_SIZE_OPTIONS.map((n) => (
                            <DropdownMenuRadioItem key={n} value={String(n)}>
                              {n}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="text-popover-foreground">
                        <Eye className="size-4" />
                        View Mode
                        <span className="ml-auto text-xs text-muted-foreground">
                          {viewMode === 'clip' ? 'Clip Text' : 'Wrap Text'}
                        </span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuRadioGroup
                          value={viewMode}
                          onValueChange={(v) => setViewMode(v as ViewMode)}
                        >
                          <DropdownMenuRadioItem value="wrap">
                            Wrap Text
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="clip">
                            Clip Text
                          </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <GatedButton
            variant="outline"
            canAct={canEdit}
            gateReason="add or import contacts"
            onClick={() => setImportOpen(true)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            <Upload className="size-4" />
            Import
          </GatedButton>
          <GatedButton
            canAct={canEdit}
            gateReason="add or import contacts"
            onClick={openAddForm}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Plus className="size-4" />
            Add Contact
          </GatedButton>
        </div>
      </div>

      {/* Active tag-filter chips */}
      {selectedTagIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {selectedTagIds.map((id) => {
            const tag = tagsMap[id];
            if (!tag) return null;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{
                  backgroundColor: tag.color + '20',
                  color: tag.color,
                }}
              >
                {tag.name}
                <button
                  onClick={() => toggleTagFilter(id)}
                  aria-label={`Remove ${tag.name} filter`}
                  className="hover:opacity-70"
                >
                  <X className="size-3" />
                </button>
              </span>
            );
          })}
          <button
            onClick={clearTagFilters}
            className="text-xs text-muted-foreground hover:text-foreground px-1"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {/* Table fills the container (rows span edge-to-edge); columns keep
            their fixed widths and a trailing spacer col absorbs any leftover
            width. min-width forces horizontal scroll when columns overflow. */}
        <Table className="table-fixed" style={{ minWidth: totalWidth }}>
          <colgroup>
            <col style={{ width: CHECKBOX_COL_WIDTH }} />
            {visibleColumns.map((col) => (
              <col key={col.key} style={{ width: widthOf(col) }} />
            ))}
            <col style={{ width: ACTIONS_COL_WIDTH }} />
            <col />
          </colgroup>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead>
                <Checkbox
                  checked={allOnPageSelected}
                  indeterminate={!allOnPageSelected && someOnPageSelected}
                  onCheckedChange={toggleSelectAll}
                  disabled={contacts.length === 0}
                  aria-label="Select all contacts on this page"
                />
              </TableHead>
              {visibleColumns.map((col) => (
                <TableHead
                  key={col.key}
                  className="relative text-muted-foreground select-none"
                >
                  <span className="block truncate pr-2">{col.label}</span>
                  {/* Resize grip on the right edge */}
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    onMouseDown={(e) => startResize(e, col)}
                    className="absolute top-2 bottom-2 right-0 w-1.5 cursor-col-resize border-r border-border hover:border-r-2 hover:border-primary"
                  />
                </TableHead>
              ))}
              <TableHead />
              <TableHead aria-hidden />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="border-border">
                <TableCell colSpan={totalCols} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="size-6 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">Loading contacts...</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : contacts.length === 0 ? (
              <TableRow className="border-border">
                <TableCell colSpan={totalCols} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2">
                    <Users className="size-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {hasActiveFilters
                        ? 'No contacts match your filters.'
                        : 'No contacts yet.'}
                    </p>
                    {!hasActiveFilters && (
                      <GatedButton
                        canAct={canEdit}
                        gateReason="add or import contacts"
                        variant="outline"
                        size="sm"
                        onClick={openAddForm}
                        className="mt-2 border-border text-muted-foreground hover:bg-muted"
                      >
                        <Plus className="size-3.5" />
                        Add your first contact
                      </GatedButton>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              contacts.map((contact) => (
                <TableRow
                  key={contact.id}
                  className="border-border hover:bg-muted/50 cursor-pointer"
                  onClick={() => openDetail(contact.id)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(contact.id)}
                      onCheckedChange={() => toggleSelect(contact.id)}
                      aria-label={`Select ${contact.name || contact.phone}`}
                    />
                  </TableCell>
                  {visibleColumns.map((col) => (
                    <TableCell key={col.key} className="align-middle">
                      <div className={cn('min-w-0', cellClamp)}>
                        {col.render(contact)}
                      </div>
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
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {page * pageSize + 1}-{Math.min((page + 1) * pageSize, totalCount)} of{' '}
            {totalCount}
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
            <span className="text-xs text-muted-foreground px-2">
              Page {page + 1} of {totalPages}
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
      )}

      {/* Manage Columns Dialog */}
      <ManageColumnsDialog
        open={manageColumnsOpen}
        onOpenChange={setManageColumnsOpen}
        columns={manageColumns}
        hidden={hiddenForDialog}
        onSave={saveColumns}
      />

      {/* Contact Form Dialog */}
      <ContactForm
        open={formOpen}
        onOpenChange={setFormOpen}
        contact={editContact}
        contactTags={editContactTags}
        onSaved={() => {
          fetchContacts();
          fetchTags();
        }}
        onViewExisting={(id) => {
          setFormOpen(false);
          openDetail(id);
        }}
      />

      {/* Contact Detail Sheet */}
      <ContactDetailView
        open={detailOpen}
        onOpenChange={setDetailOpen}
        contactId={detailContactId}
        onUpdated={fetchContacts}
      />

      {/* Import Modal */}
      <ImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={fetchContacts}
      />

      {/* Custom Fields Manager (admin+) */}
      {canEditSettings && (
        <CustomFieldsManager
          open={customFieldsOpen}
          onOpenChange={(open) => {
            setCustomFieldsOpen(open);
            // Field defs may have changed — refresh the column list.
            if (!open) fetchCustomFields();
          }}
        />
      )}

      {/* Delete Confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">Delete Contact</DialogTitle>
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
              Delete {selected.size} {selected.size === 1 ? 'Contact' : 'Contacts'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Are you sure you want to delete{' '}
              <span className="text-popover-foreground font-medium">
                {selected.size} {selected.size === 1 ? 'contact' : 'contacts'}
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
