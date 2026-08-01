'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Archive,
  Dumbbell,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import {
  activeOptions,
  monthlyPriceInsight,
  pricingCadenceLabel,
} from '@/lib/memberships/pricing';
import type { MembershipPlan } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PlanTypeBadge } from '@/components/members/membership-status-badge';
import { PlanEditorDialog } from './plan-editor-dialog';
import { SettingsPanelHead } from './settings-panel-head';

/** The one-click seed on an empty account: ONE recurring plan with three
 *  billing options (062) — not three separate plans. Prices in the
 *  account currency; the legacy plan columns mirror the first option. */
const STARTER_OPTIONS = [
  {
    duration_count: 1,
    duration_unit: 'month',
    price: 1000,
    setup_fee: 0,
    sort_order: 0,
  },
  {
    duration_count: 3,
    duration_unit: 'month',
    price: 2700,
    setup_fee: 0,
    sort_order: 1,
  },
  {
    duration_count: 12,
    duration_unit: 'month',
    price: 9000,
    setup_fee: 0,
    sort_order: 2,
  },
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
  const [reloadNonce, setReloadNonce] = useState(0);
  const [seeding, setSeeding] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<MembershipPlan | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('membership_plans')
        .select('*, pricing_options:plan_pricing_options(*)')
        .order('is_active', { ascending: false })
        .order('name', { ascending: true });
      if (cancelled) return;
      setPlans((data as MembershipPlan[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadNonce, supabase]);

  function refreshPlans() {
    setLoading(true);
    setReloadNonce((nonce) => nonce + 1);
  }

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
        .from('membership_plans')
        .insert({
          account_id: accountId,
          name: 'Standard',
          plan_type: 'recurring',
          // Legacy mirror of the first option (062).
          price: STARTER_OPTIONS[0].price,
          duration_days: 30,
        })
        .select('id')
        .single();
      if (error) throw error;
      const { error: optError } = await supabase
        .from('plan_pricing_options')
        .insert(
          STARTER_OPTIONS.map((o) => ({
            ...o,
            account_id: accountId,
            plan_id: data.id,
          }))
        );
      if (optError) throw optError;
      toast.success('Starter plan added');
      refreshPlans();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to add the starter plan'
      );
    } finally {
      setSeeding(false);
    }
  }

  async function setActive(plan: MembershipPlan, isActive: boolean) {
    const { data, error } = await supabase
      .from('membership_plans')
      .update({ is_active: isActive })
      .eq('id', plan.id)
      .select('id');
    if (error) return toast.error(error.message);
    if (!data?.length)
      return toast.error("You don't have permission to change plans");
    toast.success(isActive ? 'Plan restored' : 'Plan archived');
    refreshPlans();
  }

  async function deletePlan(plan: MembershipPlan) {
    // A plan in use is FK-protected (RESTRICT). Detect it up front so we
    // can offer Archive instead of surfacing a raw constraint error.
    const { count } = await supabase
      .from('memberships')
      .select('id', { count: 'exact', head: true })
      .eq('plan_id', plan.id);
    if (count && count > 0) {
      toast.error(
        `${plan.name} is used by ${count} member${count === 1 ? '' : 's'} — archive it instead.`
      );
      return;
    }
    const { data, error } = await supabase
      .from('membership_plans')
      .delete()
      .eq('id', plan.id)
      .select('id');
    if (error) return toast.error(error.message);
    if (!data?.length)
      return toast.error("You don't have permission to delete plans");
    toast.success('Plan deleted');
    refreshPlans();
  }

  /** One comparison card per option; the actual charge remains visible beneath. */
  function optionsSummary(plan: MembershipPlan) {
    const opts = activeOptions(plan);
    if (opts.length === 0) {
      return (
        <p className="text-muted-foreground text-sm">No billing options</p>
      );
    }

    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {opts.map((option) => {
          const insight = monthlyPriceInsight(plan, option);
          const cadence = pricingCadenceLabel(plan, option);
          return (
            <Card key={option.id}>
              <CardContent>
                <div className="flex min-h-36 flex-col items-start gap-3">
                  <p className="text-foreground text-3xl leading-none font-semibold">
                    <span className="tabular-nums">
                      {fmt.money(
                        insight?.effectiveMonthlyPrice ?? option.price
                      )}
                    </span>
                    {insight && (
                      <span className="text-muted-foreground text-sm font-normal">
                        /month
                      </span>
                    )}
                  </p>
                  {insight?.savingsPercent ? (
                    <Badge variant="success">
                      Save{' '}
                      <span className="tabular-nums">
                        {fmt.number(insight.savingsPercent)}%
                      </span>
                    </Badge>
                  ) : null}
                  <div className="mt-auto space-y-1">
                    {insight ? (
                      <p className="text-foreground text-base font-semibold">
                        <span className="tabular-nums">
                          {fmt.money(option.price)}
                        </span>{' '}
                        total
                      </p>
                    ) : null}
                    <p className="text-muted-foreground text-sm">{cadence}</p>
                    {option.setup_fee > 0 ? (
                      <p className="text-muted-foreground text-sm">
                        Plus{' '}
                        <span className="tabular-nums">
                          {fmt.money(option.setup_fee)}
                        </span>{' '}
                        joining fee
                      </p>
                    ) : null}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  }

  function accessSummary(plan: MembershipPlan): string | null {
    if (plan.plan_type === 'session_pack') {
      return plan.sessions_count ? `${plan.sessions_count} sessions` : null;
    }
    if (plan.attendance_limit_count && plan.attendance_limit_interval) {
      const interval = {
        period: 'billing period',
        week: 'week',
        month: 'month',
      }[plan.attendance_limit_interval];
      return `${plan.attendance_limit_count} visits / ${interval}`;
    }
    return null;
  }

  return (
    <section className="animate-in fade-in-50 max-w-5xl duration-200">
      <SettingsPanelHead
        title="Membership plans"
        description="What your gym sells — plan types and their billing options. New members and renewals pick from these."
        action={
          canEditSettings ? (
            <Button onClick={openCreate}>
              <Plus className="size-4" /> Add plan
            </Button>
          ) : null
        }
      />

      {loading ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" /> Loading plans…
        </div>
      ) : plans.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Dumbbell className="text-muted-foreground size-8" />
            <p className="text-muted-foreground text-sm">
              No membership plans yet.
            </p>
            {canEditSettings && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={seedStarters}
                  disabled={seeding}
                >
                  {seeding ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
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
        <ul className="flex flex-col gap-4">
          {plans.map((plan) => {
            const access = accessSummary(plan);
            const description = plan.description?.trim();
            return (
              <li key={plan.id}>
                <Card className={plan.is_active ? undefined : 'opacity-60'}>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      <span>{plan.name}</span>
                      <PlanTypeBadge type={plan.plan_type} />
                      {!plan.is_active ? (
                        <Badge variant="neutral">Archived</Badge>
                      ) : null}
                    </CardTitle>
                    {description || access ? (
                      <CardDescription>
                        {description}
                        {description && access ? (
                          <span aria-hidden="true"> · </span>
                        ) : null}
                        {access}
                      </CardDescription>
                    ) : null}
                    {canEditSettings ? (
                      <CardAction>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Manage ${plan.name}`}
                              />
                            }
                          >
                            <MoreHorizontal className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-40">
                            <DropdownMenuItem onClick={() => openEdit(plan)}>
                              <Pencil className="size-4" />
                              Edit plan
                            </DropdownMenuItem>
                            {plan.is_active ? (
                              <DropdownMenuItem
                                onClick={() => setActive(plan, false)}
                              >
                                <Archive className="size-4" />
                                Archive plan
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() => setActive(plan, true)}
                              >
                                <RotateCcw className="size-4" />
                                Restore plan
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => deletePlan(plan)}
                            >
                              <Trash2 className="size-4" />
                              Delete plan
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </CardAction>
                    ) : null}
                  </CardHeader>
                  <CardContent>{optionsSummary(plan)}</CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {!canEditSettings && (
        <p className="text-muted-foreground mt-3 text-xs">
          Only account admins can change membership plans.
        </p>
      )}

      <PlanEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        plan={editingPlan}
        onSaved={refreshPlans}
      />
    </section>
  );
}
