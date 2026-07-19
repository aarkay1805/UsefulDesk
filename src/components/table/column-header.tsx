"use client";

// Shared column-header for data grids (the leads table + the all-members
// table). Owns the per-column header UI: a label (optionally a drag
// handle), a single double-sided sort toggle, and a three-dot overflow
// menu carrying Sort ascending/descending, an Excel-style value Filter
// submenu, and column actions (freeze / add / hide). It is the single
// source of truth for that surface — restyle via props, never fork it.
//
// Generalized from the leads header: freeze / add-column / edit-options /
// drag / the greyed "smart property" placeholder are all OPTIONAL, so a
// lighter table (members) mounts just Sort + Filter + Hide, while the
// leads table passes the full set. The resize grip and any drag transform
// live on the OWNING <th>, not here.

import type React from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronsUpDown,
  EyeOff,
  Filter,
  ListChecks,
  MoreVertical,
  Pin,
  Plus,
  Sparkles,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type SortDir = "asc" | "desc";

// Per-column Excel-style value filter — a checkbox list of the column's
// possible values that show/hide rows. `selected` mirrors the owning
// table's filter state so the header filter and any global Filters panel
// never drift.
export interface ColumnFilterProp {
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}

export interface ColumnHeaderProps {
  label: string;
  /** When false the sort toggle + menu sort items are hidden/disabled. */
  sortable: boolean;
  /** Active direction for THIS column, or null when it isn't the sort. */
  sortDir: SortDir | null;
  onSort: (dir: SortDir) => void;
  /** Enumerable columns only — omit for free-text columns. */
  filter?: ColumnFilterProp;
  /** Hide-column action; omit to drop the menu item entirely. */
  onHide?: () => void;
  /** Disables the Hide item (e.g. a required column). */
  hideDisabled?: boolean;
  // ── Optional extras (leads table) ────────────────────────────────
  /** Whether the column is currently frozen (pinned left). */
  frozen?: boolean;
  onToggleFreeze?: () => void;
  onAddColumn?: () => void;
  /** Option-backed columns: edit the column's choices (admins). */
  onEditOptions?: () => void;
  /** Greyed HubSpot-style "Set up smart property" placeholder row. */
  smartPropertyPlaceholder?: boolean;
  /** Sortable drag listeners/attributes — spread on the label (the grab
   *  surface). Absent when column drag is disabled (e.g. members). */
  dragHandleProps?: React.HTMLAttributes<HTMLSpanElement>;
}

