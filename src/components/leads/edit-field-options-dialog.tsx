'use client';

import { useState } from 'react';
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
import { GripVertical, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  slugifyOptionKey,
  type LeadFieldKind,
  type LeadFieldOption,
} from '@/lib/leads/field-options';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const FIELD_TITLES: Record<LeadFieldKind, string> = {
  status: 'status',
  source: 'source',
  gender: 'gender',
};

/** The contacts column each field's keys are stored in. */
const FIELD_COLUMN: Record<LeadFieldKind, 'lead_status' | 'source' | 'gender'> =
  {
    status: 'lead_status',
    source: 'source',
    gender: 'gender',
  };

/**
 * Swatches offered for status pills (same family as the defaults).
 * Blue (#3b82f6) is intentionally omitted — it's permanently reserved
 * for the built-in "New lead" stage, so it must not be pickable here.
 */
const STATUS_COLORS = [
  '#eab308', // yellow
  '#f97316', // orange
  '#22c55e', // green
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#64748b', // slate
];

interface EditFieldOptionsDialogProps {
  /** Which list to edit; null = closed. */
  kind: LeadFieldKind | null;
  /** Current effective list (account rows or defaults) — the seed. */
  current: LeadFieldOption[];
  onOpenChange: (open: boolean) => void;
  /** Fired after a successful save (refetch the lists). */
  onSaved: () => void;
}

/**
 * "Edit options" — the per-account option list editor behind the
 * option-backed lead columns (status / source / gender), opened from a
 * column header's overflow menu. Saving replaces the account's rows for
 * that field (the first save materialises the built-in defaults).
 *
 * Deleting an option that leads still use is blocked at save time —
 * otherwise those cards would fall out of the board's columns.
 */
export function EditFieldOptionsDialog({
  kind,
  current,
  onOpenChange,
  onSaved,
}: EditFieldOptionsDialogProps) {
  return (
    <Dialog open={kind !== null} onOpenChange={onOpenChange}>
      {kind !== null && (
        // Keyed by kind so the draft re-seeds whenever a different
        // column's editor opens (state init instead of effect-sync).
        <OptionsEditor
          key={kind}
          kind={kind}
          current={current}
          onClose={() => onOpenChange(false)}
          onSaved={onSaved}
        />
      )}
    </Dialog>
  );
}

interface DraftOption extends LeadFieldOption {
  /** True for rows added in this session (key not yet in the DB). */
  isNew?: boolean;
}

