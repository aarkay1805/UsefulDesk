'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { CUSTOM_FIELD_TYPES } from '@/lib/contacts/field-mapping';
import { cn } from '@/lib/utils';

export interface ManageColumn {
  key: string;
  label: string;
  required?: boolean;
  isCustom?: boolean;
  /** Custom field's stored data type (see CUSTOM_FIELD_TYPES). */
  fieldType?: string;
}

interface ManageColumnsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** All manageable columns, in their current effective order. */
  columns: ManageColumn[];
  /** Keys currently hidden. */
  hidden: string[];
  /** Number of leading columns frozen (sticky-left). */
  frozenCount: number;
  onSave: (order: string[], hidden: string[], frozenCount: number) => void;
  /** Restore default column widths. Applies immediately. */
  onResetWidths?: () => void;
  /** Admins can create / rename / delete custom fields inline. */
  canManageFields: boolean;
  /** Called after a custom-field create/rename/delete so the caller refetches. */
  onFieldsChanged: () => void;
}

// "Edit columns" — a two-pane picker (HubSpot-style). Left: the searchable
// catalogue of lead fields + custom fields (with inline field CRUD for
// admins). Right: the ordered "selected columns" list — drag to reorder,
// × to hide, and a "Frozen columns" count that pins the leading N.
// Column order / visibility / freeze are drafts committed on Apply; custom
// field create/rename/delete hit the DB immediately (they can't be undone
// by Cancel).
export function ManageColumnsDialog({
  open,
  onOpenChange,
  columns,
  hidden,
  frozenCount,
  onSave,
  onResetWidths,
  canManageFields,
  onFieldsChanged,
}: ManageColumnsDialogProps) {
  const supabase = createClient();
  const { user, accountId } = useAuth();

  // Draft state (committed on Apply).
  const [visibleOrder, setVisibleOrder] = useState<string[]>([]);
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([]);
  const [frozen, setFrozen] = useState(0);
  const [query, setQuery] = useState('');

  // Custom-field CRUD (immediate).
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('text');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // The custom field being edited in the nested dialog (null = closed).
  const [editField, setEditField] = useState<{
    id: string;
    name: string;
    type: string;
  } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Keys seen last render — lets us merge live catalogue changes (a field
  // created/deleted while the dialog is open) into the draft.
  const seen = useRef<Set<string>>(new Set());

  const metaByKey = useMemo(() => {
    const map: Record<string, ManageColumn> = {};
    columns.forEach((c) => (map[c.key] = c));
    return map;
  }, [columns]);

  // Seed the draft each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    const hiddenSet = new Set(hidden);
    setVisibleOrder(columns.filter((c) => !hiddenSet.has(c.key)).map((c) => c.key));
    setHiddenKeys(columns.filter((c) => hiddenSet.has(c.key)).map((c) => c.key));
    setFrozen(frozenCount);
    setQuery('');
    setNewName('');
    setNewType('text');
    seen.current = new Set(columns.map((c) => c.key));
    // Snapshot at open — props change during editing are merged separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Merge live catalogue changes (custom field created/deleted) into the
  // draft without disturbing in-progress edits. New keys join as hidden.
  useEffect(() => {
    const liveKeys = columns.map((c) => c.key);
    const liveSet = new Set(liveKeys);
    const newKeys = liveKeys.filter((k) => !seen.current.has(k));
    seen.current = liveSet;
    if (newKeys.length === 0) {
      // Still prune any keys that vanished (deleted field). Return the
      // SAME array when nothing was pruned so React bails out of the
      // update — otherwise a fresh `columns` prop identity each parent
      // render would schedule an endless string of no-op state updates
      // (max-update-depth).
      const prune = (prev: string[]) => {
        const next = prev.filter((k) => liveSet.has(k));
        return next.length === prev.length ? prev : next;
      };
      setVisibleOrder(prune);
      setHiddenKeys(prune);
      return;
    }
    setVisibleOrder((prev) => prev.filter((k) => liveSet.has(k)));
    setHiddenKeys((prev) => [
      ...prev.filter((k) => liveSet.has(k)),
      ...newKeys,
    ]);
  }, [columns]);

  const sensors = useSensors(useSensor(PointerSensor));

  const term = query.trim().toLowerCase();
  const inSearch = (c: ManageColumn) =>
    !term || c.label.toLowerCase().includes(term);

  const builtinCols = columns.filter((c) => !c.isCustom && inSearch(c));
  const customCols = columns.filter((c) => c.isCustom && inSearch(c));

  const isShown = (key: string) => !hiddenKeys.includes(key);

  function show(key: string) {
    setHiddenKeys((prev) => prev.filter((k) => k !== key));
    setVisibleOrder((prev) => (prev.includes(key) ? prev : [...prev, key]));
  }

  function hide(key: string) {
    if (metaByKey[key]?.required) return;
    setVisibleOrder((prev) => prev.filter((k) => k !== key));
    setHiddenKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    // Keep the freeze boundary within the shrunken list.
    setFrozen((f) => Math.min(f, visibleOrder.length - 1));
  }

  function toggle(key: string) {
    if (isShown(key)) hide(key);
    else show(key);
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setVisibleOrder((prev) => {
      const from = prev.indexOf(active.id as string);
      const to = prev.indexOf(over.id as string);
      if (from === -1 || to === -1) return prev;
      return arrayMove(prev, from, to);
    });
  }

  function handleApply() {
    onSave([...visibleOrder, ...hiddenKeys], hiddenKeys, Math.min(frozen, visibleOrder.length));
    onOpenChange(false);
  }

  // ---- Custom field CRUD (immediate) -------------------------------------
  const customLabels = useMemo(
    () => new Set(customCols.map((c) => c.label.toLowerCase())),
    [customCols]
  );

  async function createField() {
    const name = newName.trim();
    if (!name) return;
    if (!accountId || !user) {
      toast.error('Your profile is not linked to an account.');
      return;
    }
    if (customLabels.has(name.toLowerCase())) {
      toast.error(`A field named "${name}" already exists.`);
      return;
    }
    setCreating(true);
    const { error } = await supabase.from('custom_fields').insert({
      field_name: name,
      field_type: newType,
      user_id: user.id,
      account_id: accountId,
    });
    setCreating(false);
    if (error) {
      toast.error('Could not create field. You may not have permission.');
      return;
    }
    setNewName('');
    setNewType('text');
    onFieldsChanged();
  }

  async function saveEditField(name: string, type: string) {
    if (!editField) return;
    const nm = name.trim();
    if (!nm) {
      toast.error('Field name is required.');
      return;
    }
    if (
      customCols.some(
        (c) =>
          c.key.slice(3) !== editField.id &&
          c.label.toLowerCase() === nm.toLowerCase()
      )
    ) {
      toast.error(`A field named "${nm}" already exists.`);
      return;
    }
    setSavingEdit(true);
    const { error } = await supabase
      .from('custom_fields')
      .update({ field_name: nm, field_type: type })
      .eq('id', editField.id);
    setSavingEdit(false);
    if (error) {
      toast.error('Could not save field.');
      return;
    }
    setEditField(null);
    onFieldsChanged();
  }

  async function deleteField(fieldId: string, label: string) {
    if (
      !window.confirm(
        `Delete "${label}"? This also removes its stored value on every lead. This cannot be undone.`
      )
    ) {
      return;
    }
    setBusyId(fieldId);
    const { error } = await supabase
      .from('custom_fields')
      .delete()
      .eq('id', fieldId);
    setBusyId(null);
    if (error) {
      toast.error('Could not delete field.');
      return;
    }
    toast.success(`Deleted "${label}".`);
    onFieldsChanged();
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Responsive: 96vh tall; full width minus 96px side margins, capped
          at 960px (override the base sm:max-w-sm at the same breakpoint). */}
      <DialogContent className="flex max-h-[96vh] w-[calc(100vw-192px)] max-w-[960px] flex-col gap-0 p-0 sm:max-w-[960px]">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>Edit columns</DialogTitle>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
          {/* Left — catalogue + custom fields */}
          <div className="flex min-h-0 flex-col border-b border-border md:border-b-0 md:border-r">
            <div className="p-4 pb-2">
              <SearchInput
                value={query}
                onValueChange={setQuery}
                placeholder="Search columns…"
                aria-label="Search columns"
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              <GroupLabel>Lead fields</GroupLabel>
              {builtinCols.length === 0 ? (
                <Empty>No matching fields.</Empty>
              ) : (
                <ul className="mb-4">
                  {builtinCols.map((c) => (
                    <CatalogueRow
                      key={c.key}
                      label={c.label}
                      required={c.required}
                      checked={isShown(c.key)}
                      onToggle={() => toggle(c.key)}
                    />
                  ))}
                </ul>
              )}

              <GroupLabel>Custom fields</GroupLabel>
              {customCols.length === 0 ? (
                <Empty>{term ? 'No matching fields.' : 'No custom fields yet.'}</Empty>
              ) : (
                <ul>
                  {customCols.map((c) => (
                    <CustomCatalogueRow
                      key={c.key}
                      column={c}
                      checked={isShown(c.key)}
                      onToggle={() => toggle(c.key)}
                      canManage={canManageFields}
                      busy={busyId === c.key.slice(3)}
                      onEdit={() =>
                        setEditField({
                          id: c.key.slice(3),
                          name: c.label,
                          type: c.fieldType ?? 'text',
                        })
                      }
                      onDelete={() => deleteField(c.key.slice(3), c.label)}
                    />
                  ))}
                </ul>
              )}

              {canManageFields && !term && (
                <div className="mt-3 flex items-center gap-2">
                  {/* Split field: name on the left, data type on the right. */}
                  <div className="flex h-8 min-w-0 flex-1 items-center rounded-lg border border-border bg-card focus-within:border-primary">
                    <input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void createField();
                        }
                      }}
                      placeholder="New field name…"
                      aria-label="New field name"
                      className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                    />
                    <span className="h-4 w-px shrink-0 bg-border" aria-hidden />
                    {/* Data type — drives future type-aware formatting. */}
                    <Select
                      value={newType}
                      onValueChange={(v) => setNewType(v ?? 'text')}
                    >
                      <SelectTrigger
                        size="sm"
                        aria-label="Field data type"
                        className="h-full shrink-0 rounded-l-none border-0 bg-transparent text-muted-foreground shadow-none hover:bg-transparent focus-visible:ring-0 dark:bg-transparent dark:hover:bg-transparent"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CUSTOM_FIELD_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    size="sm"
                    onClick={createField}
                    disabled={creating || !newName.trim()}
                    className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {creating ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Plus className="size-4" />
                    )}
                    Create field
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Right — selected columns + freeze */}
          <div className="flex min-h-0 flex-col">
            <div className="flex items-center justify-between gap-3 p-4 pb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Selected columns ({visibleOrder.length})
              </span>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Frozen columns
                <Select
                  value={String(frozen)}
                  onValueChange={(v) => setFrozen(Number(v))}
                >
                  <SelectTrigger size="sm" className="min-w-[3.5rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: visibleOrder.length + 1 }, (_, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {i}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={visibleOrder}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="flex flex-col gap-1.5">
                    {visibleOrder.map((key, i) => (
                      <div key={key}>
                        <SelectedRow
                          column={metaByKey[key]}
                          onRemove={() => hide(key)}
                        />
                        {frozen > 0 &&
                          frozen < visibleOrder.length &&
                          i === frozen - 1 && <FrozenDivider />}
                      </div>
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            </div>
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 rounded-none border-t border-border px-5 py-3">
          {onResetWidths && (
            <button
              type="button"
              onClick={onResetWidths}
              className="mr-auto cursor-pointer rounded text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Reset column widths
            </button>
          )}
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Edit custom field — nested over the columns dialog. */}
    {editField && (
      <CustomFieldEditDialog
        key={editField.id}
        field={editField}
        saving={savingEdit}
        onCancel={() => setEditField(null)}
        onSave={saveEditField}
      />
    )}
    </>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-xs text-muted-foreground">{children}</p>;
}

// Left-pane row for a built-in column: checkbox + label.
function CatalogueRow({
  label,
  required,
  checked,
  onToggle,
}: {
  label: string;
  required?: boolean;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <label
        className={cn(
          'flex items-center gap-2.5 rounded-md px-1 py-1.5 text-sm',
          required ? 'cursor-default' : 'cursor-pointer hover:bg-muted/60'
        )}
      >
        <Checkbox
          checked={checked}
          disabled={required}
          onCheckedChange={onToggle}
          aria-label={`Toggle ${label} column`}
        />
        <span className="text-foreground">
          {label}
          {required && <span className="text-muted-foreground"> (required)</span>}
        </span>
      </label>
    </li>
  );
}

// Left-pane row for a custom field: checkbox + label + edit (pencil) +
// delete. Non-admins get a plain checkbox row (no field management).
function CustomCatalogueRow({
  column,
  checked,
  onToggle,
  canManage,
  busy,
  onEdit,
  onDelete,
}: {
  column: ManageColumn;
  checked: boolean;
  onToggle: () => void;
  canManage: boolean;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  if (!canManage) {
    return (
      <CatalogueRow label={column.label} checked={checked} onToggle={onToggle} />
    );
  }

  return (
    <li className="group flex items-center gap-2.5 rounded-md px-1 py-1 hover:bg-muted/60">
      <Checkbox
        checked={checked}
        onCheckedChange={onToggle}
        aria-label={`Toggle ${column.label} column`}
      />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {column.label}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={busy}
        onClick={onEdit}
        title="Edit field"
        className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Pencil className="size-4" />
      </Button>
      <Button
        variant="destructive-ghost"
        size="icon-sm"
        disabled={busy}
        onClick={onDelete}
        title="Delete field"
        className={cn(
          'shrink-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100',
          // Stay visible while the delete is in flight.
          busy ? 'opacity-100' : 'opacity-0'
        )}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Trash2 className="size-4" />
        )}
      </Button>
    </li>
  );
}

