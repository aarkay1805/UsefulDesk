"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Wallet } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/hooks/use-locale";
import { isProjectedInvoice } from "@/lib/memberships/periods";
import type { MembershipPeriodInvoice, Payment, PaymentMethod } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PaymentProofLink } from "./payment-proof-link";
import { VoidedPaymentBadge } from "./membership-status-badge";

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  bank: "Bank",
  other: "Other",
};

interface InvoiceDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: MembershipPeriodInvoice | null;
  /** Whether the member can record payments / renew (gated by canSendMessages). */
  canAct: boolean;
  /** Settle this invoice — opens the record-payment flow for its period. */
  onRecord: (invoice: MembershipPeriodInvoice) => void;
  /** Renew the membership — used for a projected (upcoming) invoice. */
  onRenew: () => void;
}

/**
 * Read-only detail for one billing period (invoice) — its status, the
 * money owed/collected, and the payments that reconcile to it. A
 * centered Dialog (not a nested drawer) since it opens over the member
 * detail Sheet. The footer routes back up to the Payments section to
 * record a payment or renew (a projected upcoming invoice → Renew).
 */
export function InvoiceDetailDialog({
  open,
  onOpenChange,
  invoice,
  canAct,
  onRecord,
  onRenew,
}: InvoiceDetailDialogProps) {
  const supabase = createClient();
  const { fmt } = useLocale();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const projected = invoice ? isProjectedInvoice(invoice.id) : false;

  useEffect(() => {
    // Projected (upcoming) invoices have no persisted payments; the JSX
    // renders the projected branch, so stale rows are never shown.
    if (!open || !invoice || projected) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      // Payments reconcile to a period by matching period_end (the same
      // key the invoice view uses).
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .eq("membership_id", invoice.membership_id)
        .eq("period_end", invoice.period_end)
        .order("paid_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        setPayments([]);
        setLoadError(error.message);
        setLoading(false);
        return;
      }
      setPayments((data as Payment[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, invoice, projected, supabase]);

  if (!invoice) return null;

  const today = fmt.today();
  const balance = Number(invoice.balance);
  const lifecycle =
    invoice.state === "void" ? "Void" : invoice.period_start > today ? "Upcoming" : "Issued";
  // Use the view's reconciled total, not fee − balance: a period can be
  // OVER-paid (old data stamped several payments onto one period_end), so
  // fee − balance would understate what the payment list below actually sums to.
  const amountPaid = Number(invoice.amount_paid);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>Invoice</DialogTitle>
            <Badge variant={projected ? "info" : balance <= 0 ? "success" : "warning"}>
              {projected ? "Estimate" : balance <= 0 ? "Paid" : "Due"}
            </Badge>
            <Badge
              variant={
                lifecycle === "Void" ? "neutral" : lifecycle === "Upcoming" ? "info" : "secondary"
              }
            >
              {lifecycle}
            </Badge>
          </div>
          <DialogDescription>
            {fmt.date(invoice.period_start)} – {fmt.date(invoice.period_end)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Money summary */}
          <dl className="border-border bg-muted/30 grid grid-cols-3 gap-3 rounded-lg border px-3 py-2.5">
            <div>
              <dt className="text-muted-foreground text-xs">Invoice total</dt>
              <dd className="mt-0.5 text-sm font-semibold tabular-nums">
                {fmt.money(invoice.fee_amount)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Paid</dt>
              <dd className="mt-0.5 text-sm font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">
                {fmt.money(Math.max(amountPaid, 0))}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Balance</dt>
              <dd
                className={`mt-0.5 text-sm font-semibold tabular-nums ${
                  balance > 0 ? "text-amber-700 dark:text-amber-400" : "text-foreground"
                }`}
              >
                {fmt.money(balance)}
              </dd>
            </div>
          </dl>

          {/* Payments in this period */}
          {projected ? (
            <p className="text-muted-foreground text-sm">
              Not billed yet — this is the next cycle. Renew to collect it.
            </p>
          ) : loading ? (
            <div className="text-muted-foreground flex justify-center py-4">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : loadError ? (
            <p
              className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm"
              role="alert"
            >
              Could not load this period&apos;s transactions: {loadError}
            </p>
          ) : payments.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No payments recorded for this period yet.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {payments.map((p) => (
                <div
                  key={p.id}
                  className={
                    p.status === "void"
                      ? "border-border flex items-center gap-3 rounded-lg border px-3 py-2 text-sm opacity-65"
                      : "border-border flex items-center gap-3 rounded-lg border px-3 py-2 text-sm"
                  }
                >
                  <span className="text-muted-foreground">{fmt.date(p.paid_at)}</span>
                  <span className="text-muted-foreground">{METHOD_LABEL[p.method]}</span>
                  <span className="text-muted-foreground flex-1 truncate">{p.note || ""}</span>
                  {p.status === "void" && (
                    <VoidedPaymentBadge
                      payment={p}
                      voidedOn={p.voided_at ? fmt.date(p.voided_at) : null}
                    />
                  )}
                  <PaymentProofLink payment={p} />
                  <span
                    className={
                      p.status === "void"
                        ? "font-medium tabular-nums line-through"
                        : "font-medium tabular-nums"
                    }
                  >
                    {fmt.money(p.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {canAct && projected && (
            <Button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onRenew();
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <RefreshCw className="size-4" /> Renew
            </Button>
          )}
          {canAct && !projected && balance > 0 && invoice.state !== "void" && (
            <Button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onRecord(invoice);
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Wallet className="size-4" /> Record payment
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
