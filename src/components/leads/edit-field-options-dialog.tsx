'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from 'lucide-react';
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

  function update(index: number, patch: Partial<DraftOption>) {
    setDraft((prev) =>
      prev.map((o, i) => (i === index ? { ...o, ...patch } : o))
    );
  }

  function move(index: number, delta: -1 | 1) {
    setDraft((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
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
              />
            )}
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={i === 0}
                onClick={() => move(i, -1)}
                aria-label="Move up"
                className="text-muted-foreground hover:text-foreground"
              >
                <ArrowUp className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={i === draft.length - 1}
                onClick={() => move(i, 1)}
                aria-label="Move down"
                className="text-muted-foreground hover:text-foreground"
              >
                <ArrowDown className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => remove(i)}
                aria-label={`Remove ${option.label}`}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
        ))}

        <div className="flex items-center gap-2 pt-1">
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addOption();
              }
            }}
            placeholder="Add an option…"
            className="bg-muted border-border text-foreground h-8 flex-1 placeholder:text-muted-foreground"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={addOption}
            disabled={!newLabel.trim()}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            <Plus className="size-4" />
            Add
          </Button>
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
