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
  EMPTY_FINANCE_PAYMENT_FILTERS,
  type FinancePaymentFilterState,
} from '@/lib/finance/payments';
import type {
  MembershipPlan,
  PaymentMethod,
  PaymentSource,
  PaymentStatus,
} from '@/types';

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank', label: 'Bank' },
  { value: 'other', label: 'Other' },
];

const PAYMENT_STATUSES: { value: PaymentStatus; label: string }[] = [
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Voided' },
];

const PAYMENT_SOURCES: { value: PaymentSource; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'auto', label: 'Auto-pay' },
];

export function FinancePaymentFilters({
  value,
  onChange,
  plans,
  staff,
  range,
}: {
  value: FinancePaymentFilterState;
  onChange: (next: FinancePaymentFilterState) => void;
  plans: Pick<MembershipPlan, 'id' | 'name'>[];
  staff: { value: string; label: string }[];
  range: { start: string; end: string };
}) {
  const count =
    value.methods.length +
    value.statuses.length +
    value.sources.length +
    value.planIds.length +
    value.recordedBy.length +
    Number(Boolean(value.paidFrom)) +
    Number(Boolean(value.paidTo));

  function toggle<K extends keyof FinancePaymentFilterState>(
    key: K,
    choice: FinancePaymentFilterState[K][number]
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
              onClick={() => onChange(EMPTY_FINANCE_PAYMENT_FILTERS)}
              className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
            >
              Clear all
            </button>
          ) : null}
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-3 py-3">
          <FilterGroup
            label="Method"
            options={PAYMENT_METHODS}
            selected={value.methods}
            onToggle={(choice) => toggle('methods', choice as PaymentMethod)}
          />
          <Separator className="my-3" />
          <FilterGroup
            label="Status"
            options={PAYMENT_STATUSES}
            selected={value.statuses}
            onToggle={(choice) => toggle('statuses', choice as PaymentStatus)}
          />
          <Separator className="my-3" />
          <FilterGroup
            label="Source"
            options={PAYMENT_SOURCES}
            selected={value.sources}
            onToggle={(choice) => toggle('sources', choice as PaymentSource)}
          />
          <Separator className="my-3" />
          <FilterGroup
            label="Plan"
            options={plans.map((plan) => ({
              value: plan.id,
              label: plan.name,
            }))}
            selected={value.planIds}
            onToggle={(choice) => toggle('planIds', choice)}
            emptyHint="No plans yet."
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
              <Label size="sm" htmlFor="finance-payment-from">
                Paid from
              </Label>
              <DatePicker
                id="finance-payment-from"
                value={value.paidFrom}
                onChange={(paidFrom) => onChange({ ...value, paidFrom })}
                min={range.start}
                max={value.paidTo || range.end}
              />
            </div>
            <div className="grid gap-1.5">
              <Label size="sm" htmlFor="finance-payment-to">
                Paid to
              </Label>
              <DatePicker
                id="finance-payment-to"
                value={value.paidTo}
                onChange={(paidTo) => onChange({ ...value, paidTo })}
                min={value.paidFrom || range.start}
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
