"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useLocale } from "@/hooks/use-locale";
import { getErrorMessage } from "@/lib/errors";
import { isUniqueViolation } from "@/lib/contacts/dedupe";
import type {
  AttendanceLimitInterval,
  DurationUnit,
  MembershipPlan,
  PlanType,
} from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PLAN_TYPES: { value: PlanType; label: string; hint: string }[] = [
  {
    value: "recurring",
    label: "Recurring",
    hint: "Bills every cycle — renewal reminders and auto-pay apply.",
  },
  {
    value: "non_recurring",
    label: "Fixed term",
    hint: "Pay once for a fixed period (bootcamp, challenge) — no renewal chase.",
  },
  {
    value: "session_pack",
    label: "Session pack",
    hint: "A punchcard of sessions — each check-in uses one.",
  },
];

const DURATION_UNITS: { value: DurationUnit; label: string }[] = [
  { value: "day", label: "Day(s)" },
  { value: "week", label: "Week(s)" },
  { value: "month", label: "Month(s)" },
  { value: "year", label: "Year(s)" },
];

const LIMIT_INTERVALS: { value: AttendanceLimitInterval; label: string }[] = [
  { value: "period", label: "per billing period" },
  { value: "week", label: "per week" },
  { value: "month", label: "per month" },
];

/** One editable pricing-option row. `id` present = persisted. */
interface OptionRow {
  id?: string;
  duration_count: string;
  duration_unit: DurationUnit;
  price: string;
  setup_fee: string;
}

const EMPTY_OPTION: OptionRow = {
  duration_count: "1",
  duration_unit: "month",
  price: "",
  setup_fee: "",
};

/** Mirror the first option into the legacy plan columns (062: frozen but
 *  kept coherent so pre-062 readers/rollback stay sane). */
function approxDays(count: number, unit: DurationUnit): number {
  switch (unit) {
    case "day":
      return count;
    case "week":
      return count * 7;
    case "month":
      return count * 30;
    case "year":
      return count * 365;
  }
}

interface PlanEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null = create a new plan. */
  plan: MembershipPlan | null;
  onSaved: () => void;
}

/**
 * Create/edit a membership plan (migration 062): type, billing options
 * (duration × price × one-time joining fee), attendance limit
 * (recurring/fixed term) or sessions count (session pack).
 *
 * Save order: plan upsert first (`.select('id')` — silent-RLS rule),
 * then diff the option rows: insert new, update edited, and for removed
 * rows delete when unreferenced by any membership else archive
 * (`is_active=false`). The plan type locks once members are on the plan
 * — flipping a live plan between recurring/pack would re-interpret
 * every membership on it.
 */
