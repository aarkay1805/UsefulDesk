'use client';

// BulkEditDialog — HubSpot-style "update one property across the selected
// records" flow. Two dependent steps in one dialog: pick a property, then
// set its new value with an editor matched to that property's type. The
// value editor stays hidden until a property is chosen, and Update stays
// disabled until both are set. The dialog owns only the form state; the
// actual write is delegated to `onApply` (the page holds the selection +
// Supabase client).
//
// Both pickers reuse the SAME dropdown surface as the Leads table's inline
// cell editors (DropdownMenu + Badge), so the bulk value editor for a
// property looks and behaves exactly like editing that property in a row —
// status renders as coloured pills, source/assignee carry their glyphs.

import { useState } from 'react';
import { Check, ChevronDown, Loader2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PhoneInput } from '@/components/ui/phone-input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface BulkSelectOption {
  value: string;
  label: string;
  /** Pill colour for `variant: 'pill'` options (lead status). */
  color?: string;
  /** Leading glyph for `variant: 'plain'` options (source logo, avatar). */
  icon?: React.ReactNode;
}

export type BulkEditEditor =
  | {
      kind: 'select';
      /** 'pill' → coloured Badge pills (status); 'plain' → icon + label. */
      variant: 'pill' | 'plain';
      options: BulkSelectOption[];
    }
  | { kind: 'text' | 'number' | 'date' | 'email' | 'phone' };

export interface BulkEditProperty {
  /** Stable id — a contacts column ('status'/'assignee'/…) or `cf:<id>`. */
  key: string;
  label: string;
  /** Which section of the property picker this sits under. */
  group: 'Lead fields' | 'Custom fields';
  editor: BulkEditEditor;
}

// Picker sections render in this order; empty ones are skipped.
const GROUP_ORDER: BulkEditProperty['group'][] = [
  'Lead fields',
  'Custom fields',
];

// Select-style trigger shared by both dropdowns — mirrors the Select
// primitive's trigger (border + chevron) so the two pickers are visually
// identical, at a comfortable dialog-field height.
const TRIGGER_CLASS =
  'flex h-9 w-full items-center justify-between gap-1.5 rounded-lg border border-input-border bg-transparent px-3 text-sm whitespace-nowrap outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:border-ring disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';

function inputType(kind: 'text' | 'number' | 'date' | 'email'): string {
  return kind === 'number'
    ? 'number'
    : kind === 'date'
      ? 'date'
      : kind === 'email'
        ? 'email'
        : 'text';
}

// One option's inline content — a coloured pill (status) or an icon +
// label (source/gender/assignee), matching the table's cell editor.
function optionContent(o: BulkSelectOption, variant: 'pill' | 'plain') {
  if (variant === 'pill') {
    return <Badge color={o.color ?? '#64748b'}>{o.label}</Badge>;
  }
  return (
    <span className="flex min-w-0 items-center gap-2 text-sm">
      {o.icon}
      <span className="truncate">{o.label}</span>
    </span>
  );
}

// The value editor for the chosen property. Split out so the editor union
// narrows cleanly inside the option-map closures (TS drops narrowing on a
// nested property access like `property.editor` once it's read in a
// callback; a local const preserves it).
function ValueEditor({
  property,
  value,
  onChange,
}: {
  property: BulkEditProperty;
  value: string | null;
  onChange: (value: string) => void;
}) {
  const editor = property.editor;

  if (editor.kind === 'phone') {
    return (
      <PhoneInput
        value={value ?? ''}
        onValueChange={onChange}
        placeholder={`Enter ${property.label.toLowerCase()}`}
        className="border-border"
      />
    );
  }

  if (editor.kind !== 'select') {
    return (
      <Input
        type={inputType(editor.kind)}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Enter ${property.label.toLowerCase()}`}
        className="border-border"
      />
    );
  }

  const selected = editor.options.find((o) => o.value === value) ?? null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<button type="button" className={TRIGGER_CLASS} />}
      >
        {selected ? (
          optionContent(selected, editor.variant)
        ) : (
          <span className="text-muted-foreground truncate">
            Select {property.label.toLowerCase()}
          </span>
        )}
        <ChevronDown className="text-muted-foreground size-4 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="bg-popover border-border">
        {editor.options.map((o) => (
          <DropdownMenuItem
            key={o.value}
            onClick={() => onChange(o.value)}
            className="text-popover-foreground focus:bg-muted focus:text-foreground justify-between gap-3"
          >
            {optionContent(o, editor.variant)}
            {o.value === value && (
              <Check className="text-primary-text size-3.5 shrink-0" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function BulkEditDialog({
  open,
  onOpenChange,
  count,
  properties,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** How many records the edit will touch (for the title). */
  count: number;
  properties: BulkEditProperty[];
  /** Persist the edit. Return true on success (dialog closes), false to
      keep the dialog open (the failing write already toasted). */
  onApply: (property: BulkEditProperty, value: string) => Promise<boolean>;
}) {
  // `null` = nothing chosen yet, so the trigger shows its placeholder.
  const [propKey, setPropKey] = useState<string | null>(null);
  const [value, setValue] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset the form each time the dialog opens — a fresh edit every time.
  // Done during render (not in an effect) via the "adjust state on prop
  // change" pattern, so it never triggers the cascading-render lint rule.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setPropKey(null);
      setValue(null);
      setSaving(false);
    }
  }

  const property = properties.find((p) => p.key === propKey) ?? null;

  const groups = GROUP_ORDER.map((label) => ({
    label,
    items: properties.filter((p) => p.group === label),
  })).filter((g) => g.items.length > 0);

  // Update needs a property AND a value: a picked option for selects, a
  // non-blank entry for free-text editors.
  const canSubmit =
    !!property &&
    value !== null &&
    (property.editor.kind === 'select' ? value !== '' : value.trim() !== '');

  async function handleUpdate() {
    if (!property || !canSubmit || value === null) return;
    setSaving(true);
    const ok = await onApply(property, value);
    setSaving(false);
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            Bulk edit {count} {count === 1 ? 'record' : 'records'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Step 1 — pick the property to update. */}
          <div className="space-y-2">
            <Label className="text-popover-foreground">Property to update</Label>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<button type="button" className={TRIGGER_CLASS} />}
              >
                <span className={cn('truncate', !property && 'text-muted-foreground')}>
                  {property ? property.label : 'Select a property to edit'}
                </span>
                <ChevronDown className="text-muted-foreground size-4 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="bg-popover border-border"
              >
                {groups.map((g, gi) => (
                  <DropdownMenuGroup key={g.label}>
                    {gi > 0 && <DropdownMenuSeparator className="bg-border" />}
                    <DropdownMenuLabel>{g.label}</DropdownMenuLabel>
                    {g.items.map((p) => (
                      <DropdownMenuItem
                        key={p.key}
                        onClick={() => {
                          setPropKey(p.key);
                          setValue(null);
                        }}
                        className="text-popover-foreground focus:bg-muted focus:text-foreground justify-between"
                      >
                        {p.label}
                        {p.key === propKey && (
                          <Check className="text-primary-text size-3.5" />
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Step 2 — set the new value (editor matched to the property). */}
          {property && (
            <div className="space-y-2">
              <Label className="text-popover-foreground">{property.label}</Label>
              <ValueEditor
                property={property}
                value={value}
                onChange={setValue}
              />
            </div>
          )}
        </div>

        <DialogFooter className="bg-popover border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            Cancel
          </Button>
          <Button onClick={handleUpdate} disabled={!canSubmit || saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
