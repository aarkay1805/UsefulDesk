'use client';

import { Filter } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import {
  EMPTY_FINANCE_INVOICE_FILTERS,
  type FinanceInvoiceFilterState,
} from '@/lib/finance/invoices';
import type { MembershipCollectionMode, MembershipPlan } from '@/types';
import type { InvoicePaymentState } from '@/lib/memberships/periods';

const PAYMENT_STATES: {
  value: InvoicePaymentState;
  label: string;
}[] = [
  { value: 'paid', label: 'Paid' },
  { value: 'due', label: 'Due' },
  { value: 'no_charge', label: 'No charge' },
];

const COLLECTION_MODES: {
  value: MembershipCollectionMode;
  label: string;
}[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'auto', label: 'Auto-pay' },
];

export function FinanceInvoiceFilters({
  value,
  onChange,
  plans,
}: {
  value: FinanceInvoiceFilterState;
  onChange: (next: FinanceInvoiceFilterState) => void;
  plans: Pick<MembershipPlan, 'id' | 'name'>[];
}) {
  const count =
    value.paymentStates.length +
    value.planIds.length +
    value.collectionModes.length;

  function toggle<K extends keyof FinanceInvoiceFilterState>(
    key: K,
    choice: FinanceInvoiceFilterState[K][number]
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
              onClick={() => onChange(EMPTY_FINANCE_INVOICE_FILTERS)}
              className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
            >
              Clear all
            </button>
          ) : null}
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-3 py-3">
          <FilterGroup
            label="Payment status"
            options={PAYMENT_STATES}
            selected={value.paymentStates}
            onToggle={(choice) =>
              toggle('paymentStates', choice as InvoicePaymentState)
            }
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
            emptyHint="No plans in this month."
          />
          <Separator className="my-3" />
          <FilterGroup
            label="Collection mode"
            options={COLLECTION_MODES}
            selected={value.collectionModes}
            onToggle={(choice) =>
              toggle('collectionModes', choice as MembershipCollectionMode)
            }
          />
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