function OptionsEditor({
  kind,
  current,
  onClose,
  onSaved,
}: {
  kind: LeadFieldKind;
  current: LeadFieldOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { accountId } = useAuth();
  const [draft, setDraft] = useState<DraftOption[]>(() =>
    current.map((o) => ({ ...o }))
  );
  const [newLabel, setNewLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const isStatus = kind === 'status';
  // The controls that reveal only once the user starts typing a new option.
  const typing = newLabel.trim().length > 0;

  // Drag-to-reorder — same interaction as the "Edit columns" dialog.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  function update(index: number, patch: Partial<DraftOption>) {
    setDraft((prev) =>
      prev.map((o, i) => (i === index ? { ...o, ...patch } : o))
    );
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setDraft((prev) => {
      const from = prev.findIndex((o) => o.key === active.id);
      const to = prev.findIndex((o) => o.key === over.id);
      if (from === -1 || to === -1) return prev;
      return arrayMove(prev, from, to);
    });
  }

  function remove(index: number) {
    setDraft((prev) => prev.filter((_, i) => i !== index));
  }

  function addOption() {
    const label = newLabel.trim();
    if (!label) return;
    setDraft((prev) => [
      ...prev,
      {
        key: slugifyOptionKey(
          label,
          prev.map((o) => o.key)
        ),
        label,
        // Auto-assign a default swatch (cycles so consecutive adds differ);
        // the user recolours from the row's swatches afterwards.
        color: isStatus ? STATUS_COLORS[prev.length % STATUS_COLORS.length] : null,
        isNew: true,
      },
    ]);
    setNewLabel('');
  }

  async function save() {
    if (!accountId) return;
    if (draft.length === 0) {
      toast.error('Keep at least one option');
      return;
    }
    if (draft.some((o) => !o.label.trim())) {
      toast.error('Every option needs a label');
      return;
    }
    setSaving(true);
    const supabase = createClient();
    try {
      // Deleting an option that's still in use would orphan those
      // leads (they'd drop off the board) — block it.
      const removedKeys = current
        .map((o) => o.key)
        .filter((k) => !draft.some((d) => d.key === k));
      for (const key of removedKeys) {
        const { count } = await supabase
          .from('contacts')
          .select('id', { count: 'exact', head: true })
          .eq(FIELD_COLUMN[kind], key);
        if ((count ?? 0) > 0) {
          const label =
            current.find((o) => o.key === key)?.label ?? key;
          toast.error(
            `Can't remove "${label}" — ${count} lead${count === 1 ? '' : 's'} still use it`
          );
          setSaving(false);
          return;
        }
      }

      // Replace the account's list for this field wholesale — simple,
      // idempotent, and the row count is tiny.
      const { error: delError } = await supabase
        .from('lead_field_options')
        .delete()
        .eq('account_id', accountId)
        .eq('field', kind);
      if (delError) throw delError;

      const { error: insError } = await supabase
        .from('lead_field_options')
        .insert(
          draft.map((o, i) => ({
            account_id: accountId,
            field: kind,
            key: o.key,
            label: o.label.trim(),
            color: isStatus ? o.color ?? STATUS_COLORS[0] : null,
            sort_order: i,
          }))
        );
      if (insError) throw insError;

      toast.success('Options saved');
      onSaved();
      onClose();
    } catch {
      toast.error('Failed to save options');
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogContent className="bg-card border-border sm:max-w-lg">
      <DialogHeader>
        <DialogTitle className="text-foreground capitalize">
          Edit {FIELD_TITLES[kind]} options
        </DialogTitle>
        <DialogDescription className="text-muted-foreground">
          {isStatus
            ? 'These are your pipeline stages — they define the board columns. Leads keep their stage when you rename it.'
            : 'The choices offered in this column’s dropdown, the add-lead form and the filters.'}
        </DialogDescription>
      </DialogHeader>

      {/* -mx-1 px-1: overflow-y-auto clips overflow-x too, so pad the
          scroll box (and pull it back out) to stop focus/selection rings
          from being shaved at the left edge. */}
      <div className="max-h-[50vh] -mx-1 space-y-2 overflow-y-auto px-1 py-1">
<<<<<<< HEAD
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={draft.map((o) => o.key)}
            strategy={verticalListSortingStrategy}
          >
            {draft.map((option, i) => (
              <OptionRow
                key={option.key}
                option={option}
                index={i}
                isStatus={isStatus}
                onLabel={(label) => update(i, { label })}
                onColor={(color) => update(i, { color })}
                onRemove={() => remove(i)}
=======
        {draft.map((option, i) => (
          <div key={option.key} className="flex items-center gap-2">
            {isStatus && (
              // Live preview — the option rendered as the actual pill so
              // "what you pick is what you see". Uses the same Badge
              // `color` path (tinted recipe) the leads table/board use,
              // so the colour + derived-text here match production.
              <Badge
                color={option.color ?? STATUS_COLORS[0]}
                className="w-24 shrink-0 justify-start"
                aria-hidden
              >
                <span className="truncate">{option.label || 'Preview'}</span>
              </Badge>
            )}
            <Input
              value={option.label}
              onChange={(e) => update(i, { label: e.target.value })}
              className="bg-muted border-border text-foreground h-8 flex-1"
              aria-label={`Option ${i + 1} label`}
            />
            {isStatus && (
              <ColorSwatchPicker
                value={option.color ?? STATUS_COLORS[0]}
                onChange={(color) => update(i, { color })}
>>>>>>> 37ca9bc1d68ba2b9385f44d551fe5d81b26dd62f
              />
            ))}
          </SortableContext>
        </DndContext>

        {/* Divider between the list and the add row (mirrors the mock). */}
        <div className="border-border/60 border-t border-dashed pt-2" />

        <div className="flex items-center gap-2">
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addOption();
              } else if (e.key === 'Escape' && typing) {
                e.preventDefault();
                setNewLabel('');
              }
            }}
            placeholder="Add an option…"
            className="bg-muted border-border text-foreground h-7 flex-1 rounded-full px-3.5 placeholder:text-muted-foreground"
          />
          {/* Cancel + Add reveal only once the user types, sliding in.
              Colour is chosen afterwards from the created row's swatches. */}
          {typing && (
            <div className="animate-in fade-in slide-in-from-right-2 flex items-center gap-2 duration-200 ease-out">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setNewLabel('')}
                className="border-border text-muted-foreground hover:bg-muted"
              >
                Cancel
              </Button>
              <Button size="sm" onClick={addOption}>
                Add
              </Button>
            </div>
          )}
        </div>
      </div>

      <DialogFooter className="border-border">
        <Button
          variant="outline"
          onClick={onClose}
          disabled={saving}
          className="border-border text-muted-foreground hover:bg-muted"
        >
          Cancel
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          Save options
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/**
 * One draggable option row: grip handle · a tinted pill input that previews
 * the chosen colour live · colour swatches (status only) · delete.
 */
function OptionRow({
  option,
  index,
  isStatus,
  onLabel,
  onColor,
  onRemove,
}: {
  option: DraftOption;
  index: number;
  isStatus: boolean;
  onLabel: (label: string) => void;
  onColor: (color: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: option.key });

  const color = option.color ?? STATUS_COLORS[0];

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2',
        isDragging && 'relative z-10 opacity-90'
      )}
    >
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground shrink-0 cursor-grab touch-none active:cursor-grabbing"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>

      <Input
        value={option.label}
        onChange={(e) => onLabel(e.target.value)}
        aria-label={`Option ${index + 1} label`}
        className={cn(
          'h-7 flex-1 rounded-full border-transparent px-3.5 font-medium',
          isStatus
            ? // `tinted-text` derives a mode-aware readable colour from
              // --badge-tint; the inline background is the 10% fill (inline
              // beats Input's dark:bg-input/30 so the tint always shows).
              'tinted-text'
            : 'bg-muted text-foreground'
        )}
        style={
          isStatus
            ? ({
                '--badge-tint': color,
                backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
              } as React.CSSProperties)
            : undefined
        }
      />

      {isStatus && (
        <ColorSwatchPicker value={color} onChange={onColor} />
      )}

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onRemove}
        aria-label={`Remove ${option.label}`}
        className="text-muted-foreground hover:text-destructive shrink-0"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

function ColorSwatchPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Pill colour">
      {STATUS_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={`Colour ${c}`}
          onClick={() => onChange(c)}
          className={cn(
            // Hairline boundary so light swatches (yellow) are perceivable
            // against the card — a solid dot alone is ~1.8:1 on white.
            'size-4 cursor-pointer rounded-full border border-black/15 transition-transform hover:scale-110 dark:border-white/20',
            value === c && 'ring-2 ring-ring ring-offset-1 ring-offset-card'
          )}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}
