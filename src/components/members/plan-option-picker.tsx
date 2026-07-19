"use client";

import type { ReactNode } from "react";

import { useLocale } from "@/hooks/use-locale";
import { activeOptions, durationLabel } from "@/lib/memberships/pricing";
import type { MembershipPlan, PlanPricingOption } from "@/types";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** The member-form trial sentinel rides through this picker untouched. */
export const TRIAL_PLAN_VALUE = "__trial__";

export interface PlanOptionSelection {
  planId: string;
  optionId: string | null;
  plan: MembershipPlan | null;
  option: PlanPricingOption | null;
}

interface PlanOptionPickerProps {
  plans: MembershipPlan[];
  planId: string;
  optionId: string | null;
  onChange: (selection: PlanOptionSelection) => void;
  /** Prepend the member-form's "Trial / free pass" sentinel item. */
  allowTrial?: boolean;
  /** Mark the plan label required (visual star only). */
  required?: boolean;
  /** Rendered under the plan Select (e.g. the no-plans Settings hint). */
  footer?: ReactNode;
  disabled?: boolean;
  idPrefix?: string;
}

const PLAN_TYPE_SUFFIX: Record<MembershipPlan["plan_type"], string | null> = {
  recurring: null,
  non_recurring: "fixed term",
  session_pack: "session pack",
};

/** A row's duration only *bills* on a recurring plan — see PLAN_COPY in
 *  plan-editor-dialog.tsx, which names the same thing on the authoring side. */
const OPTION_LABEL: Record<MembershipPlan["plan_type"], string> = {
  recurring: "Billing option",
  non_recurring: "Term",
  session_pack: "Pricing",
};

/**
 * The canonical plan + billing-option picker (migration 062) — every
 * flow that puts a member on a plan (add member, renew, convert, change
 * plan, bulk convert, import) mounts this so plans and their pricing
 * options render identically. Picking a plan auto-selects its only
 * option; plans with several show a second "Billing option" Select.
 * Dates and fees are the caller's job (lib/memberships/pricing.ts) —
 * this component only resolves the selection.
 */
export function PlanOptionPicker({
  plans,
  planId,
  optionId,
  onChange,
  allowTrial = false,
  required = false,
  footer,
  disabled = false,
  idPrefix = "pop",
}: PlanOptionPickerProps) {
  const { fmt } = useLocale();

  const selectedPlan =
    planId && planId !== TRIAL_PLAN_VALUE
      ? (plans.find((p) => p.id === planId) ?? null)
      : null;
  const options = selectedPlan ? activeOptions(selectedPlan) : [];
  const selectedOption = options.find((o) => o.id === optionId) ?? null;

  // Money sits in tabular-nums (repo convention) — these labels render in
  // real DOM (SelectItems + the single-option summary), not native options.
  function optionLabel(o: PlanPricingOption): ReactNode {
    return (
      <>
        {durationLabel(o.duration_count, o.duration_unit)} ·{" "}
        <span className="tabular-nums">{fmt.money(o.price)}</span>
        {o.setup_fee > 0 && (
          <>
            {" "}
            (+<span className="tabular-nums">{fmt.money(o.setup_fee)}</span>{" "}
            joining fee)
          </>
        )}
      </>
    );
  }

  function planLabel(p: MembershipPlan): string {
    const suffix = PLAN_TYPE_SUFFIX[p.plan_type];
    return suffix ? `${p.name} · ${suffix}` : p.name;
  }

  function handlePlanChange(v: string | null) {
    if (!v) return;
    if (v === TRIAL_PLAN_VALUE) {
      onChange({ planId: v, optionId: null, plan: null, option: null });
      return;
    }
    const plan = plans.find((p) => p.id === v) ?? null;
    const opts = plan ? activeOptions(plan) : [];
    // A single option is the obvious choice — select it silently.
    const auto = opts.length === 1 ? opts[0] : null;
    onChange({ planId: v, optionId: auto?.id ?? null, plan, option: auto });
  }

  function handleOptionChange(v: string | null) {
    if (!v || !selectedPlan) return;
    const option = options.find((o) => o.id === v) ?? null;
    onChange({ planId, optionId: v, plan: selectedPlan, option });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-plan`} className="text-muted-foreground">
          Plan{" "}
          {required && <span className="text-red-foreground">*</span>}
        </Label>
        <Select
          value={planId || undefined}
          onValueChange={handlePlanChange}
          disabled={disabled}
        >
          <SelectTrigger id={`${idPrefix}-plan`} className="w-full">
            <SelectValue placeholder="Select a plan…" />
          </SelectTrigger>
          <SelectContent>
            {allowTrial && (
              <>
                {/* Trial is picked like a plan — the caller's fields switch
                    to trial length / no fee when selected. */}
                <SelectItem value={TRIAL_PLAN_VALUE}>
                  Trial / free pass ·{" "}
                  <span className="text-muted-foreground">no fee</span>
                </SelectItem>
                <SelectSeparator />
              </>
            )}
            {plans.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {planLabel(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {footer}
      </div>

      {selectedPlan && options.length > 1 && (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-option`} className="text-muted-foreground">
            {OPTION_LABEL[selectedPlan.plan_type]}
          </Label>
          <Select
            value={optionId || undefined}
            onValueChange={handleOptionChange}
            disabled={disabled}
          >
            <SelectTrigger id={`${idPrefix}-option`} className="w-full">
              <SelectValue
                placeholder={`Select a ${OPTION_LABEL[
                  selectedPlan.plan_type
                ].toLowerCase()}…`}
              />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {optionLabel(o)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {selectedPlan && options.length === 1 && selectedOption && (
        <p className="text-muted-foreground text-xs">{optionLabel(selectedOption)}</p>
      )}

      {selectedPlan && options.length === 0 && (
        <p className="text-destructive text-xs">
          This plan has no active price — add one in Settings → Membership plans.
        </p>
      )}
    </div>
  );
}
