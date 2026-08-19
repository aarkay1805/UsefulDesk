'use client';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type {
  BoardDensity,
  BoardSortWithin,
} from '@/components/leads/leads-board';

const SORT_WITHIN_OPTIONS: { value: BoardSortWithin; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'updated', label: 'Recently updated' },
];

interface BoardSettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  density: BoardDensity;
  onDensityChange: (mode: BoardDensity) => void;
  sortWithin: BoardSortWithin;
  onSortWithinChange: (mode: BoardSortWithin) => void;
  collapseEmpty: boolean;
  onCollapseEmptyChange: (value: boolean) => void;
  /** Cap on how many leads the board renders — surfaced as a footnote
      here instead of an always-on banner over the board. */
  boardLimit: number;
}

// Board display preferences opened from the board view's gear. Table view's
// gear opens the column manager directly; its page-size control lives in the
// table footer.
export function BoardSettingsSheet({
  open,
  onOpenChange,
  density,
  onDensityChange,
  sortWithin,
  onSortWithinChange,
  collapseEmpty,
  onCollapseEmptyChange,
  boardLimit,
}: BoardSettingsSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="border-border bg-popover text-popover-foreground w-full gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="border-border border-b px-5 py-4">
          <SheetTitle className="text-foreground text-base">
            Board settings
          </SheetTitle>
          <SheetDescription className="text-muted-foreground">
            Configure how the leads board looks and behaves.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <Section title="Display">
            <SettingRow
              label="Card density"
              description="How much detail each card shows."
            >
              <Segmented
                options={[
                  { value: 'comfortable', label: 'Comfortable' },
                  { value: 'compact', label: 'Compact' },
                ]}
                value={density}
                onChange={(v) => onDensityChange(v as BoardDensity)}
              />
            </SettingRow>

            <SettingRow
              label="Sort cards"
              description="Order of cards within each status column."
            >
              <Select
                value={sortWithin}
                onValueChange={(v) => onSortWithinChange(v as BoardSortWithin)}
              >
                <SelectTrigger size="sm" className="min-w-[10rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_WITHIN_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>

            <SettingRow
              label="Collapse empty columns"
              description="Hide statuses with no leads. They reappear while you drag so you can still drop into an empty stage."
            >
              <Switch
                checked={collapseEmpty}
                onCheckedChange={onCollapseEmptyChange}
              />
            </SettingRow>

            <p className="border-border bg-muted/40 text-muted-foreground rounded-lg border px-3 py-2 text-xs leading-relaxed">
              The board shows the {boardLimit} most recent leads. Switch to the
              table view to page through all of them.
            </p>
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
          {title}
        </h3>
        {description && (
          <p className="text-muted-foreground text-xs leading-relaxed">
            {description}
          </p>
        )}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

// A label (+ optional description) on the left, a control on the right.
function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-0.5 pt-0.5">
        <p className="text-foreground text-sm">{label}</p>
        {description && (
          <p className="text-muted-foreground text-xs leading-relaxed">
            {description}
          </p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// Compact segmented toggle for a small set of options (best for 2–3).
// A raised active pill on a muted track — the standard segmented look.
function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      className="bg-muted inline-flex items-center gap-0.5 rounded-lg p-0.5"
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'focus-visible:ring-ring/50 cursor-pointer rounded-md px-3 py-1 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
