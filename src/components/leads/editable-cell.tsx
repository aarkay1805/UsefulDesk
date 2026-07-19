"use client";

import { useEffect, useRef } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { InlineEditActions } from "@/components/ui/inline-edit-actions";
import { cn } from "@/lib/utils";

// Read and edit states share ONE box model so switching between them
// never changes a cell's height (and so the row can't resize on click):
//   OUTER — the fixed 36px cell slot (matches a p-2 non-editable cell).
//   INNER — the 28px content/field box; the hover ring and the focus
//           ring both draw on this identical box as inset shadows.
// OUTER stays 36px (h-9) so the row never resizes; py-0.5 leaves the
// INNER box room to grow to 32px (h-8), which sits ~4px off the tag top
// and bottom for an optically balanced outline.
const OUTER = "flex h-9 w-full items-center px-2 py-0.5";
const INNER =
  "flex h-8 min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap rounded-md px-2.5 outline-none";

// HubSpot-style inline cell editing for the Leads table. A cell shows
// its normal rendered value until clicked; clicking swaps in an inline
// editor: a text/email input, or — for status — a dropdown whose
// options render as coloured status tags (matching the read display).
// Commit is EXPLICIT — Enter or the floating ✓ button (dropdown: select).
// Escape, the floating ✕ button, or clicking/tabbing away dismisses
// without a write, so a stray outside-click can't save a half-typed
// value. A no-op edit (value unchanged) cancels without a write.
//
// Text/email editors are uncontrolled — the input seeds from `value`
// via defaultValue and is read through a ref on commit. That keeps us
// clear of the repo's react-hooks/set-state-in-effect rule (no draft
// state to sync in an effect) while re-seeding correctly, since the
// input mounts fresh each time `editing` flips true.
//
// The click-to-edit button stops propagation so it never triggers the
// row's "open detail" handler. Non-editable columns (name link, tags,
// created) don't use this component — they fall through to the row click.

export interface CellOption {
  value: string;
  label: string;
  /** Tag colour for `kind: 'status'` options. */
  color?: string;
  /** Leading glyph for `kind: 'select'` options (e.g. a source logo). */
  icon?: React.ReactNode;
}

function StatusPill({ label, color }: { label: string; color: string }) {
  return <Badge color={color}>{label}</Badge>;
}