export function ColumnHeader({
  label,
  sortable,
  sortDir,
  onSort,
  filter,
  onHide,
  hideDisabled,
  frozen,
  onToggleFreeze,
  onAddColumn,
  onEditOptions,
  smartPropertyPlaceholder,
  dragHandleProps,
}: ColumnHeaderProps) {
  // Whether the menu carries a column-management group below the sort/
  // filter items (needs a divider above it).
  const hasManageGroup = Boolean(onToggleFreeze || onAddColumn || onHide);

  return (
    <div className="group/th flex items-center gap-0.5 pr-2">
      {/* The label doubles as the column's drag handle (Sheets-style):
          grab the header text to reorder. touch-none keeps it from
          scrolling the table on touch drags. */}
      <span
        {...dragHandleProps}
        className={cn(
          "min-w-0 flex-1 truncate",
          dragHandleProps && "cursor-grab touch-none active:cursor-grabbing"
        )}
      >
        {label}
      </span>

      {/* Single double-sided sort toggle — one button cycles asc → desc.
          Inactive shows the up/down chevron (hover-revealed to save header
          space); once active it shows the actual direction, lit + always
          visible so the current sort stays legible. */}
      {sortable && (
        <div
          className={cn(
            "flex items-center overflow-hidden transition-all",
            sortDir
              ? "max-w-8 opacity-100"
              : "max-w-0 opacity-0 group-hover/th:max-w-8 group-hover/th:opacity-100"
          )}
        >
          <button
            type="button"
            aria-label={`Sort ${label} ${
              sortDir === "asc" ? "descending" : "ascending"
            }`}
            onClick={() => onSort(sortDir === "asc" ? "desc" : "asc")}
            className={cn(
              "hover:bg-muted flex size-5 items-center justify-center rounded",
              sortDir ? "text-primary-text" : "text-muted-foreground"
            )}
          >
            {sortDir === "asc" ? (
              <ArrowUp className="size-3.5" />
            ) : sortDir === "desc" ? (
              <ArrowDown className="size-3.5" />
            ) : (
              <ChevronsUpDown className="size-3.5" />
            )}
          </button>
        </div>
      )}

      {/* Overflow menu */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={`${label} column options`}
              className="text-muted-foreground hover:bg-muted data-[popup-open]:bg-muted flex size-5 max-w-0 items-center justify-center overflow-hidden rounded opacity-0 transition-all group-hover/th:max-w-5 group-hover/th:opacity-100 data-[popup-open]:max-w-5 data-[popup-open]:opacity-100"
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
            onClick={() => onSort("asc")}
            className="text-popover-foreground focus:bg-muted focus:text-foreground"
          >
            <ArrowUp className="size-4" />
            Sort ascending
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!sortable}
            onClick={() => onSort("desc")}
            className="text-popover-foreground focus:bg-muted focus:text-foreground"
          >
            <ArrowDown className="size-4" />
            Sort descending
          </DropdownMenuItem>
          {/* Excel-style value filter — a checkbox list of the column's
              possible values. Toggling writes straight into the owning
              table's filter state, so it stays in sync with the Filters
              panel. */}
          {filter && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="text-popover-foreground focus:bg-muted focus:text-foreground">
                <Filter className="size-4" />
                Filter
                {filter.selected.length > 0 && (
                  <span className="bg-primary text-primary-foreground ml-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold">
                    {filter.selected.length}
                  </span>
                )}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="bg-popover border-border max-h-72 min-w-52 overflow-y-auto">
                {filter.options.length === 0 ? (
                  <div className="text-muted-foreground px-2 py-1.5 text-xs">
                    No values
                  </div>
                ) : (
                  filter.options.map((o) => {
                    const checked = filter.selected.includes(o.value);
                    return (
                      // Plain item (not CheckboxItem) so we render an
                      // always-visible left checkbox — the multi-select
                      // affordance — and keep the menu open on click.
                      <DropdownMenuItem
                        key={o.value}
                        closeOnClick={false}
                        onClick={() => filter.onToggle(o.value)}
                        className="text-popover-foreground focus:bg-muted focus:text-foreground gap-2"
                      >
                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
                            checked
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input-border bg-card"
                          )}
                        >
                          {checked && <Check className="size-3.5" />}
                        </span>
                        <span className="truncate">{o.label}</span>
                      </DropdownMenuItem>
                    );
                  })
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {/* Placeholder — no backing feature yet, matches HubSpot's greyed row */}
          {smartPropertyPlaceholder && (
            <DropdownMenuItem
              disabled
              className="text-popover-foreground focus:bg-muted focus:text-foreground"
            >
              <Sparkles className="size-4" />
              Set up smart property
            </DropdownMenuItem>
          )}
          {onEditOptions && (
            <DropdownMenuItem
              onClick={onEditOptions}
              className="text-popover-foreground focus:bg-muted focus:text-foreground"
            >
              <ListChecks className="size-4" />
              Edit options
            </DropdownMenuItem>
          )}
          {hasManageGroup && <DropdownMenuSeparator className="bg-border" />}
          {onToggleFreeze && (
            <DropdownMenuItem
              onClick={onToggleFreeze}
              className="text-popover-foreground focus:bg-muted focus:text-foreground"
            >
              <Pin className="size-4" />
              {frozen ? "Unfreeze column" : "Freeze column"}
            </DropdownMenuItem>
          )}
          {onAddColumn && (
            <DropdownMenuItem
              onClick={onAddColumn}
              className="text-popover-foreground focus:bg-muted focus:text-foreground"
            >
              <Plus className="size-4" />
              Add column
            </DropdownMenuItem>
          )}
          {onHide && (
            <DropdownMenuItem
              disabled={hideDisabled}
              onClick={onHide}
              className="text-popover-foreground focus:bg-muted focus:text-foreground"
            >
              <EyeOff className="size-4" />
              Hide column
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
