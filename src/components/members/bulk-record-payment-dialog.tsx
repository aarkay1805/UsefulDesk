"use client";

// BulkRecordPaymentDialog — settle fees for every selected member at
// once. "Record payments" writes one authoritative ledger row per member
// for their outstanding balance. fee_status is derived by the database;
// there is intentionally no ledger-less "mark paid" escape hatch.
// Members with nothing outstanding are skipped, not failed; the toast
// reports the tally. Updates chain .select('id') — an RLS-blocked write
// returns zero rows, and that must read as failure, never silent success.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useLocale } from "@/hooks/use-locale";
import { dateAtNoonInTz } from "@/lib/locale/format";
import { isChargeableAmount } from "@/lib/memberships/periods";
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
import { DatePicker } from "@/components/ui/date-picker";
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
  const { accountId, user } = useAuth();
  const { locale, fmt } = useLocale();

  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [paidOn, setPaidOn] = useState(fmt.today());
  const [saving, setSaving] = useState(false);
  // Selected memberships joined with their outstanding balances.
  const [rows, setRows] = useState<{ membership: Membership; balance: number }[] | null>(null);

  // Fresh form each open — render-time reset (repo lint forbids setState
  // directly in effects for this).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setMethod("cash");
      setPaidOn(fmt.today());
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
        ((dues as { membership_id: string; balance: number }[]) ?? []).map((d) => [
          d.membership_id,
          Number(d.balance),
        ]),
      );
      setRows(
        ((memberships as Membership[]) ?? []).map((m) => ({
          membership: m,
          // No dues row → nothing collected this period → full fee due.
          balance: balanceById.get(m.id) ?? Number(m.fee_amount ?? 0),
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [open, membershipIds, supabase]);

  // Sub-display-unit residues (₹0.32 plan-change stubs) render as ₹0 and
  // the ledger rejects a payment against them — they count as settled.
  const due = (rows ?? []).filter((r) => isChargeableAmount(r.balance));
  const totalDue = due.reduce((s, r) => s + r.balance, 0);
  const settled = (rows?.length ?? 0) - due.length;

  async function recordPayments() {
    if (!accountId || !user || due.length === 0) return;
    if (paidOn > fmt.today()) return toast.error("The payment date cannot be in the future");
    setSaving(true);
    // Anchor the picked calendar day at noon in the ACCOUNT's zone so it
    // reads back on the same day (same recipe as RecordPaymentDialog).
    const paidAt = (dateAtNoonInTz(paidOn, locale.timeZone) ?? new Date()).toISOString();

    let recorded = 0;
    const failedNames: string[] = [];
    // Per-member transactional RPC so one blocked row doesn't sink the batch.
    for (const { membership, balance } of due) {
      const { error: pErr } = await supabase.rpc("record_membership_payment", {
        p_membership_id: membership.id,
        p_period_end: membership.end_date,
        p_amount: balance,
        p_method: method,
        p_paid_at: paidAt,
        p_note: "Bulk payment",
        p_receipt_path: null,
        p_idempotency_key: crypto.randomUUID(),
      });
      if (pErr) {
        failedNames.push(membership.contact?.name || membership.contact?.phone || "Unnamed member");
        continue;
      }
      recorded++;
    }
    setSaving(false);

    const parts = [`${recorded} payment${recorded === 1 ? "" : "s"} recorded`];
    if (settled) parts.push(`${settled} already settled`);
    if (failedNames.length) {
      // Name WHO failed — "2 failed" leaves the owner hunting.
      const shown = failedNames.slice(0, 3).join(", ");
      const extra = failedNames.length > 3 ? ` +${failedNames.length - 3} more` : "";
      parts.push(`failed: ${shown}${extra}`);
    }
    (failedNames.length && !recorded ? toast.error : toast.success)(parts.join(" · "));
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Record payments</DialogTitle>
          <DialogDescription>
            Settle the outstanding balance for {membershipIds.length} selected member
            {membershipIds.length === 1 ? "" : "s"}.
          </DialogDescription>
        </DialogHeader>

        {rows === null ? (
          <div className="text-muted-foreground flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="border-border bg-muted/40 rounded-lg border px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Outstanding</span>
                <span className="font-medium text-amber-foreground tabular-nums">
                  {fmt.money(totalDue)} · {due.length} member
                  {due.length === 1 ? "" : "s"}
                </span>
              </div>
              {settled > 0 && (
                <p className="text-muted-foreground mt-1 text-xs">
                  {settled} selected member{settled === 1 ? " has" : "s have"} nothing due and will
                  be skipped.
                </p>
              )}
            </div>

            {/* Per-member preview — the owner sees exactly who gets
                charged what BEFORE committing, not one aggregate. */}
            {due.length > 0 && (
              <div className="border-border max-h-44 overflow-y-auto rounded-lg border">
                <ul className="divide-border divide-y">
                  {due.map(({ membership, balance }) => (
                    <li
                      key={membership.id}
                      className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm"
                    >
                      <span className="text-foreground min-w-0 truncate">
                        {membership.contact?.name ||
                          membership.contact?.phone ||
                          "Unnamed member"}
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">
                        {fmt.money(balance)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="brp-method" className="text-muted-foreground">
                  Method
                </Label>
                <Select
                  value={method}
                  onValueChange={(v) => setMethod(v as PaymentMethod)}
                >
                  <SelectTrigger id="brp-method" className="w-full">
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
              <div className="space-y-1.5">
                <Label htmlFor="brp-date" className="text-muted-foreground">
                  Paid on
                </Label>
                <DatePicker
                  id="brp-date"
                  value={paidOn}
                  max={fmt.today()}
                  onChange={setPaidOn}
                />
              </div>
            </div>

            <p className="text-muted-foreground text-xs">
              Each member&apos;s payment is recorded for their own outstanding balance and
              immediately reconciled to their billing period.
            </p>
          </div>
        )}

        <DialogFooter>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={recordPayments}
              disabled={saving || rows === null || due.length === 0}
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