interface EditableCellProps {
  editing: boolean;
  /** True while the parent's async write is in flight. */
  saving: boolean;
  /**
   * 'status'/'select' pick one option from a dropdown (status renders
   * coloured pills, select plain labels). 'tags' is a stay-open
   * checklist — each toggle fires onToggleOption immediately.
   */
  kind: "text" | "email" | "number" | "date" | "status" | "select" | "tags";
  /** Current committed value (seed + baseline for the no-op check). */
  value: string;
  /** Options for the dropdown kinds ('status' | 'select' | 'tags'). */
  options?: CellOption[];
  /** Selected option values for `kind: 'tags'`. */
  multiValue?: string[];
  /**
   * Toggle handler for `kind: 'tags'` — the parent writes the change
   * and updates its state; the checklist stays open across toggles.
   */
  onToggleOption?: (value: string) => void;
  /**
   * Static adornment shown inside the editor before the input — e.g.
   * the account currency symbol for currency-type custom columns.
   */
  prefix?: string;
  /** The normal, read-mode rendering of the cell. */
  display: React.ReactNode;
  onStart: () => void;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

export function EditableCell({
  editing,
  saving,
  kind,
  value,
  options,
  multiValue,
  onToggleOption,
  prefix,
  display,
  onStart,
  onCommit,
  onCancel,
}: EditableCellProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards double-settle: Enter fires settle, then the ensuing blur
  // would fire it again. Escape / outside-click set it too so the
  // dismiss path stays inert once a value is chosen.
  const settledRef = useRef(false);
  // Dropdown-style editors (they manage their own focus).
  const isMenuKind = kind === "status" || kind === "select" || kind === "tags";

  useEffect(() => {
    if (!editing) return;
    settledRef.current = false;
    // Focus the text editor after it mounts (the dropdown editors manage
    // their own focus). Ref-only work — no state writes, so this stays
    // clear of set-state-in-effect.
    if (kind === "status" || kind === "select" || kind === "tags") return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [editing, kind]);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onStart();
        }}
        // Named group (`group/cell`) so the hover outline keys off THIS
        // cell only — the table row is itself a generic `group`, and an
        // unnamed group-hover here would light up every editable cell
        // whenever the row is hovered.
        className={cn(OUTER, "group/cell text-left")}
      >
        {/* Same box as the editors (INNER): flex + items-center centres
            the content by its box, not its text baseline (a short pill
            would otherwise sit high in the inherited 20px line box). The
            hover outline is an inset ring — a box-shadow, so it adds zero
            layout height and can't resize the row. */}
        <span
          className={cn(
            INNER,
            "group-hover/cell:bg-muted/70 group-hover/cell:ring-1 group-hover/cell:ring-inset group-hover/cell:ring-border",
          )}
        >
          {display}
          {/* Cells that open a menu advertise it: chevron fades in on
              cell hover, mirroring the open-state trigger's chevron. */}
          {isMenuKind && (
            <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/cell:opacity-100" />
          )}
        </span>
      </button>
    );
  }

  function settle(next: string) {
    if (settledRef.current) return;
    settledRef.current = true;
    if (next === value) {
      onCancel();
      return;
    }
    onCommit(next);
  }

  function cancel() {
    if (settledRef.current) return;
    settledRef.current = true;
    onCancel();
  }

  // The active-state outline: an inset ring (box-shadow) so it matches
  // the hover ring's dimensions exactly and never changes the box height.
  const EDIT_INNER = cn(INNER, "ring-2 ring-inset ring-primary bg-card");

  if (kind === "status" || kind === "select") {
    const current = options?.find((o) => o.value === value);
    // Status options render as coloured pills (matching the read
    // display); plain selects (source, gender) as text labels.
    const optionLabel = (o: CellOption) =>
      kind === "status" ? (
        <StatusPill label={o.label} color={o.color ?? "#64748b"} />
      ) : (
        <span className="flex items-center gap-2 text-sm">
          {o.icon}
          {o.label}
        </span>
      );
    return (
      <div className={OUTER} onClick={(e) => e.stopPropagation()}>
        <DropdownMenu
          open
          onOpenChange={(open) => {
            // Outside-click / Escape closes without a pick.
            if (!open) cancel();
          }}
        >
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                disabled={saving}
                className={cn(EDIT_INNER, "justify-between disabled:opacity-60")}
              />
            }
          >
            {current ? (
              optionLabel(current)
            ) : (
              <span className="text-sm text-muted-foreground">Select…</span>
            )}
            {saving ? (
              <Loader2 className="size-4 animate-spin text-primary-text" />
            ) : (
              <ChevronDown className="size-4 text-muted-foreground" />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="min-w-44 bg-popover border-border"
          >
            {options?.map((o) => (
              <DropdownMenuItem
                key={o.value}
                onClick={() => settle(o.value)}
                className="flex items-center justify-between gap-3 text-popover-foreground focus:bg-muted"
              >
                {optionLabel(o)}
                {o.value === value && <Check className="size-3.5 text-primary-text" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  if (kind === "tags") {
    return (
      <div className={OUTER} onClick={(e) => e.stopPropagation()}>
        <DropdownMenu
          open
          onOpenChange={(open) => {
            // The checklist stays open across toggles (each one writes
            // immediately); closing it just ends the edit session.
            if (!open) cancel();
          }}
        >
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                disabled={saving}
                className={cn(EDIT_INNER, "justify-between disabled:opacity-60")}
              />
            }
          >
            <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              {display}
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="min-w-44 bg-popover border-border"
          >
            {options && options.length > 0 ? (
              options.map((o) => (
                <DropdownMenuCheckboxItem
                  key={o.value}
                  checked={multiValue?.includes(o.value) ?? false}
                  closeOnClick={false}
                  onCheckedChange={() => onToggleOption?.(o.value)}
                  className="text-popover-foreground focus:bg-muted"
                >
                  {o.label}
                </DropdownMenuCheckboxItem>
              ))
            ) : (
              <div className="px-1.5 py-1 text-sm text-muted-foreground">
                No tags yet
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  // Shared by both editor layouts (bare input / prefix-adorned) so the
  // behaviours can't drift.
  const inputProps = {
    ref: inputRef,
    type:
      kind === "email"
        ? "email"
        : kind === "number"
          ? "number"
          : kind === "date"
            ? "date"
            : "text",
    defaultValue: value,
    disabled: saving,
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        settle(inputRef.current?.value ?? "");
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    },
  };

  return (
    <div
      className={cn(OUTER, "relative")}
      // Keep clicks inside the editor from bubbling to the row.
      onClick={(e) => e.stopPropagation()}
      // Focus escaping the editor entirely (outside click / Tab away)
      // dismisses the edit — the accidental-save guard. settledRef makes
      // this inert after an explicit commit/cancel.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          cancel();
        }
      }}
    >
      {prefix ? (
        // The ring/bg move to a wrapper so the adornment sits inside the
        // focus outline; box dimensions match the bare input exactly.
        <div className="flex h-8 w-full min-w-0 items-center rounded-md bg-card ring-2 ring-inset ring-primary">
          <span className="pointer-events-none shrink-0 pl-2.5 text-sm text-muted-foreground">
            {prefix}
          </span>
          <input
            {...inputProps}
            className="h-full w-full min-w-0 rounded-md bg-transparent pl-1.5 pr-13 text-sm text-foreground outline-none disabled:opacity-60"
          />
        </div>
      ) : (
        <input
          {...inputProps}
          // Same box dimensions as INNER (h-7, px-1.5, rounded, inset
          // ring) but without flex — display:flex on an <input> can break
          // caret/text rendering. Height/padding still match exactly, so
          // no row shift. pr-13 clears the floating buttons.
          className="h-8 w-full rounded-md bg-card pl-2.5 pr-13 text-sm text-foreground outline-none ring-2 ring-inset ring-primary disabled:opacity-60"
        />
      )}
      <InlineEditActions
        saving={saving}
        onConfirm={() => settle(inputRef.current?.value ?? "")}
        onDismiss={cancel}
      />
    </div>
  );
}
