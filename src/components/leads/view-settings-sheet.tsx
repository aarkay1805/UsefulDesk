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

type CellTextMode = 'wrap' | 'clip';

const SORT_WITHIN_OPTIONS: { value: BoardSortWithin; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'updated', label: 'Recently updated' },
];

interface ViewSettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which view's settings to show — the gear opens this same sheet from
      both the table and the board. */
  view: 'table' | 'board';

  // Table display
  pageSize: number;
  pageSizeOptions: readonly number[];
  onPageSizeChange: (n: number) => void;
  cellText: CellTextMode;
  onCellTextChange: (mode: CellTextMode) => void;

  // Board display (Tier 1 + 2)
  density: BoardDensity;
  onDensityChange: (mode: BoardDensity) => void;
  sortWithin: BoardSortWithin;
  onSortWithinChange: (mode: BoardSortWithin) => void;
  collapseEmpty: boolean;
  onCollapseEmptyChange: (value: boolean) => void;
}

// The gear settings side sheet — display prefs for whichever view is
// active. Mirrors the profile detail side-sheet interaction (right
// slide-over). Column management + custom fields live in the separate
// "Edit columns" split-view dialog (table only).
export function ViewSettingsSheet({
  open,
  onOpenChange,
  view,
  pageSize,
  pageSizeOptions,
  onPageSizeChange,
  cellText,
  onCellTextChange,
  density,
  onDensityChange,
  sortWithin,
  onSortWithinChange,
  collapseEmpty,
  onCollapseEmptyChange,
}: ViewSettingsSheetProps) {
  const isBoard = view === 'board';
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 border-border bg-popover p-0 text-popover-foreground sm:max-w-md"
      >
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="text-base text-foreground">
            {isBoard ? 'Board settings' : 'Table settings'}
          </SheetTitle>
          <SheetDescription className="text-muted-foreground">
            {isBoard
              ? 'Configure how the leads board looks and behaves.'
              : 'Configure how the leads table looks and behaves.'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {isBoard ? (
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
            </Section>
          ) : (
            <Section title="Display">
              <SettingRow label="Records per page">
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => onPageSizeChange(Number(v))}
                >
                  <SelectTrigger size="sm" className="min-w-[4.25rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {pageSizeOptions.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>

              <SettingRow
                label="Cell text"
                description="How text that overflows a cell is shown."
              >
                <Segmented
                  options={[
                    { value: 'clip', label: 'Clip' },
                    { value: 'wrap', label: 'Wrap' },
                  ]}
                  value={cellText}
                  onChange={(v) => onCellTextChange(v as CellTextMode)}
                />
              </SettingRow>
            </Section>
          )}
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
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {description && (
          <p className="text-xs leading-relaxed text-muted-foreground">
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
        <p className="text-sm text-foreground">{label}</p>
        {description && (
          <p className="text-xs leading-relaxed text-muted-foreground">
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
      className="inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
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
              'cursor-pointer rounded-md px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
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
