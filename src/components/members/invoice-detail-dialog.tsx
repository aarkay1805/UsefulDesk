"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Loader2, RefreshCw, RotateCcw, Wallet } from "lucide-react";

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
import { UserAvatar } from "@/components/ui/user-avatar";
import { PaymentProofLink } from "./payment-proof-link";
import { VoidedPaymentBadge } from "./membership-status-badge";
import { CopyUpiLinkButton, useUpiConfig } from "./copy-upi-link-button";
import { useAccountStaff } from "./use-account-staff";

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
  /** The membership's live end_date — marks which persisted period is "Current". */
  membershipEndDate?: string | null;
  /** Admin-only payment correction (canCorrectPayments). */
  canVoid?: boolean;
  /** Open the void flow for one of this period's payments. */
  onVoidPayment?: (payment: Payment) => void;
  /** Settle this invoice — opens the record-payment flow for its period. */
  onRecord: (invoice: MembershipPeriodInvoice) => void;
  /** Renew the membership — used for a projected (upcoming) invoice. */
  onRenew: () => void;
}

/** One label-left / value-right line of the invoice summary. */
function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-right text-sm font-medium">{children}</dd>
    </div>
  );
}

/**
 * Detail for one billing period (invoice): a label/value summary of
 * everything the table row shows (period, totals, payment + cycle
 * state) over the period's reconciled transactions — this is THE
 * transactions surface for a cycle (the Payments card lists invoices
 * only). A centered Dialog (not a nested drawer) since it opens over
 * the member detail Sheet. Footer routes to Record payment / Renew;
 * admins can void a payment right from its row here.
 */
