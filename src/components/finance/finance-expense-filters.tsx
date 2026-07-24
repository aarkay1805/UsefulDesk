'use client';

import { Filter } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import {
  EMPTY_FINANCE_EXPENSE_FILTERS,
  type FinanceExpenseFilterState,
} from '@/lib/finance/expenses';
import type { ExpenseCategory, ExpenseStatus, PaymentMethod } from '@/types';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank', label: 'Bank' },
  { value: 'other', label: 'Other' },
];

const STATUSES: { value: ExpenseStatus; label: string }[] = [
  { value: 'posted', label: 'Posted' },
  { value: 'void', label: 'Voided' },
];

export function FinanceExpenseFilters({
  value,
  onChange,
  categories,
  staff,
  range,
}: {
  value: FinanceExpenseFilterState;
  onChange: (next: FinanceExpenseFilterState) => void;
  categories: ExpenseCategory[];
  staff: { value: string; label: string }[];
  range: { start: string; end: string };
}) {
  const count =
    value.categoryIds.length +
    value.methods.length +
    value.statuses.length +
    value.recordedBy.length +
    Number(Boolean(value.occurredFrom)) +
    Number(Boolean(value.occurredTo));

  function toggle<K extends keyof FinanceExpenseFilterState>(
    key: K,
    choice: FinanceExpenseFilterState[K][number]
  ) {
    const current = value[key] as string[];
    const next = current.includes(choice)
      ? current.filter((item) => item !== choice)
      : [...current, choice];
    onChange({ ...value, [key]: next });
  }

  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="pill" aria-pressed={count > 0} />}
      >
        <Filter />
        Filters
        {count > 0 ? (
          <Badge variant="neutral" size="count">
            {count}
          </Badge>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        <div className="border-border flex items-center justify-between border-b px-3 py-2.5">
          <span className="text-popover-foreground text-sm font-semibold">
            Filters
          </span>
          {count > 0 ? (
            <button
              type="button"
              onClick={() => onChange(EMPTY_FINANCE_EXPENSE_FILTERS)}
              className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
            >
              Clear all
            </button>
          ) : null}
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-3 py-3">
          <FilterGroup
            label="Category"
            options={categories.map((category) => ({
              value: category.id,
              label: category.name,
            }))}
            selected={value.categoryIds}
            onToggle={(choice) => toggle('categoryIds', choice)}
            emptyHint="No active categories."
          />
          <Separator className="my-3" />
          <FilterGroup
            label="Payment method"
            options={METHODS}
            selected={value.methods}
            onToggle={(choice) => toggle('methods', choice as PaymentMethod)}
          />
          <Separator className="my-3" />
          <FilterGroup
            label="Status"
            options={STATUSES}
            selected={value.statuses}
            onToggle={(choice) => toggle('statuses', choice as ExpenseStatus)}
          />
          <Separator className="my-3" />
          <FilterGroup
            label="Recorded by"
            options={staff}
            selected={value.recordedBy}
            onToggle={(choice) => toggle('recordedBy', choice)}
            emptyHint="No teammates yet."
          />
          <Separator className="my-3" />
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label size="sm" htmlFor="finance-expense-from">
                Date from
              </Label>
              <DatePicker
                id="finance-expense-from"
                value={value.occurredFrom}
                onChange={(occurredFrom) =>
                  onChange({ ...value, occurredFrom })
                }
                min={range.start}
                max={value.occurredTo || range.end}
              />
            </div>
            <div className="grid gap-1.5">
              <Label size="sm" htmlFor="finance-expense-to">
                Date to
              </Label>
              <DatePicker
                id="finance-expense-to"
                value={value.occurredTo}
                onChange={(occurredTo) => onChange({ ...value, occurredTo })}
                min={value.occurredFrom || range.start}
                max={range.end}
              />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FilterGroup({
  label,
  options,
  selected,
  onToggle,
  emptyHint,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: readonly string[];
  onToggle: (value: string) => void;
  emptyHint?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label size="sm">{label}</Label>
      {options.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          {emptyHint ?? 'No options.'}
        </p>
      ) : (
        <div className="max-h-40 space-y-0.5 overflow-y-auto">
          {options.map((option) => (
            <label
              key={option.value}
              className="hover:bg-muted/60 flex items-center gap-2.5 rounded-md px-1 py-1"
            >
              <Checkbox
                checked={selected.includes(option.value)}
                onCheckedChange={() => onToggle(option.value)}
              />
              <span className="text-popover-foreground truncate text-sm">
                {option.label}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
