"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Dumbbell, Loader2, Plus, Archive, Trash2, RotateCcw, Pencil } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useLocale } from "@/hooks/use-locale";
import { activeOptions, durationLabel } from "@/lib/memberships/pricing";
import type { MembershipPlan } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PlanTypeBadge } from "@/components/members/membership-status-badge";
import { PlanEditorDialog } from "./plan-editor-dialog";
import { SettingsPanelHead } from "./settings-panel-head";

/** The one-click seed on an empty account: ONE recurring plan with three
 *  billing options (062) — not three separate plans. Prices in the
 *  account currency; the legacy plan columns mirror the first option. */
const STARTER_OPTIONS = [
  { duration_count: 1, duration_unit: "month", price: 1000, setup_fee: 0, sort_order: 0 },
  { duration_count: 3, duration_unit: "month", price: 2700, setup_fee: 0, sort_order: 1 },
  { duration_count: 12, duration_unit: "month", price: 9000, setup_fee: 0, sort_order: 2 },
];

/**
 * Membership plans — the catalogue a gym sells. Since migration 062 a
 * plan is a TYPE (recurring / fixed term / session pack) plus one or
 * more BILLING OPTIONS (`plan_pricing_options`: duration × price), with
 * optional attendance limits. Create/edit happens in PlanEditorDialog;
 * this page lists, archives and deletes. A legacy `setup_fee` still
 * renders on an option that carries one, but the editor no longer sells
 * joining fees.
 *
 * Settings-class: RLS restricts writes to admins+, so non-admins see a
 * read-only list. A plan referenced by a membership can't be
 * hard-deleted (FK RESTRICT) — Archive hides it from pickers instead.
 */
export function PlansSettings() {
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();
  const { fmt } = useLocale();

  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<MembershipPlan | null>(null);

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("membership_plans")
      .select("*, pricing_options:plan_pricing_options(*)")
      .order("is_active", { ascending: false })
      .order("name", { ascending: true });
    setPlans((data as MembershipPlan[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  function openCreate() {
    setEditingPlan(null);
    setEditorOpen(true);
  }

  function openEdit(plan: MembershipPlan) {
    setEditingPlan(plan);
    setEditorOpen(true);
  }

  async function seedStarters() {
    if (!accountId) return;
    setSeeding(true);
    try {
      const { data, error } = await supabase
        .from("membership_plans")
        .insert({
          account_id: accountId,
          name: "Standard",
          plan_type: "recurring",
          // Legacy mirror of the first option (062).
          price: STARTER_OPTIONS[0].price,
          duration_days: 30,
        })
        .select("id")
        .single();
      if (error) throw error;
      const { error: optError } = await supabase.from("plan_pricing_options").insert(
        STARTER_OPTIONS.map((o) => ({ ...o, account_id: accountId, plan_id: data.id })),
      );
      if (optError) throw optError;
      toast.success("Starter plan added");
      await fetchPlans();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add the starter plan");
    } finally {
      setSeeding(false);
    }
  }

  async function setActive(plan: MembershipPlan, isActive: boolean) {
    const { data, error } = await supabase
      .from("membership_plans")
      .update({ is_active: isActive })
      .eq("id", plan.id)
      .select("id");
    if (error) return toast.error(error.message);
    if (!data?.length) return toast.error("You don't have permission to change plans");
    toast.success(isActive ? "Plan restored" : "Plan archived");
    await fetchPlans();
  }

  async function deletePlan(plan: MembershipPlan) {
    // A plan in use is FK-protected (RESTRICT). Detect it up front so we
    // can offer Archive instead of surfacing a raw constraint error.
    const { count } = await supabase
      .from("memberships")
      .select("id", { count: "exact", head: true })
      .eq("plan_id", plan.id);
    if (count && count > 0) {
      toast.error(
        `${plan.name} is used by ${count} member${count === 1 ? "" : "s"} — archive it instead.`,
      );
      return;
    }
    const { data, error } = await supabase
      .from("membership_plans")
      .delete()
      .eq("id", plan.id)
      .select("id");
    if (error) return toast.error(error.message);
    if (!data?.length) return toast.error("You don't have permission to delete plans");
    toast.success("Plan deleted");
    await fetchPlans();
  }

  /** "1 month ₹1,000 · 3 months ₹2,700" — the row's pricing summary. */
  function optionsSummary(plan: MembershipPlan): string {
    const opts = activeOptions(plan);
    if (opts.length === 0) return "No billing options";
    return opts
      .map(
        (o) =>
          `${durationLabel(o.duration_count, o.duration_unit)} ${fmt.money(o.price)}${
            o.setup_fee > 0 ? ` (+${fmt.money(o.setup_fee)} joining)` : ""
          }`,
      )
      .join(" · ");
  }

  function accessSummary(plan: MembershipPlan): string | null {
    if (plan.plan_type === "session_pack") {
      return plan.sessions_count ? `${plan.sessions_count} sessions` : null;
    }
    if (plan.attendance_limit_count && plan.attendance_limit_interval) {
      const interval = { period: "billing period", week: "week", month: "month" }[
        plan.attendance_limit_interval
      ];
      return `${plan.attendance_limit_count} visits / ${interval}`;
    }
    return null;
  }

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Membership plans"
        description="What your gym sells — plan types and their billing options. New members and renewals pick from these."
      />

      {canEditSettings && (
        <div className="mb-4">
          <Button
            onClick={openCreate}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="size-4" /> Add plan
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading plans…
        </div>
      ) : plans.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Dumbbell className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No membership plans yet.</p>
            {canEditSettings && (
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={seedStarters} disabled={seeding}>
                  {seeding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  Add a starter plan
                </Button>
                <Button variant="outline" onClick={openCreate}>
                  Create from scratch
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {plans.map((plan) => (
            <li
              key={plan.id}
              className={`flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 ${
                plan.is_active ? "" : "opacity-60"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{plan.name}</span>
                  <PlanTypeBadge type={plan.plan_type} />
                  {!plan.is_active && (
                    <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      Archived
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  <span className="tabular-nums">{optionsSummary(plan)}</span>
                  {accessSummary(plan) && <> · {accessSummary(plan)}</>}
                </p>
              </div>
              {canEditSettings && (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Edit"
                    onClick={() => openEdit(plan)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  {plan.is_active ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Archive"
                      onClick={() => setActive(plan, false)}
                    >
                      <Archive className="size-4" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Restore"
                      onClick={() => setActive(plan, true)}
                    >
                      <RotateCcw className="size-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Delete"
                    onClick={() => deletePlan(plan)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {!canEditSettings && (
        <p className="mt-3 text-xs text-muted-foreground">
          Only account admins can change membership plans.
        </p>
      )}

      <PlanEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        plan={editingPlan}
        onSaved={fetchPlans}
      />
    </section>
  );
}
