"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2, RefreshCw, Wallet } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/hooks/use-locale";
import {
  isProjectedInvoice,
  periodStatus,
} from "@/lib/memberships/periods";
import type {
  MembershipPeriodInvoice,
  Payment,
  PaymentMethod,
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
import { InvoiceStatusBadge } from "./membership-status-badge";

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

  const projected = invoice ? isProjectedInvoice(invoice.id) : false;

  useEffect(() => {
    // Projected (upcoming) invoices have no persisted payments; the JSX
    // renders the projected branch, so stale rows are never shown.
    if (!open || !invoice || projected) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Payments reconcile to a period by matching period_end (the same
      // key the invoice view uses).
      const { data } = await supabase
        .from("payments")
        .select("*")
        .eq("membership_id", invoice.membership_id)
        .eq("period_end", invoice.period_end)
        .order("paid_at", { ascending: false });
      if (cancelled) return;
      setPayments((data as Payment[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, invoice, projected, supabase]);

  if (!invoice) return null;

  const today = fmt.today();
  const status = periodStatus(invoice, today);
  const balance = Number(invoice.balance);
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
            <InvoiceStatusBadge status={status} />
          </div>
          <DialogDescription>
            {fmt.date(invoice.period_start)} – {fmt.date(invoice.period_end)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Money summary */}
          <dl className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
            <div>
              <dt className="text-xs text-muted-foreground">Invoice total</dt>
              <dd className="mt-0.5 text-sm font-semibold tabular-nums">
                {fmt.money(invoice.fee_amount)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Paid</dt>
              <dd className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                {fmt.money(Math.max(amountPaid, 0))}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Balance</dt>
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
            <p className="text-sm text-muted-foreground">
              Not billed yet — this is the next cycle. Renew to collect it.
            </p>
          ) : loading ? (
            <div className="flex justify-center py-4 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No payments recorded for this period yet.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {payments.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <span className="text-muted-foreground">{fmt.date(p.paid_at)}</span>
                  <span className="text-muted-foreground">{METHOD_LABEL[p.method]}</span>
                  <span className="flex-1 truncate text-muted-foreground">
                    {p.note || ""}
                  </span>
                  {p.screenshot_url && (
                    <a
                      href={p.screenshot_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground"
                      title="View screenshot"
                    >
                      <ExternalLink className="size-4" />
                    </a>
                  )}
                  <span className="font-medium tabular-nums">{fmt.money(p.amount)}</span>
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
