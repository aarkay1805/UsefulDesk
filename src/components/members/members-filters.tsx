"use client";

import { Filter } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  activeMemberFilterCount,
  CHURN_RISK_OPTIONS,
  EMPTY_MEMBER_FILTERS,
  MEMBER_STATUS_OPTIONS,
  type MemberFilters,
} from "@/lib/memberships/filters";
import type { MembershipPlan } from "@/types";

const FEE_STATUS_OPTIONS: { value: "paid" | "due"; label: string }[] = [
  { value: "paid", label: "Paid" },
  { value: "due", label: "Fee due" },
];

const FOLLOW_UP_OPTIONS: { value: "open"; label: string }[] = [
  { value: "open", label: "Open follow-up" },
];

interface MembersFiltersProps {
  value: MemberFilters;
  onChange: (next: MemberFilters) => void;
  /** Plan options — useMembershipPlans (include archived so old members filter). */
  plans: MembershipPlan[];
}

/**
 * The All-members Filters popover — the members-lightweight sibling of
 * the leads Filters panel (same trigger/badge/check-group recipe, member
 * facets only: plan, derived status, fee status, and churn risk).
 */
export function MembersFilters({ value, onChange, plans }: MembersFiltersProps) {
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
        render={<Button variant="ghost" className="relative gap-0" />}
      >
        <Filter className="mr-1.5 size-4" />
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
              <span className="ml-0.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                {count}
              </span>
            </motion.span>
          )}
        </AnimatePresence>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <span className="text-sm font-semibold text-popover-foreground">
            Filters
          </span>
          {count > 0 && (
            <button
              type="button"
              onClick={() => onChange(EMPTY_MEMBER_FILTERS)}
              className="cursor-pointer text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Clear all
            </button>
          )}
        </div>

        <div className="max-h-[65vh] overflow-y-auto px-3 py-3">
          <CheckGroup
            label="Status"
            options={MEMBER_STATUS_OPTIONS}
            selected={value.statuses}
            onToggle={(v) => toggle("statuses", v)}
          />

          <Separator className="my-3" />
          <CheckGroup
            label="Plan"
            options={plans.map((p) => ({ value: p.id, label: p.name }))}
            selected={value.plans}
            onToggle={(v) => toggle("plans", v)}
            emptyHint="No plans yet."
          />

          <Separator className="my-3" />
          <CheckGroup
            label="Fee"
            options={FEE_STATUS_OPTIONS}
            selected={value.feeStatus}
            onToggle={(v) => toggle("feeStatus", v)}
          />

          <Separator className="my-3" />
          <CheckGroup
            label="Follow-ups"
            options={FOLLOW_UP_OPTIONS}
            selected={value.followUps}
            onToggle={(v) => toggle("followUps", v)}
          />

          <Separator className="my-3" />
          <CheckGroup
            label="Churn risk"
            options={CHURN_RISK_OPTIONS}
            selected={value.churnRisk}
            onToggle={(v) => toggle("churnRisk", v)}
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
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyHint ?? "None."}</p>
      ) : (
        <div className="max-h-40 space-y-0.5 overflow-y-auto">
          {options.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1 hover:bg-muted/60"
            >
              <Checkbox
                checked={selected.includes(o.value)}
                onCheckedChange={() => onToggle(o.value)}
              />
              <span className="text-sm text-popover-foreground">{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