export function PlanEditorDialog({
  open,
  onOpenChange,
  plan,
  onSaved,
}: PlanEditorDialogProps) {
  const supabase = createClient();
  const { accountId } = useAuth();
  const { fmt } = useLocale();
  const isEdit = !!plan;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [planType, setPlanType] = useState<PlanType>("recurring");
  const [options, setOptions] = useState<OptionRow[]>([{ ...EMPTY_OPTION }]);
  /** Persisted option ids removed in this session — resolved on save. */
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [limitCount, setLimitCount] = useState("");
  const [limitInterval, setLimitInterval] =
    useState<AttendanceLimitInterval>("period");
  const [sessionsCount, setSessionsCount] = useState("");
  const [typeLocked, setTypeLocked] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(plan?.name ?? "");
    setDescription(plan?.description ?? "");
    setPlanType(plan?.plan_type ?? "recurring");
    setLimitCount(
      plan?.attendance_limit_count ? String(plan.attendance_limit_count) : "",
    );
    setLimitInterval(plan?.attendance_limit_interval ?? "period");
    setSessionsCount(plan?.sessions_count ? String(plan.sessions_count) : "");
    setRemovedIds([]);
    const existing = (plan?.pricing_options ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((o) => ({
        id: o.id,
        duration_count: String(o.duration_count),
        duration_unit: o.duration_unit,
        price: String(o.price),
        setup_fee: o.setup_fee > 0 ? String(o.setup_fee) : "",
      }));
    setOptions(existing.length > 0 ? existing : [{ ...EMPTY_OPTION }]);
    setTypeLocked(false);
    if (plan) {
      // Lock the type once members reference the plan.
      (async () => {
        const { count } = await supabase
          .from("memberships")
          .select("id", { count: "exact", head: true })
          .eq("plan_id", plan.id);
        if ((count ?? 0) > 0) setTypeLocked(true);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, plan]);

  function patchOption(index: number, patch: Partial<OptionRow>) {
    setOptions((rows) =>
      rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  }

  function removeOption(index: number) {
    setOptions((rows) => {
      const row = rows[index];
      if (row?.id) setRemovedIds((ids) => [...ids, row.id!]);
      return rows.filter((_, i) => i !== index);
    });
  }

  async function handleSave() {
    if (!accountId) return;
    const trimmed = name.trim();
    if (!trimmed) return toast.error("Plan name is required");
    if (options.length === 0) return toast.error("Add at least one billing option");

    const parsedOptions = options.map((o) => ({
      id: o.id,
      duration_count: Number(o.duration_count),
      duration_unit: o.duration_unit,
      price: o.price === "" ? 0 : Number(o.price),
      setup_fee: o.setup_fee === "" ? 0 : Number(o.setup_fee),
    }));
    for (const o of parsedOptions) {
      if (!Number.isInteger(o.duration_count) || o.duration_count <= 0) {
        return toast.error("Each billing option needs a whole-number duration");
      }
      if (!Number.isFinite(o.price) || o.price < 0) {
        return toast.error("Enter a valid price for each billing option");
      }
      if (!Number.isFinite(o.setup_fee) || o.setup_fee < 0) {
        return toast.error("Enter a valid joining fee for each billing option");
      }
    }

    const limit = limitCount === "" ? null : Number(limitCount);
    if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) {
      return toast.error("The visit limit must be a whole number");
    }
    const sessions = sessionsCount === "" ? null : Number(sessionsCount);
    if (planType === "session_pack") {
      if (sessions === null || !Number.isInteger(sessions) || sessions <= 0) {
        return toast.error("A session pack needs a whole-number session count");
      }
    }

    setSaving(true);
    try {
      const planPayload = {
        name: trimmed,
        description: description.trim() || null,
        plan_type: planType,
        attendance_limit_count: planType === "session_pack" ? null : limit,
        attendance_limit_interval:
          planType === "session_pack" || limit === null ? null : limitInterval,
        sessions_count: planType === "session_pack" ? sessions : null,
        // Legacy mirror (062): keep the frozen scalar columns coherent
        // with the first billing option for rollback/old readers.
        price: parsedOptions[0].price,
        duration_days: approxDays(
          parsedOptions[0].duration_count,
          parsedOptions[0].duration_unit,
        ),
      };

      let planId = plan?.id;
      if (isEdit && planId) {
        const { data, error } = await supabase
          .from("membership_plans")
          .update(planPayload)
          .eq("id", planId)
          .select("id");
        if (error) throw error;
        if (!data?.length) throw new Error("You don't have permission to edit plans");
      } else {
        const { data, error } = await supabase
          .from("membership_plans")
          .insert({ ...planPayload, account_id: accountId })
          .select("id")
          .single();
        if (error) {
          if (isUniqueViolation(error)) {
            toast.error("A plan with this name already exists");
            return;
          }
          throw error;
        }
        planId = data.id as string;
      }

      // ---- options diff ------------------------------------------
      for (const [i, o] of parsedOptions.entries()) {
        const row = {
          duration_count: o.duration_count,
          duration_unit: o.duration_unit,
          price: o.price,
          setup_fee: o.setup_fee,
          sort_order: i,
          is_active: true,
        };
        if (o.id) {
          const { data, error } = await supabase
            .from("plan_pricing_options")
            .update(row)
            .eq("id", o.id)
            .select("id");
          if (error) throw error;
          if (!data?.length) throw new Error("You don't have permission to edit plans");
        } else {
          const { error } = await supabase
            .from("plan_pricing_options")
            .insert({ ...row, account_id: accountId, plan_id: planId });
          if (error) throw error;
        }
      }

      // Removed rows: delete when unreferenced, archive otherwise.
      for (const id of removedIds) {
        const { count } = await supabase
          .from("memberships")
          .select("id", { count: "exact", head: true })
          .eq("pricing_option_id", id);
        if ((count ?? 0) > 0) {
          const { data, error } = await supabase
            .from("plan_pricing_options")
            .update({ is_active: false })
            .eq("id", id)
            .select("id");
          if (error) throw error;
          if (!data?.length) throw new Error("You don't have permission to edit plans");
        } else {
          const { data, error } = await supabase
            .from("plan_pricing_options")
            .delete()
            .eq("id", id)
            .select("id");
          if (error) throw error;
          if (!data?.length) throw new Error("You don't have permission to edit plans");
        }
      }

      toast.success(isEdit ? "Plan updated" : "Plan added");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to save the plan"));
    } finally {
      setSaving(false);
    }
  }

  const typeHint = PLAN_TYPES.find((t) => t.value === planType)?.hint;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit plan" : "New plan"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Change what this plan sells. Existing members keep their current cycle."
              : "What your gym sells — its billing options and access rules."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pe-name" className="text-muted-foreground">
                Plan name
              </Label>
              <Input
                id="pe-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Gold"
                className="bg-muted"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pe-type" className="text-muted-foreground">
                Plan type
              </Label>
              <Select
                value={planType}
                onValueChange={(v) => v && setPlanType(v as PlanType)}
                disabled={typeLocked}
              >
                <SelectTrigger id="pe-type" className="w-full bg-muted">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLAN_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            {typeLocked
              ? "The type is locked because members are on this plan."
              : typeHint}
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="pe-desc" className="text-muted-foreground">
              Description <span className="opacity-60">(optional)</span>
            </Label>
            <Input
              id="pe-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Shown nowhere yet — internal note"
              className="bg-muted"
            />
          </div>

          {/* ---- Billing options ---------------------------------- */}
          <div className="space-y-2">
            <Label className="text-muted-foreground">
              {planType === "session_pack" ? "Pricing & validity" : "Billing options"}
            </Label>
            <div className="space-y-2">
              {options.map((o, i) => (
                <div
                  key={o.id ?? `new-${i}`}
                  className="border-border bg-muted/40 rounded-lg border p-3"
                >
                  <div className="grid grid-cols-[4rem_1fr] gap-2 sm:grid-cols-[4rem_7rem_1fr_1fr_auto] sm:items-end">
                    <div className="space-y-1">
                      <span className="text-muted-foreground text-xs">
                        {planType === "session_pack" ? "Valid for" : "Every"}
                      </span>
                      <Input
                        type="number"
                        min={1}
                        value={o.duration_count}
                        onChange={(e) =>
                          patchOption(i, { duration_count: e.target.value })
                        }
                        className="bg-muted h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="text-muted-foreground text-xs">Unit</span>
                      <Select
                        value={o.duration_unit}
                        onValueChange={(v) =>
                          v && patchOption(i, { duration_unit: v as DurationUnit })
                        }
                      >
                        <SelectTrigger className="bg-muted h-8 w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DURATION_UNITS.map((u) => (
                            <SelectItem key={u.value} value={u.value}>
                              {u.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <span className="text-muted-foreground text-xs">Price</span>
                      <Input
                        type="number"
                        min={0}
                        value={o.price}
                        onChange={(e) => patchOption(i, { price: e.target.value })}
                        placeholder="1000"
                        className="bg-muted h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="text-muted-foreground text-xs">
                        Joining fee
                      </span>
                      <Input
                        type="number"
                        min={0}
                        value={o.setup_fee}
                        onChange={(e) =>
                          patchOption(i, { setup_fee: e.target.value })
                        }
                        placeholder="0"
                        className="bg-muted h-8"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title="Remove option"
                      onClick={() => removeOption(i)}
                      disabled={options.length === 1}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOptions((rows) => [...rows, { ...EMPTY_OPTION }])}
            >
              <Plus className="size-4" /> Add billing option
            </Button>
            <p className="text-muted-foreground text-xs">
              The joining fee is one-time — it&apos;s added to the first bill only.
            </p>
          </div>

          {/* ---- Access ------------------------------------------- */}
          {planType === "session_pack" ? (
            <div className="space-y-1.5">
              <Label htmlFor="pe-sessions" className="text-muted-foreground">
                Sessions in the pack
              </Label>
              <Input
                id="pe-sessions"
                type="number"
                min={1}
                value={sessionsCount}
                onChange={(e) => setSessionsCount(e.target.value)}
                placeholder="10"
                className="bg-muted sm:w-32"
              />
              <p className="text-muted-foreground text-xs">
                Each check-in uses one session. Staff see the remaining count and
                get a warning (not a block) when the pack runs out.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="pe-limit" className="text-muted-foreground">
                Visit limit <span className="opacity-60">(optional)</span>
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="pe-limit"
                  type="number"
                  min={1}
                  value={limitCount}
                  onChange={(e) => setLimitCount(e.target.value)}
                  placeholder="Unlimited"
                  className="bg-muted w-28"
                />
                <Select
                  value={limitInterval}
                  onValueChange={(v) =>
                    v && setLimitInterval(v as AttendanceLimitInterval)
                  }
                  disabled={limitCount === ""}
                >
                  <SelectTrigger className="bg-muted w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LIMIT_INTERVALS.map((li) => (
                      <SelectItem key={li.value} value={li.value}>
                        {li.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-muted-foreground text-xs">
                Blank = unlimited. Over the limit, check-in warns staff but never
                blocks — the owner stays in charge.
              </p>
            </div>
          )}

          {options[0] && options[0].price !== "" && (
            <p className="text-muted-foreground text-xs">
              First bill on the first option:{" "}
              <span className="text-foreground tabular-nums">
                {fmt.money(
                  (Number(options[0].price) || 0) +
                    (Number(options[0].setup_fee) || 0),
                )}
              </span>
              {Number(options[0].setup_fee) > 0 && " (incl. joining fee)"}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {isEdit ? "Save changes" : "Add plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
