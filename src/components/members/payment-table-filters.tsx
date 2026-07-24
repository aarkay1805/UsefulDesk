'use client';

import { Filter } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { DUE_BUCKETS, type DueBucket } from '@/lib/memberships/dues';
import type { MembershipPlan } from '@/types';

export interface PaymentDueFilterState {
  buckets: DueBucket[];
  plans: string[];
}

export const EMPTY_PAYMENT_DUE_FILTERS: PaymentDueFilterState = {
  buckets: [],
  plans: [],
};

export function PaymentDueFilters({
  value,
  onChange,
  plans,
}: {
  value: PaymentDueFilterState;
  onChange: (next: PaymentDueFilterState) => void;
  plans: Pick<MembershipPlan, 'id' | 'name'>[];
}) {
  const count = value.buckets.length + value.plans.length;

  function toggleBucket(choice: string) {
    const bucket = choice as DueBucket;
    onChange({
      ...value,
      buckets: value.buckets.includes(bucket) ? [] : [bucket],
    });
  }

  function togglePlan(planId: string) {
    onChange({
      ...value,
      plans: value.plans.includes(planId)
        ? value.plans.filter((id) => id !== planId)
        : [...value.plans, planId],
    });
  }

  return (
    <FilterPopover
      count={count}
      onClear={() => onChange(EMPTY_PAYMENT_DUE_FILTERS)}
    >
      <CheckGroup
        label="Due status"
        options={DUE_BUCKETS.map(({ key, label }) => ({ value: key, label }))}
        selected={value.buckets}
        onToggle={toggleBucket}
      />
      <Separator className="my-3" />
      <CheckGroup
        label="Plan"
        options={plans.map((plan) => ({ value: plan.id, label: plan.name }))}
        selected={value.plans}
        onToggle={togglePlan}
        emptyHint="No plans yet."
      />
    </FilterPopover>
  );
}

function FilterPopover({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="pill" aria-pressed={count > 0} />}
      >
        <Filter className="size-4" />
        Filters
        <AnimatePresence initial={false} mode="popLayout">
          {count > 0 && (
            <motion.span
              key="payment-filter-count"
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{
                duration: reduceMotion ? 0 : 0.2,
                ease: [0.2, 0, 0, 1],
              }}
              className="inline-flex origin-left"
            >
              <span className="bg-primary text-primary-foreground inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold">
                {count}
              </span>
            </motion.span>
          )}
        </AnimatePresence>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        <div className="border-border flex items-center justify-between border-b px-3 py-2.5">
          <span className="text-popover-foreground text-sm font-semibold">
            Filters
          </span>
          {count > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="text-muted-foreground hover:text-foreground cursor-pointer text-xs underline-offset-4 hover:underline"
            >
              Clear all
            </button>
          )}
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-3 py-3">{children}</div>
      </PopoverContent>
    </Popover>
  );
}

function CheckGroup({
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
    <div>
      <p className="text-muted-foreground mb-1.5 text-[11px] font-semibold tracking-wider uppercase">
        {label}
      </p>
      {options.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          {emptyHint ?? 'No options.'}
        </p>
      ) : (
        <div className="max-h-40 space-y-0.5 overflow-y-auto">
          {options.map((option) => (
            <label
              key={option.value}
              className="hover:bg-muted/60 flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1"
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
