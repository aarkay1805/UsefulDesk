'use client';

import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

export type SortDir = 'asc' | 'desc';
export interface SortState {
  key: string;
  dir: SortDir;
}

interface LeadsSortProps {
  value: SortState | null;
  onChange: (next: SortState | null) => void;
  /** Sortable columns, in display order. */
  columns: { key: string; label: string }[];
}

// Explicit sort picker — the same `prefs.sort` the column-header menus
// drive, surfaced as a toolbar control (HubSpot-style "Sort" button).
export function LeadsSort({ value, onChange, columns }: LeadsSortProps) {
  function pick(key: string) {
    // New column defaults to ascending; re-picking the active column
    // flips direction.
    if (value?.key === key) {
      onChange({ key, dir: value.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      onChange({ key, dir: 'asc' });
    }
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            className="text-muted-foreground hover:bg-muted"
          />
        }
      >
        <ArrowUpDown className="size-4" />
        Sort
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <span className="text-sm font-semibold text-popover-foreground">
            Sort by
          </span>
          {value && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="cursor-pointer text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Clear
            </button>
          )}
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-1">
          {columns.map((c) => {
            const isActive = value?.key === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => pick(c.key)}
                className={cn(
                  'flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
                  isActive ? 'text-foreground' : 'text-popover-foreground'
                )}
              >
                <span className="truncate">{c.label}</span>
                {isActive &&
                  (value.dir === 'asc' ? (
                    <ArrowUp className="size-3.5 shrink-0 text-primary" />
                  ) : (
                    <ArrowDown className="size-3.5 shrink-0 text-primary" />
                  ))}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
