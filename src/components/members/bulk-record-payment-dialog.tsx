"use client";

// BulkRecordPaymentDialog — settle fees for every selected member at
// once. Two explicit actions so the books stay honest:
//   · "Record payments" inserts one payments-ledger row per member for
//     their outstanding balance (membership_dues), then marks them paid —
//     the bulk sibling of RecordPaymentDialog's insert.
//   · "Mark paid only" just flips fee_status (no ledger row) for owners
//     reconciling outside the app.
// Members with nothing outstanding are skipped, not failed; the toast
// reports the tally. Updates chain .select('id') — an RLS-blocked write
// returns zero rows, and that must read as failure, never silent success.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import { istToday } from "@/lib/memberships/expiry";
import type { Membership, PaymentMethod } from "@/types";
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

interface BulkRecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  membershipIds: string[];
  /** Called after any write so the page can refresh. */
  onDone: () => void;
}

export function BulkRecordPaymentDialog({
  open,
  onOpenChange,
  membershipIds,
  onDone,
}: BulkRecordPaymentDialogProps) {
  const supabase = createClient();
  const { accountId, user, defaultCurrency } = useAuth();

  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [paidOn, setPaidOn] = useState(istToday());
  const [saving, setSaving] = useState(false);
  // Selected memberships joined with their outstanding balances.
  const [rows, setRows] = useState<
    { membership: Membership; balance: number }[] | null
  >(null);

  // Fresh form each open — render-time reset (repo lint forbids setState
  // directly in effects for this).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setMethod("cash");
      setPaidOn(istToday());
      setSaving(false);
      setRows(null);
    }
  }

  useEffect(() => {
    if (!open || membershipIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const [{ data: memberships }, { data: dues }] = await Promise.all([
        supabase
          .from("memberships")
          .select("*, contact:contacts(*), plan:membership_plans(*)")
          .in("id", membershipIds),
        supabase
          .from("membership_dues")
          .select("membership_id, balance")
          .in("membership_id", membershipIds),
      ]);
      if (cancelled) return;
      const balanceById = new Map(
        ((dues as { membership_id: string; balance: number }[]) ?? []).map(
          (d) => [d.membership_id, Number(d.balance)]
        )
      );
      setRows(
        ((memberships as Membership[]) ?? []).map((m) => ({
          membership: m,
          // No dues row → nothing collected this period → full fee due.
          balance: balanceById.get(m.id) ?? Number(m.fee_amount ?? 0),
        }))
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [open, membershipIds, supabase]);

  const due = (rows ?? []).filter((r) => r.balance > 0);
  const totalDue = due.reduce((s, r) => s + r.balance, 0);
  const settled = (rows?.length ?? 0) - due.length;

  async function markPaidOnly() {
    if (due.length === 0) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("memberships")
      .update({ fee_status: "paid" })
      .in(
        "id",
        due.map((r) => r.membership.id)
      )
      .select("id");
    setSaving(false);
    if (error || !data || data.length === 0) {
      toast.error("Failed to mark members paid — you may not have permission.");
      return;
    }
    const skipped = due.length - data.length;
    toast.success(
      `${data.length} member${data.length === 1 ? "" : "s"} marked paid` +
        (skipped ? ` · ${skipped} blocked` : "")
    );
    onOpenChange(false);
    onDone();
  }

  async function recordPayments() {
    if (!accountId || !user || due.length === 0) return;
    setSaving(true);
    // Anchor the picked calendar day at noon UTC so it lands on the same
    // IST day it was chosen for (same recipe as RecordPaymentDialog).
    const paidAt = `${paidOn}T12:00:00.000Z`;

    let recorded = 0;
    let failed = 0;
    // Per-member insert+flip so one blocked row doesn't sink the batch.
    for (const { membership, balance } of due) {
      const { error: pErr } = await supabase.from("payments").insert({
        account_id: accountId,
        membership_id: membership.id,
        contact_id: membership.contact_id,
        plan_id: membership.plan_id,
        user_id: user.id,
        amount: balance,
        method,
        status: "paid",
        paid_at: paidAt,
        period_start: membership.start_date,
        period_end: membership.end_date,
      });
      if (pErr) {
        failed++;
        continue;
      }
      const { data: updated } = await supabase
        .from("memberships")
        .update({ fee_status: "paid" })
        .eq("id", membership.id)
        .select("id");
      if (!updated || updated.length === 0) {
        // Ledger row landed but the flip was blocked — count it as
        // recorded; the dues view still shows the true balance.
        recorded++;
        continue;
      }
      recorded++;
    }
    setSaving(false);

    const parts = [
      `${recorded} payment${recorded === 1 ? "" : "s"} recorded`,
    ];
    if (settled) parts.push(`${settled} already settled`);
    if (failed) parts.push(`${failed} failed`);
    (failed && !recorded ? toast.error : toast.success)(parts.join(" · "));
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Record payments</DialogTitle>
          <DialogDescription>
            Settle the outstanding balance for {membershipIds.length} selected
            member{membershipIds.length === 1 ? "" : "s"}.
          </DialogDescription>
        </DialogHeader>

        {rows === null ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Outstanding</span>
                <span className="font-medium text-amber-700 dark:text-amber-400">
                  {formatCurrency(totalDue, defaultCurrency)} · {due.length}{" "}
                  member{due.length === 1 ? "" : "s"}
                </span>
              </div>
              {settled > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {settled} selected member{settled === 1 ? " has" : "s have"}{" "}
                  nothing due and will be skipped.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="brp-method" className="text-muted-foreground">
                  Method
                </Label>
                <select
                  id="brp-method"
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="brp-date" className="text-muted-foreground">
                  Paid on
                </Label>
                <Input
                  id="brp-date"
                  type="date"
                  value={paidOn}
                  onChange={(e) => setPaidOn(e.target.value)}
                  className="bg-muted"
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Each member&apos;s payment is recorded for their own outstanding
              balance. Use &ldquo;Mark paid only&rdquo; if the money was
              reconciled outside UsefulDesk.
            </p>
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={markPaidOnly}
            disabled={saving || rows === null || due.length === 0}
            className="text-muted-foreground hover:text-foreground"
          >
            Mark paid only
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={recordPayments}
              disabled={saving || rows === null || due.length === 0}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              Record payments
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