export function InvoiceDetailDialog({
  open,
  onOpenChange,
  invoice,
  canAct,
  membershipEndDate,
  canVoid = false,
  onVoidPayment,
  onRecord,
  onRenew,
}: InvoiceDetailDialogProps) {
  const supabase = createClient();
  const { fmt } = useLocale();
  const upi = useUpiConfig();
  const { nameById: staffNameById, avatarById: staffAvatarById } = useAccountStaff();
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
  // Same two-axis read as the invoice table: payment state + cycle
  // lifecycle, so the modal mirrors the row it opened from.
  const lifecycle =
    invoice.state === "void"
      ? "Void"
      : invoice.period_start > today
        ? "Upcoming"
        : invoice.period_end === membershipEndDate
          ? "Current"
          : "Past";
  // Use the view's reconciled total, not fee − balance: a period can be
  // OVER-paid (old data stamped several payments onto one period_end), so
  // fee − balance would understate what the payment list below actually sums to.
  const amountPaid = Number(invoice.amount_paid);
  // Footer "Void payment" needs an unambiguous target — only offered
  // when the period has exactly one live payment (the common case).
  // Voiding corrects money already OWED, so a not-yet-started (Upcoming)
  // cycle never offers it — its rare mis-record is voided once current.
  const voidablePayments = payments.filter((p) => p.status === "paid");
  const voidableCount = voidablePayments.length;
  const showVoid =
    canVoid &&
    !!onVoidPayment &&
    !projected &&
    !loading &&
    voidableCount === 1 &&
    (lifecycle === "Current" || lifecycle === "Past");
  const showRenew = canAct && projected;
  const showCollect = canAct && !projected && balance > 0 && invoice.state !== "void";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invoice</DialogTitle>
          <DialogDescription>
            {fmt.date(invoice.period_start)} – {fmt.date(invoice.period_end)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Summary — every fact from the invoice row, labels left. */}
          <dl className="border-border divide-border bg-muted/20 divide-y rounded-lg border">
            <SummaryRow label="Period">
              {fmt.date(invoice.period_start)} – {fmt.date(invoice.period_end)}
            </SummaryRow>
            <SummaryRow label="Invoice total">
              <span className="tabular-nums">{fmt.money(invoice.fee_amount)}</span>
            </SummaryRow>
            <SummaryRow label="Paid">
              <span className="text-emerald-700 tabular-nums dark:text-emerald-400">
                {fmt.money(Math.max(amountPaid, 0))}
              </span>
            </SummaryRow>
            <SummaryRow label="Balance">
              <span
                className={
                  balance > 0
                    ? "text-amber-700 tabular-nums dark:text-amber-400"
                    : "tabular-nums"
                }
              >
                {fmt.money(balance)}
              </span>
            </SummaryRow>
            <SummaryRow label="Payment">
              <Badge variant={projected ? "info" : balance <= 0 ? "success" : "warning"}>
                {projected ? "Estimate" : balance <= 0 ? "Paid" : "Due"}
              </Badge>
            </SummaryRow>
            <SummaryRow label="Cycle">
              <Badge
                variant={
                  lifecycle === "Void" ? "neutral" : lifecycle === "Upcoming" ? "info" : "secondary"
                }
              >
                {lifecycle}
              </Badge>
            </SummaryRow>
          </dl>

          {/* Transactions — same label/value table style as the invoice
              summary, one group box per payment, whitespace between
              groups. Voiding lives in the FOOTER for the common
              one-payment cycle; only a multi-payment period puts a small
              Void on each group (the footer can't disambiguate). */}
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
            payments.map((p, i) => (
              <div key={p.id} className={p.status === "void" ? "opacity-65" : undefined}>
                <div className="mb-1.5 flex items-center gap-2">
                  <h4 className="text-sm font-medium">
                    {payments.length > 1 ? `Payment ${payments.length - i}` : "Payment"}
                  </h4>
                  {p.status === "void" && (
                    <VoidedPaymentBadge
                      payment={p}
                      voidedOn={p.voided_at ? fmt.date(p.voided_at) : null}
                    />
                  )}
                  {p.status === "paid" &&
                    canVoid &&
                    onVoidPayment &&
                    voidableCount > 1 &&
                    lifecycle !== "Upcoming" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      onClick={() => onVoidPayment(p)}
                    >
                      <RotateCcw className="size-3.5" /> Void
                    </Button>
                  )}
                </div>
                <dl className="border-border divide-border divide-y rounded-lg border">
                  <SummaryRow label="Paid on">{fmt.date(p.paid_at)}</SummaryRow>
                  <SummaryRow label="Method">{METHOD_LABEL[p.method]}</SummaryRow>
                  <SummaryRow label="Amount">
                    <span
                      className={
                        p.status === "void" ? "tabular-nums line-through" : "tabular-nums"
                      }
                    >
                      {fmt.money(p.amount)}
                    </span>
                  </SummaryRow>
                  {!p.user_id ? (
                    <SummaryRow label="Recorded by">Auto-pay</SummaryRow>
                  ) : (
                    staffNameById.has(p.user_id) && (
                      <SummaryRow label="Recorded by">
                        <span className="inline-flex items-center gap-1.5">
                          <UserAvatar
                            name={staffNameById.get(p.user_id) ?? "?"}
                            src={staffAvatarById.get(p.user_id)}
                            className="size-5"
                            fallbackClassName="text-[9px]"
                          />
                          {staffNameById.get(p.user_id)}
                        </span>
                      </SummaryRow>
                    )
                  )}
                  {p.note && <SummaryRow label="Note">{p.note}</SummaryRow>}
                  {(p.screenshot_url || p.screenshot_path) && (
                    <SummaryRow label="Receipt">
                      <PaymentProofLink payment={p} />
                    </SummaryRow>
                  )}
                  {p.status === "void" && p.void_reason && (
                    <SummaryRow label="Void reason">
                      <span className="text-muted-foreground">{p.void_reason}</span>
                    </SummaryRow>
                  )}
                </dl>
              </div>
            ))
          )}
        </div>

        {/* No Close button — the sheet's top-right dismiss covers it; the
            footer exists only when there's a real action, else it's
            omitted entirely (no empty strip). */}
        {(showVoid || showRenew || showCollect) && (
          <DialogFooter>
            {showVoid && (
              <Button
                type="button"
                variant="outline"
                className="text-destructive sm:mr-auto"
                onClick={() => onVoidPayment!(voidablePayments[0])}
              >
                <RotateCcw className="size-4" /> Void payment
              </Button>
            )}
            {showRenew && (
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
            {showCollect && (
              <>
                {/* Arrears are exactly when a payment link gets sent —
                    same Copy-UPI as the current-cycle header, for THIS
                    period's outstanding balance. */}
                <CopyUpiLinkButton
                  upi={upi}
                  amount={balance}
                  note="Membership fee"
                  size="default"
                />
                <Button
                  type="button"
                  onClick={() => {
                    onOpenChange(false);
                    onRecord(invoice);
                  }}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <Wallet className="size-4" />
                  {lifecycle === "Upcoming" ? "Collect payment" : "Record payment"}
                </Button>
              </>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
