"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Dumbbell, Loader2, Plus, Archive, Trash2, RotateCcw } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import { isUniqueViolation } from "@/lib/contacts/dedupe";
import type { MembershipPlan } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { SettingsPanelHead } from "./settings-panel-head";

/** The one-click seed offered on an empty account (prices in the account currency). */
const STARTER_PLANS = [
  { name: "Monthly", price: 1000, duration_days: 30 },
  { name: "Quarterly", price: 2700, duration_days: 90 },
  { name: "Yearly", price: 9000, duration_days: 365 },
];

/**
 * Membership plans — the catalogue a gym sells (name + price + duration
 * in days). Settings-class: the `membership_plans` RLS policies (031)
 * restrict writes to admins+, so non-admins see a read-only list.
 *
 * A plan referenced by a membership can't be hard-deleted (FK RESTRICT),
 * so the row offers Archive (is_active=false) which hides it from new
 * membership selects while keeping existing memberships intact.
 */
export function PlansSettings() {
  const supabase = createClient();
  const { accountId, defaultCurrency, canEditSettings, user } = useAuth();

  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [durationDays, setDurationDays] = useState("30");

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("membership_plans")
      .select("*")
      .order("is_active", { ascending: false })
      .order("duration_days", { ascending: true });
    setPlans((data as MembershipPlan[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId || !user) return;
    const trimmed = name.trim();
    const priceNum = Number(price);
    const days = Number(durationDays);
    if (!trimmed) return toast.error("Plan name is required");
    if (!Number.isFinite(priceNum) || priceNum < 0) return toast.error("Enter a valid price");
    if (!Number.isInteger(days) || days <= 0) return toast.error("Duration must be a whole number of days");

    setSaving(true);
    try {
      const { error } = await supabase.from("membership_plans").insert({
        account_id: accountId,
        name: trimmed,
        price: priceNum,
        duration_days: days,
      });
      if (error) {
        if (isUniqueViolation(error)) {
          toast.error("A plan with this name already exists");
          return;
        }
        throw error;
      }
      toast.success("Plan added");
      setName("");
      setPrice("");
      setDurationDays("30");
      await fetchPlans();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add plan");
    } finally {
      setSaving(false);
    }
  }

  async function seedStarters() {
    if (!accountId) return;
    setSeeding(true);
    try {
      const { error } = await supabase.from("membership_plans").insert(
        STARTER_PLANS.map((p) => ({ ...p, account_id: accountId })),
      );
      if (error) throw error;
      toast.success("Starter plans added");
      await fetchPlans();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add starter plans");
    } finally {
      setSeeding(false);
    }
  }

  async function setActive(plan: MembershipPlan, isActive: boolean) {
    const { error } = await supabase
      .from("membership_plans")
      .update({ is_active: isActive })
      .eq("id", plan.id);
    if (error) return toast.error(error.message);
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
    const { error } = await supabase.from("membership_plans").delete().eq("id", plan.id);
    if (error) return toast.error(error.message);
    toast.success("Plan deleted");
    await fetchPlans();
  }

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Membership plans"
        description="What your gym sells — each plan's price and how many days it lasts. New members and renewals pick from these."
      />

      {canEditSettings && (
        <Card className="mb-4">
          <CardContent className="pt-4">
            <form onSubmit={handleAdd} className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
              <div className="grid gap-1.5">
                <Label htmlFor="plan-name" className="text-muted-foreground">Plan name</Label>
                <Input
                  id="plan-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Monthly"
                  className="bg-muted"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="plan-price" className="text-muted-foreground">Price ({defaultCurrency})</Label>
                <Input
                  id="plan-price"
                  type="number"
                  min={0}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="1000"
                  className="bg-muted sm:w-28"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="plan-days" className="text-muted-foreground">Days</Label>
                <Input
                  id="plan-days"
                  type="number"
                  min={1}
                  value={durationDays}
                  onChange={(e) => setDurationDays(e.target.value)}
                  className="bg-muted sm:w-20"
                />
              </div>
              <Button type="submit" disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Add
              </Button>
            </form>
          </CardContent>
        </Card>
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
              <Button variant="outline" onClick={seedStarters} disabled={seeding}>
                {seeding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Add starter plans
              </Button>
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
                  {!plan.is_active && (
                    <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      Archived
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {formatCurrency(plan.price, defaultCurrency)}
                  </span>{" "}
                  · {plan.duration_days} days
                </p>
              </div>
              {canEditSettings && (
                <div className="flex shrink-0 items-center gap-1">
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
    </section>
  );
}
