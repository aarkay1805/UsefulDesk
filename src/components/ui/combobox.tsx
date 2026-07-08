"use client";

import * as React from "react";
import { Check, ChevronDown, Plus, Search } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Master searchable-select: a Select-styled trigger opening a Popover
// with a type-ahead filter over grouped options, and an optional pinned
// footer action (e.g. "+ Create new field…"). Built for lists too long
// to scan (the import wizard's field picker); use `ui/select` for short
// static lists. Single source of truth — restyle call-sites via
// className/props, never by forking.

export interface ComboboxOption {
  value: string;
  label: string;
  /** Leading glyph (brand icon, avatar…). */
  icon?: React.ReactNode;
  /** Muted right-aligned hint (e.g. a field's data type). */
  hint?: string;
}

export interface ComboboxGroup {
  /** Omit for an ungrouped block (no heading). */
  label?: string;
  options: ComboboxOption[];
}

interface ComboboxProps {
  groups: ComboboxGroup[];
  /** Currently selected option value (null/unknown → placeholder). */
  value: string | null;
  onSelect: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Pinned action under the list — always visible, unaffected by filter. */
  footer?: { label: React.ReactNode; onSelect: () => void } | null;
  disabled?: boolean;
  /** Trigger content override; defaults to the selected option's label. */
  children?: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

export function Combobox({
  groups,
  value,
  onSelect,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches.",
  footer,
  disabled,
  children,
  className,
  contentClassName,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const selected = React.useMemo(() => {
    for (const g of groups) {
      const hit = g.options.find((o) => o.value === value);
      if (hit) return hit;
    }
    return null;
  }, [groups, value]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        options: g.options.filter((o) =>
          o.label.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.options.length > 0);
  }, [groups, query]);

  const visibleCount = filtered.reduce((n, g) => n + g.options.length, 0);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) setQuery("");
  }

  function pick(v: string) {
    setOpen(false);
    onSelect(v);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <button
            type="button"
            className={cn(
              // Mirrors SelectTrigger (size=sm) so the two read identically.
              "flex h-8 w-full min-w-0 items-center justify-between gap-1.5 rounded-lg border border-input-border bg-transparent py-1.5 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50",
              className,
            )}
          />
        }
      >
        <span
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 truncate text-left",
            !children && !selected && "text-muted-foreground",
          )}
        >
          {children ??
            (selected ? (
              <>
                {selected.icon}
                <span className="truncate">{selected.label}</span>
              </>
            ) : (
              placeholder
            ))}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className={cn("w-64 gap-0 p-0", contentClassName)}
      >
        <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Enter with exactly one visible option picks it.
              if (e.key === "Enter" && visibleCount === 1) {
                e.preventDefault();
                const only = filtered[0]?.options[0];
                if (only) pick(only.value);
              }
            }}
            placeholder={searchPlaceholder}
            className="h-5 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="max-h-64 overflow-y-auto p-1">
          {visibleCount === 0 && (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {emptyText}
            </p>
          )}
          {filtered.map((group, gi) => (
            <div key={group.label ?? gi}>
              {group.label && (
                <p className="px-2 pt-2 pb-1 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  {group.label}
                </p>
              )}
              {group.options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => pick(o.value)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-popover-foreground outline-none hover:bg-muted focus-visible:bg-muted"
                >
                  {o.icon}
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.hint && (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {o.hint}
                    </span>
                  )}
                  {o.value === value && (
                    <Check className="size-3.5 shrink-0 text-primary" />
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>

        {footer && (
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              footer.onSelect();
            }}
            className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm font-medium text-primary-text outline-none hover:bg-muted focus-visible:bg-muted"
          >
            <Plus className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{footer.label}</span>
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
