'use client';

import { Filter } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import {
  activeFollowUpFilterCount,
  EMPTY_FOLLOW_UP_FILTERS,
  exclusiveFollowUpBucket,
  FOLLOW_UP_BUCKET_OPTIONS,
  UNASSIGNED_FOLLOW_UP,
  type FollowUpFilters as FollowUpFilterState,
} from '@/lib/memberships/follow-up-filters';
import { REASON_LABEL } from '@/lib/memberships/follow-ups';
import type { FollowUpReason } from '@/types';
import type { StaffMember } from './use-account-staff';

const REASON_OPTIONS = (Object.keys(REASON_LABEL) as FollowUpReason[]).map(
  (value) => ({ value, label: REASON_LABEL[value] })
);

interface FollowUpFiltersProps {
  value: FollowUpFilterState;
  onChange: (next: FollowUpFilterState) => void;
  staff: StaffMember[];
}

/** Context-only filters for the Follow-ups table. */
export function FollowUpFilters({
  value,
  onChange,
  staff,
}: FollowUpFiltersProps) {
  const count = activeFollowUpFilterCount(value);
  const reduceMotion = useReducedMotion();

  function toggle<K extends keyof FollowUpFilterState>(key: K, choice: string) {
    const current = value[key] as string[];
    const next = current.includes(choice)
      ? current.filter((item) => item !== choice)
      : [...current, choice];
    onChange({ ...value, [key]: next });
  }

  function toggleBucket(choice: string) {
    const bucket = choice as FollowUpFilterState['buckets'][number];
    onChange({
      ...value,
      buckets: exclusiveFollowUpBucket(bucket, !value.buckets.includes(bucket)),
    });
  }

  const assigneeOptions = [
    { value: UNASSIGNED_FOLLOW_UP, label: 'Unassigned' },
    ...staff.map((member) => ({
      value: member.user_id,
      label: member.full_name,
    })),
  ];

  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" className="relative gap-0" />}
      >
        <Filter className="mr-1.5 size-4" />
        Filters
        <AnimatePresence initial={false} mode="popLayout">
          {count > 0 && (
            <motion.span
              key="follow-up-filter-count"
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{
                duration: reduceMotion ? 0 : 0.2,
                ease: [0.2, 0, 0, 1],
              }}
              className="inline-flex origin-left"
            >
              <span className="bg-primary text-primary-foreground ml-0.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold">
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
              onClick={() => onChange(EMPTY_FOLLOW_UP_FILTERS)}
              className="text-muted-foreground hover:text-foreground cursor-pointer text-xs underline-offset-4 hover:underline"
            >
              Clear all
            </button>
          )}
        </div>

        <div className="max-h-[65vh] overflow-y-auto px-3 py-3">
          <CheckGroup
            label="Due date"
            options={FOLLOW_UP_BUCKET_OPTIONS}
            selected={value.buckets}
            onToggle={toggleBucket}
          />

          <Separator className="my-3" />
          <CheckGroup
            label="Reason"
            options={REASON_OPTIONS}
            selected={value.reasons}
            onToggle={(choice) => toggle('reasons', choice)}
          />

          <Separator className="my-3" />
          <CheckGroup
            label="Assigned to"
            options={assigneeOptions}
            selected={value.assignees}
            onToggle={(choice) => toggle('assignees', choice)}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CheckGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div>
      <p className="text-muted-foreground mb-1.5 text-[11px] font-semibold tracking-wider uppercase">
        {label}
      </p>
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
    </div>
  );
}
