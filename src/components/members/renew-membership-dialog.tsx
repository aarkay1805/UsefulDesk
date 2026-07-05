"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import {
  istToday,
  daysBetween,
  istAddDays,
} from "@/lib/memberships/expiry";
import type { Membership, PaymentMethod } from "@/types";
import { useMembershipPlans } from "./use-membership-plans";
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

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "bank", label: "Bank transfer" },
  { value: "other", label: "Other" },
];

interface RenewMembershipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  membership: Membership;
  onSaved: () => void;
  /** 'convert' reuses this flow for the trial→paid conversion: the new
   *  paid period starts today (a trial's remaining days aren't carried
   *  forward), and the row is flipped off trial with converted_at
   *  stamped. Defaults to the plain 'renew' behaviour. */
  variant?: "renew" | "convert";
}

export function RenewMembershipDialog({
  open,
  onOpenChange,
  membership,
  onSaved,
  variant = "renew",
}: RenewMembershipDialogProps) {
  const supabase = createClient();
  const { accountId, user, defaultCurrency } = useAuth();
  const { plans } = useMembershipPlans(true);
  const isConvert = variant === "convert";

  const [planId, setPlanId] = useState(membership.plan_id ?? "");
  const [feeAmount, setFeeAmount] = useState(String(membership.fee_amount ?? ""));
  const [collectPayment, setCollectPayment] = useState(true);
  const [collectAmount, setCollectAmount] = useState(String(membership.fee_amount ?? ""));
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [saving, setSaving] = useState(false);

  const selectedPlan = plans.find((p) => p.id === planId);

  useEffect(() => {
    if (!open) return;
    setPlanId(membership.plan_id ?? "");
    setFeeAmount(String(membership.fee_amount ?? ""));
    setCollectPayment(true);
    setCollectAmount(String(membership.fee_amount ?? ""));
    setMethod("cash");
  }, [open, membership]);

  // Seed the fee (and the amount to collect) from the picked plan.
  useEffect(() => {
    if (selectedPlan) {
      setFeeAmount(String(selectedPlan.price));
      setCollectAmount(String(selectedPlan.price));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  // New period extends from the later of current expiry or today, so a
  // member who renews early keeps their unexpired days. A conversion
  // always starts today — a trial's leftover days aren't paid time.
  const today = istToday();
  const base =
    !isConvert && membership.end_date && daysBetween(today, membership.end_date) > 0
      ? membership.end_date
      : today;
  const newEnd = selectedPlan ? istAddDays(base, selectedPlan.duration_days) : null;

  async function handleRenew() {
    if (!accountId || !user) return;
    if (!selectedPlan || !newEnd) return toast.error("Pick a plan");
    const fee = feeAmount === "" ? selectedPlan.price : Number(feeAmount);
    if (!Number.isFinite(fee) || fee < 0) return toast.error("Enter a valid fee");

    // Collected now; a partial amount leaves the new period 'due'.
    const collected = collectPayment
      ? collectAmount === ""
        ? fee
        : Number(collectAmount)
      : 0;
    if (collectPayment && (!Number.isFinite(collected) || collected < 0)) {
      return toast.error("Enter a valid amount");
    }

    setSaving(true);
    try {
      const feeStatus = collected >= fee ? "paid" : "due";
      const { error: mErr } = await supabase
        .from("memberships")
        .update({
          plan_id: planId,
          start_date: base,
          end_date: newEnd,
          status: "active",
          fee_amount: fee,
          fee_status: feeStatus,
          frozen_at: null,
          // Converting flips the row off trial and records when — the
          // renewal path leaves both untouched.
          ...(isConvert
            ? { is_trial: false, converted_at: new Date().toISOString() }
            : {}),
        })
        .eq("id", membership.id);
      if (mErr) throw mErr;

      if (collectPayment && collected > 0) {
        const { error: pErr } = await supabase.from("payments").insert({
          account_id: accountId,
          membership_id: membership.id,
          contact_id: membership.contact_id,
          plan_id: planId,
          user_id: user.id,
          amount: collected,
          method,
          status: "paid",
          period_start: base,
          period_end: newEnd,
        });
        if (pErr) {
          toast.warning(
            isConvert
              ? "Converted, but the payment couldn't be recorded."
              : "Renewed, but the payment couldn't be recorded.",
          );
          onOpenChange(false);
          onSaved();
          return;
        }
      }

      toast.success(isConvert ? "Trial converted to member" : "Membership renewed");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to renew");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{isConvert ? "Convert trial to member" : "Renew membership"}</DialogTitle>
          <DialogDescription>
            {isConvert
              ? "Start this trial on a paid plan and record the first payment."
              : "Extend this member's plan and record the renewal."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rn-plan" className="text-muted-foreground">Plan</Label>
            <select
              id="rn-plan"
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            >
              <option value="">Select a plan…</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.duration_days}d · {formatCurrency(p.price, defaultCurrency)}
                </option>
              ))}
            </select>
          </div>

          {newEnd && (
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">New expiry: </span>
              <span className="font-medium text-foreground">{newEnd}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rn-fee" className="text-muted-foreground">Fee</Label>
            <Input
              id="rn-fee"
              type="number"
              min={0}
              value={feeAmount}
              onChange={(e) => setFeeAmount(e.target.value)}
              className="bg-muted"
            />
          </div>

          <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={collectPayment}
                onChange={(e) => setCollectPayment(e.target.checked)}
                className="size-4 accent-primary"
              />
              {isConvert ? "Record the first payment" : "Record payment for this renewal"}
            </label>
            {collectPayment && (
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  min={0}
                  value={collectAmount}
                  onChange={(e) => setCollectAmount(e.target.value)}
                  placeholder="Amount"
                  className="h-8 bg-muted"
                />
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                  className="h-8 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleRenew}
            disabled={saving || !selectedPlan}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {isConvert ? "Convert" : "Renew"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
