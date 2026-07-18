"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { getErrorMessage } from "@/lib/errors";
import { useLocale } from "@/hooks/use-locale";
import { istAddDays } from "@/lib/memberships/expiry";
import { planChangeQuote } from "@/lib/memberships/plan-change";
import { changeMembershipPlan } from "@/lib/memberships/periods";
import { optionEndDate, renewalFee } from "@/lib/memberships/pricing";
import type { Membership, MembershipPeriodInvoice, PaymentMethod } from "@/types";
import { useMembershipPlans } from "./use-membership-plans";
import { PlanOptionPicker } from "./plan-option-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "bank", label: "Bank transfer" },
  { value: "other", label: "Other" },
];

interface ChangePlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  membership: Membership;
  /** The current cycle's invoice (fee + amount_paid) — the credit source. */
  currentInvoice: MembershipPeriodInvoice | null;
  onSaved: () => void;
}

/**
 * Mid-cycle plan swap/upgrade: pick the new plan and the day it starts;
 * the unused, already-paid days of the current cycle come back as a
 * credit against the new plan's first invoice (planChangeQuote), and the
 * whole switch commits through the change_membership_plan RPC (061).
 */
export function ChangePlanDialog({
  open,
  onOpenChange,
  membership,
  currentInvoice,
  onSaved,
}: ChangePlanDialogProps) {
  const supabase = createClient();
  const { fmt } = useLocale();
  const { plans } = useMembershipPlans(true);

  // The cycle being given up — invoice read model first, membership
  // pointer as the pre-057 fallback (no period row = nothing collected).
  const cycleStart = currentInvoice?.period_start ?? membership.start_date;
  const cycleEnd = currentInvoice?.period_end ?? membership.end_date;
  const cycleFee = Number(currentInvoice?.fee_amount ?? membership.fee_amount ?? 0);
  const cyclePaid = Number(currentInvoice?.amount_paid ?? 0);

  const [planId, setPlanId] = useState("");
  const [optionId, setOptionId] = useState<string | null>(null);
  const [switchDate, setSwitchDate] = useState(fmt.today());
  const [feeAmount, setFeeAmount] = useState("");
  // Until staff type a fee themselves it follows the quote (plan price
  // minus credit), so changing the plan or date re-seeds it.
  const [feeTouched, setFeeTouched] = useState(false);
  const [collectPayment, setCollectPayment] = useState(true);
  const [collectAmount, setCollectAmount] = useState("");
  const [collectTouched, setCollectTouched] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [saving, setSaving] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const selectedPlan = plans.find((p) => p.id === planId);
  const selectedOption =
    selectedPlan?.pricing_options?.find((o) => o.id === optionId && o.is_active) ??
    null;

  // The truncated old cycle must keep at least one day, so the earliest
  // switch is the day after it starts.
  const minSwitch = istAddDays(cycleStart, 1);

  // A plan change bills the option price alone — the one-time joining
  // fee was paid at admission, never again on a switch.
  const quote = selectedOption
    ? planChangeQuote({
        periodStart: cycleStart,
        periodEnd: cycleEnd,
        feeAmount: cycleFee,
        amountPaid: cyclePaid,
        switchDate,
        newPlanPrice: renewalFee(selectedOption),
      })
    : null;
  const newEnd = selectedOption ? optionEndDate(switchDate, selectedOption) : null;
  const netFee = quote ? quote.netFee : 0;
  const effectiveFee = feeTouched && feeAmount !== "" ? Number(feeAmount) : netFee;

  useEffect(() => {
    if (!open) return;
    setPlanId("");
    setOptionId(null);
    setSwitchDate(fmt.today() >= minSwitch ? fmt.today() : minSwitch);
    setFeeAmount("");
    setFeeTouched(false);
    setCollectPayment(true);
    setCollectAmount("");
    setCollectTouched(false);
    setMethod("cash");
    setIdempotencyKey(crypto.randomUUID());
    // Seeds are snapshots at open; re-running on membership identity
    // mid-edit would clobber user input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, membership.id]);

  // The fee and the collect amount follow the quote until touched.
  useEffect(() => {
    if (!quote) return;
    if (!feeTouched) setFeeAmount(String(quote.netFee));
    if (!collectTouched) setCollectAmount(String(quote.netFee));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, optionId, switchDate, quote?.netFee]);

  async function handleChange() {
    if (!selectedPlan || !selectedOption || !newEnd || !quote) {
      return toast.error("Pick the new plan and billing option");
    }
    const fee = feeAmount === "" ? quote.netFee : Number(feeAmount);
    if (!Number.isFinite(fee) || fee < 0) return toast.error("Enter a valid fee");

    const collected = collectPayment
      ? collectAmount === ""
        ? fee
        : Number(collectAmount)
      : 0;
    if (collectPayment && (!Number.isFinite(collected) || collected < 0)) {
      return toast.error("Enter a valid amount");
    }
    if (collected > fee) {
      return toast.error("Collected amount cannot exceed the fee");
    }

    setSaving(true);
    try {
      const { error } = await changeMembershipPlan(supabase, membership.id, {
        plan_id: planId,
        pricing_option_id: optionId,
        switch_date: switchDate,
        period_end: newEnd,
        old_fee_amount: quote.oldCycleFee,
        fee_amount: fee,
        collect_amount: collected,
        method,
        idempotency_key: idempotencyKey,
      });
      if (error) throw error;

      toast.success("Plan changed");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to change the plan"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change plan</DialogTitle>
          <DialogDescription>
            Switch this member to another plan mid-cycle. Paid, unused days of
            the current plan are credited against the new plan&apos;s fee.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <PlanOptionPicker
            idPrefix="cp"
            plans={plans}
            planId={planId}
            optionId={optionId}
            onChange={(sel) => {
              setPlanId(sel.planId);
              setOptionId(sel.optionId);
            }}
          />

          <div className="space-y-1.5">
            <Label htmlFor="cp-switch" className="text-muted-foreground">
              New plan starts
            </Label>
            <DatePicker
              id="cp-switch"
              value={switchDate}
              onChange={setSwitchDate}
              min={minSwitch}
            />
            <p className="text-muted-foreground text-xs">
              The current cycle ends on this day and is re-invoiced for the days
              used.
            </p>
          </div>

          {selectedOption && quote && newEnd && (
            <div className="border-border bg-muted/40 space-y-1 rounded-lg border px-3 py-2 text-sm">
              {quote.credit > 0 ? (
                <>
                  <p>
                    <span className="text-muted-foreground">
                      Credit for {quote.remainingDays} unused day
                      {quote.remainingDays === 1 ? "" : "s"}:{" "}
                    </span>
                    <span className="font-medium text-emerald-700 tabular-nums dark:text-emerald-400">
                      {fmt.money(quote.credit)}
                    </span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">To pay: </span>
                    <span className="text-foreground font-medium tabular-nums">
                      {fmt.money(renewalFee(selectedOption))} − {fmt.money(quote.credit)} ={" "}
                      {fmt.money(quote.netFee)}
                    </span>
                  </p>
                  {quote.carryover > 0 && (
                    <p className="text-muted-foreground text-xs">
                      The credit exceeds the new plan&apos;s price by{" "}
                      <span className="tabular-nums">{fmt.money(quote.carryover)}</span> —
                      the new cycle is fully covered; the remainder is not carried
                      further.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">
                  No unused paid balance to credit from the current cycle.
                </p>
              )}
              <p>
                <span className="text-muted-foreground">New expiry: </span>
                <span className="text-foreground font-medium">{fmt.date(newEnd)}</span>
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="cp-fee" className="text-muted-foreground">
              Fee for the new cycle
            </Label>
            <Input
              id="cp-fee"
              type="number"
              min={0}
              value={feeAmount}
              onChange={(e) => {
                setFeeAmount(e.target.value);
                setFeeTouched(true);
              }}
            />
          </div>

          <div className="border-border bg-muted/40 space-y-2 rounded-lg border p-3">
            <label className="text-foreground flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={collectPayment}
                onChange={(e) => setCollectPayment(e.target.checked)}
                className="accent-primary size-4"
              />
              Record payment for the new plan
            </label>
            {collectPayment && effectiveFee > 0 && (
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  min={0}
                  value={collectAmount}
                  onChange={(e) => {
                    setCollectAmount(e.target.value);
                    setCollectTouched(true);
                  }}
                  placeholder="Amount"
                  className="h-8"
                />
                <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {collectPayment && effectiveFee <= 0 && (
              <p className="text-muted-foreground text-xs">
                Nothing to collect — the credit covers the new cycle.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleChange}
            disabled={saving || !selectedPlan || !selectedOption}
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            Change plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