// Nested dialog for editing a custom field's label + data type.
function CustomFieldEditDialog({
  field,
  saving,
  onCancel,
  onSave,
}: {
  field: { id: string; name: string; type: string };
  saving: boolean;
  onCancel: () => void;
  onSave: (name: string, type: string) => void;
}) {
  const [name, setName] = useState(field.name);
  const [type, setType] = useState(field.type);

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit field</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-field-name" className="text-muted-foreground">
              Field name
            </Label>
            <Input
              id="edit-field-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onSave(name, type);
                }
              }}
              placeholder="Field name…"
              className="bg-card"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground">Data type</Label>
            <Select value={type} onValueChange={(v) => setType(v ?? 'text')}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CUSTOM_FIELD_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onCancel}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            Cancel
          </Button>
          <Button
            onClick={() => onSave(name, type)}
            disabled={saving || !name.trim()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Right-pane draggable card for a selected column.
function SelectedRow({
  column,
  onRemove,
}: {
  column?: ManageColumn;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: column?.key ?? '' });

  if (!column) return null;
  const required = column.required;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-sm',
        isDragging && 'shadow-sm'
      )}
    >
      <button
        type="button"
        className="shrink-0 cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <span className="min-w-0 flex-1 truncate text-foreground">{column.label}</span>
      {!required && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${column.label} column`}
          className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </li>
  );
}

function FrozenDivider() {
  return (
    <div className="my-1.5 flex items-center gap-2" aria-hidden>
      <span className="h-px flex-1 bg-border" />
      <span className="text-[11px] text-muted-foreground">
        Above column(s) are frozen
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
