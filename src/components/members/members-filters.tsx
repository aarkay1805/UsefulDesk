'use client';

import { Filter } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  activeMemberFilterCount,
  CHURN_RISK_OPTIONS,
  EMPTY_MEMBER_FILTERS,
  EXPIRY_OPTIONS,
  MEMBER_STATUS_OPTIONS,
  USUAL_TIME_PERIODS,
  type MemberFilters,
} from '@/lib/memberships/filters';
import type { MembershipPlan } from '@/types';

const FEE_STATUS_OPTIONS: { value: 'paid' | 'due'; label: string }[] = [
  { value: 'paid', label: 'Paid' },
  { value: 'due', label: 'Fee due' },
];

const FOLLOW_UP_OPTIONS: { value: 'open'; label: string }[] = [
  { value: 'open', label: 'Open follow-up' },
];

interface MembersFiltersProps {
  value: MemberFilters;
  onChange: (next: MemberFilters) => void;
  /** Plan options — useMembershipPlans (include archived so old members filter). */
  plans: MembershipPlan[];
  assignedOptions: { value: string; label: string }[];
  trainerOptions: { value: string; label: string }[];
  usualTimeOptions: { value: string; label: string }[];
  today: string;
}

/**
 * The All-members Filters popover — the members-lightweight sibling of
 * the leads Filters panel (same trigger/badge/check-group recipe, member
 * facets only: plan, derived status, operational ownership, fee status,
 * follow-ups, and churn risk).
 */
export function MembersFilters({
  value,
  onChange,
  plans,
  assignedOptions,
  trainerOptions,
  usualTimeOptions,
  today,
}: MembersFiltersProps) {
  const count = activeMemberFilterCount(value);
  const reduceMotion = useReducedMotion();

  function toggle<K extends keyof MemberFilters>(key: K, v: string) {
    const cur = value[key] as string[];
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    onChange({ ...value, [key]: next });
  }

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
              key="member-filter-count"
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{
                duration: reduceMotion ? 0 : 0.2,
                ease: [0.2, 0, 0, 1],
              }}
              className="inline-flex origin-left"
            >
              <Badge size="count">{count}</Badge>
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
            <Button
              variant="link"
              size="xs"
              onClick={() => onChange(EMPTY_MEMBER_FILTERS)}
            >
              Clear all
            </Button>
          )}
        </div>

        <div className="max-h-[65vh] overflow-y-auto px-3 py-3">
          <CheckGroup
            label="Status"
            options={MEMBER_STATUS_OPTIONS}
            selected={value.statuses}
            onToggle={(v) => toggle('statuses', v)}
          />

          <Separator className="my-3" />
          <CheckGroup
            label="Expiry"
            options={EXPIRY_OPTIONS}
            selected={value.expiry}
            onToggle={(v) => {
              const next = value.expiry.includes(
                v as MemberFilters['expiry'][number]
              )
                ? value.expiry.filter((item) => item !== v)
                : [...value.expiry, v as MemberFilters['expiry'][number]];
              onChange({
                ...value,
                expiry: next,
                expiryFrom:
                  v === 'custom' && next.includes('custom') && !value.expiryFrom
                    ? today
                    : value.expiryFrom,
                expiryTo:
                  v === 'custom' && next.includes('custom') && !value.expiryTo
                    ? today
                    : value.expiryTo,
              });
            }}
          />
          {value.expiry.includes('custom') && (
            <div className="mt-2 space-y-2">
              <div>
                <Label htmlFor="member-expiry-from" size="sm">
                  From
                </Label>
                <DatePicker
                  id="member-expiry-from"
                  value={value.expiryFrom}
                  max={value.expiryTo || undefined}
                  onChange={(expiryFrom) =>
                    onChange({
                      ...value,
                      expiryFrom: expiryFrom || value.expiryFrom,
                    })
                  }
                />
              </div>
              <div>
                <Label htmlFor="member-expiry-to" size="sm">
                  To
                </Label>
                <DatePicker
                  id="member-expiry-to"
                  value={value.expiryTo}
                  min={value.expiryFrom || undefined}
                  onChange={(expiryTo) =>
                    onChange({ ...value, expiryTo: expiryTo || value.expiryTo })
                  }
                />
              </div>
            </div>
          )}

          <Separator className="my-3" />
          <CheckGroup
            label="Plan"
            options={plans.map((p) => ({ value: p.id, label: p.name }))}
            selected={value.plans}
            onToggle={(v) => toggle('plans', v)}
            emptyHint="No plans yet."
          />

          <Separator className="my-3" />
          <CheckGroup
            label="Assigned to"
            options={assignedOptions}
            selected={value.assignees}
            onToggle={(v) => toggle('assignees', v)}
          />

          <Separator className="my-3" />
          <CheckGroup
            label="Trainer"
            options={trainerOptions}
            selected={value.trainers}
            onToggle={(v) => toggle('trainers', v)}
          />

          <Separator className="my-3" />
          <CheckGroup
            label="Fee"
            options={FEE_STATUS_OPTIONS}
            selected={value.feeStatus}
            onToggle={(v) => toggle('feeStatus', v)}
          />

          <Separator className="my-3" />
          <CheckGroup
            label="Usual time"
            options={[...USUAL_TIME_PERIODS, ...usualTimeOptions]}
            selected={value.usualTimes}
            onToggle={(v) => toggle('usualTimes', v)}
          />

          <Separator className="my-3" />
          <CheckGroup
            label="Follow-ups"
            options={FOLLOW_UP_OPTIONS}
            selected={value.followUps}
            onToggle={(v) => toggle('followUps', v)}
          />

          <Separator className="my-3" />
          <CheckGroup
            label="May leave"
            options={CHURN_RISK_OPTIONS}
            selected={value.churnRisk}
            onToggle={(v) => toggle('churnRisk', v)}
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
  emptyHint,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  emptyHint?: string;
}) {
  return (
    <div>
      <p className="text-muted-foreground mb-1.5 text-[11px] font-semibold tracking-wider uppercase">
        {label}
      </p>
      {options.length === 0 ? (
        <p className="text-muted-foreground text-xs">{emptyHint ?? 'None.'}</p>
      ) : (
        <div className="max-h-40 space-y-0.5 overflow-y-auto">
          {options.map((o) => (
            <label
              key={o.value}
              className="hover:bg-muted/60 flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1"
            >
              <Checkbox
                checked={selected.includes(o.value)}
                onCheckedChange={() => onToggle(o.value)}
              />
              <span className="text-popover-foreground text-sm">{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
