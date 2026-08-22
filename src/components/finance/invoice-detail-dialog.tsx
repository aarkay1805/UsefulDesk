'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Link2,
  Loader2,
  Repeat,
  RotateCcw,
  ShieldAlert,
  Wallet,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { canRefundGatewayPayments } from '@/lib/auth/roles';
import { getErrorMessage } from '@/lib/errors';
import {
  invoiceHeadline,
  invoiceSummaryRows,
  PAYMENT_REFUND_STATUS_PRESENTATION,
  paymentRefundEventAt,
  paymentRefundOutcome,
} from '@/lib/finance/invoice-detail-presentation';
import type { FinanceInvoiceRow } from '@/lib/finance/invoices';
import { invoiceSourceLabel } from '@/lib/finance/invoices';
import {
  invoicePaymentState,
  isChargeableAmount,
} from '@/lib/memberships/periods';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type {
  InvoiceLine,
  MembershipPeriodInvoice,
  Payment,
  PaymentRefund,
  PaymentMethod,
  Membership,
  Contact,
} from '@/types';
import {
  CopyUpiLinkButton,
  useUpiConfig,
} from '../members/copy-upi-link-button';
import {
  FinanceInvoiceStatusBadge,
  PaymentRefundStatusBadge,
  VoidedPaymentBadge,
} from '../members/membership-status-badge';
import { MemberIdentity } from '../members/member-identity';
import { PaymentProofLink } from '../members/payment-proof-link';
import { useAccountStaff } from '../members/use-account-staff';
import { PaymentLinkActions } from './payment-link-actions';
import { GatewayRefundDialog } from './gateway-refund-dialog';

export type InvoiceDetail = Pick<
  FinanceInvoiceRow,
  | 'id'
  | 'reference'
  | 'source'
  | 'created_at'
  | 'fee_amount'
  | 'amount_paid'
  | 'credit_applied'
  | 'balance'
  | 'state'
  | 'gross_amount_paid'
  | 'processed_refund_amount'
  | 'invoice_adjustment_amount'
  | 'accounting_balance'
  | 'collectible_balance'
  | 'requires_refund_review'
> & {
  membership?: Membership | null;
  contact?: Contact | null;
  lifecycle?: FinanceInvoiceRow['lifecycle'];
  overdue?: boolean;
};

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank: 'Bank transfer',
  other: 'Other',
};

function InvoiceDetailBody({
  invoice,
  member,
  onFinancialChange,
  canVoid,
  onVoidPayment,
}: {
  invoice: InvoiceDetail;
  member?: Membership | null;
  onFinancialChange: (patch: Partial<InvoiceDetail>) => void;
  canVoid: boolean;
  onVoidPayment?: (payment: Payment) => void;
}) {
  const { fmt } = useLocale();
  const { accountRole } = useAuth();
  const canRefund = accountRole ? canRefundGatewayPayments(accountRole) : false;
  const { nameById: staffNameById, avatarById: staffAvatarById } =
    useAccountStaff();
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [periods, setPeriods] = useState<MembershipPeriodInvoice[]>([]);
  const [currentInvoice, setCurrentInvoice] = useState(invoice);
  const [refundsByPayment, setRefundsByPayment] = useState<
    Map<string, PaymentRefund[]>
  >(new Map());
  const [refundScanComplete, setRefundScanComplete] = useState(false);
  const [refundPayment, setRefundPayment] = useState<Payment | null>(null);
  const [classification, setClassification] = useState<{
    payment: Payment;
    refund: PaymentRefund;
  } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setLoadError(null);
      setLines([]);
      setPayments([]);
      setPeriods([]);
      setRefundsByPayment(new Map());

      const supabase = createClient();
      const [lineResult, paymentResult, periodResult, invoiceResult] =
        await Promise.all([
          supabase
            .from('invoice_line_balances')
            .select('*')
            .eq('invoice_id', invoice.id)
            .order('sort_order'),
          supabase
            .from('payments')
            .select('*')
            .eq('invoice_id', invoice.id)
            .order('paid_at', { ascending: false }),
          supabase
            .from('membership_period_invoices')
            .select('*')
            .eq('invoice_id', invoice.id),
          supabase
            .from('invoice_balances')
            .select('*')
            .eq('id', invoice.id)
            .single(),
        ]);
      if (cancelled) return;

      const error =
        lineResult.error ??
        paymentResult.error ??
        periodResult.error ??
        invoiceResult.error;
      if (error) {
        setLoadError(
          getErrorMessage(error, 'Invoice details could not be loaded')
        );
        setLoading(false);
        return;
      }

      setLines((lineResult.data as InvoiceLine[]) ?? []);
      const loadedPayments = (paymentResult.data as Payment[]) ?? [];
      setPayments(loadedPayments);
      setPeriods((periodResult.data as MembershipPeriodInvoice[]) ?? []);
      const financialPatch: Partial<InvoiceDetail> = {
        fee_amount: Number(invoiceResult.data.total),
        amount_paid: Number(invoiceResult.data.amount_paid),
        credit_applied: Number(invoiceResult.data.credit_applied),
        balance: Number(invoiceResult.data.balance),
        gross_amount_paid: Number(invoiceResult.data.gross_amount_paid),
        processed_refund_amount: Number(
          invoiceResult.data.processed_refund_amount
        ),
        invoice_adjustment_amount: Number(
          invoiceResult.data.invoice_adjustment_amount
        ),
        accounting_balance: Number(invoiceResult.data.accounting_balance),
        collectible_balance: Number(invoiceResult.data.collectible_balance),
        requires_refund_review: Boolean(
          invoiceResult.data.requires_refund_review
        ),
      };
      setCurrentInvoice((existing) => ({ ...existing, ...financialPatch }));
      onFinancialChange(financialPatch);

      const gatewayPayments = loadedPayments.filter(
        (payment) =>
          payment.gateway_payment_id &&
          (payment.source === 'auto' || payment.source === 'payment_link')
      );
      const refundResponses = await Promise.all(
        gatewayPayments.map(async (payment) => {
          const response = await fetch(
            `/api/payments/razorpay/refunds?paymentId=${encodeURIComponent(payment.id)}`
          );
          const body = (await response.json()) as {
            refunds?: PaymentRefund[];
            availability?: { initialScanComplete?: boolean };
            error?: string;
          };
          if (!response.ok) {
            throw new Error(body.error ?? 'Refund history could not be loaded');
          }
          return { paymentId: payment.id, ...body };
        })
      );
      if (cancelled) return;
      setRefundsByPayment(
        new Map(
          refundResponses.map((response) => [
            response.paymentId,
            response.refunds ?? [],
          ])
        )
      );
      setRefundScanComplete(
        refundResponses.length === 0 ||
          refundResponses.every(
            (response) => response.availability?.initialScanComplete
          )
      );
      setLoading(false);
    })().catch((error: unknown) => {
      if (cancelled) return;
      setLoadError(
        getErrorMessage(error, 'Invoice details could not be loaded')
      );
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [invoice.id, onFinancialChange, refreshKey]);

  const periodById = useMemo(
    () => new Map(periods.map((period) => [period.id, period])),
    [periods]
  );
  const memberName =
    member?.contact?.name ??
    currentInvoice.membership?.contact?.name ??
    currentInvoice.contact?.name ??
    'Deleted customer';
  const customer =
    member?.contact ??
    currentInvoice.membership?.contact ??
    currentInvoice.contact ??
    null;
  const headline = invoiceHeadline(currentInvoice);
  const summaryRows = invoiceSummaryRows(currentInvoice);
  const headlineDetail = (() => {
    if (headline.detail === 'refund_review') {
      return 'Collection is paused pending review';
    }
    if (headline.detail === 'void') {
      return 'This invoice is not collectible';
    }
    if (headline.detail === 'balance_reopened') {
      return 'A refund reopened this balance';
    }
    if (headline.detail === 'balance_due') {
      if (isChargeableAmount(currentInvoice.credit_applied ?? 0)) {
        return `${fmt.money(currentInvoice.credit_applied ?? 0)} credit applied · ${fmt.money(currentInvoice.fee_amount)} total`;
      }
      return `${fmt.money(currentInvoice.amount_paid)} collected of ${fmt.money(currentInvoice.fee_amount)}`;
    }
    if (headline.detail === 'settled') return 'The invoice is settled';
    return 'Nothing to collect';
  })();

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
        <Loader2 className="size-4 animate-spin" />
        Loading invoice…
      </div>
    );
  }

  if (loadError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load invoice</AlertTitle>
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="min-w-0 space-y-5">
      {currentInvoice.requires_refund_review ? (
        <Alert>
          <ShieldAlert />
          <AlertTitle>Refund review</AlertTitle>
          <AlertDescription>
            Razorpay has processed a refund that is not fully classified. The
            invoice is not collectible, and payment links, reminders, and due
            follow-ups stay blocked until an admin assigns any missing invoice
            lines and classifies the accounting outcome.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card size="sm">
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <div className="min-w-0">
              <MemberIdentity
                name={customer?.name}
                secondary={customer?.phone}
                src={customer?.avatar_url}
                size="lg"
                meta={
                  (member?.member_number ??
                  currentInvoice.membership?.member_number) ? (
                    <p className="text-muted-foreground mt-1 font-mono text-xs tabular-nums">
                      Member ID{' '}
                      {member?.member_number ??
                        currentInvoice.membership?.member_number}
                    </p>
                  ) : null
                }
              />
            </div>
            <div className="sm:text-right">
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {headline.label}
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {fmt.money(headline.amount)}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {headlineDetail}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <h3 className="font-medium">Invoice items</h3>
        <div className="border-border divide-border divide-y rounded-lg border">
          {lines.length === 0 ? (
            <p className="text-muted-foreground px-3 py-4 text-sm">
              No invoice lines are available.
            </p>
          ) : (
            lines.map((line) => {
              const period = line.membership_period_id
                ? periodById.get(line.membership_period_id)
                : null;
              const discountAmount = Number(period?.discount_amount ?? 0);
              const bonusMonths = Number(period?.bonus_months ?? 0);
              const discountLabel =
                period?.discount_type === 'percentage' &&
                period.discount_value != null
                  ? `Discount (${Number(period.discount_value)}%)`
                  : 'Discount';

              return (
                <div
                  key={line.id}
                  className={
                    line.state === 'void' ? 'px-3 py-3 opacity-65' : 'px-3 py-3'
                  }
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">
                          {line.description}
                          {line.quantity > 1 ? ` × ${line.quantity}` : ''}
                        </p>
                        {line.state === 'void' ? (
                          <Badge variant="neutral">Void</Badge>
                        ) : null}
                      </div>
                      {line.service_start && line.service_end ? (
                        <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                          {fmt.date(line.service_start)} –{' '}
                          {fmt.date(line.service_end)}
                        </p>
                      ) : null}
                      {bonusMonths > 0 && period?.standard_period_end ? (
                        <p className="text-muted-foreground mt-0.5 text-xs">
                          Regular expiry {fmt.date(period.standard_period_end)}{' '}
                          · +{bonusMonths}{' '}
                          {bonusMonths === 1 ? 'month' : 'months'}
                        </p>
                      ) : null}
                      {line.override_reason ? (
                        <p className="text-muted-foreground mt-0.5 text-xs">
                          Price override: {line.override_reason}
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right text-sm">
                      {isChargeableAmount(discountAmount) &&
                      line.list_amount != null ? (
                        <p className="text-muted-foreground text-xs tabular-nums line-through">
                          {fmt.money(line.list_amount)}
                        </p>
                      ) : null}
                      <p className="font-medium tabular-nums">
                        {fmt.money(line.line_amount)}
                      </p>
                      {isChargeableAmount(discountAmount) ? (
                        <p className="text-muted-foreground text-xs tabular-nums">
                          {discountLabel} −{fmt.money(discountAmount)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="border-border overflow-hidden rounded-lg border">
        <dl className="divide-border divide-y">
          {summaryRows.map((row) => (
            <div
              key={row.key}
              className={cn(
                'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-3 py-2.5',
                row.emphasis && 'bg-muted/20'
              )}
            >
              <dt
                className={cn(
                  'text-muted-foreground min-w-0',
                  row.emphasis && 'text-foreground font-medium'
                )}
              >
                {row.label}
                {row.collectionBreakdown ? (
                  <span className="mt-0.5 block text-xs font-normal">
                    <span className="tabular-nums">
                      {fmt.money(row.collectionBreakdown.gross)}
                    </span>{' '}
                    collected ·{' '}
                    <span className="tabular-nums">
                      {fmt.money(row.collectionBreakdown.refunded)}
                    </span>{' '}
                    refunded
                  </span>
                ) : null}
              </dt>
              <dd
                className={cn(
                  'text-right font-medium tabular-nums',
                  row.emphasis && 'font-semibold',
                  row.warning && 'text-amber-foreground'
                )}
              >
                {row.sign === 'minus' ? '−' : ''}
                {fmt.money(row.amount)}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <section className="space-y-2" aria-labelledby="payment-history-heading">
        <h3 id="payment-history-heading" className="font-medium">
          Payment history
        </h3>
        {payments.length === 0 ? (
          <div className="border-border rounded-lg border px-3 py-4">
            <p className="text-muted-foreground text-sm">
              No payments recorded for this invoice.
            </p>
          </div>
        ) : (
          <div className="border-border divide-border divide-y rounded-lg border">
            {payments.map((payment) => {
              const refunds = refundsByPayment.get(payment.id) ?? [];
              const capacityUsed = refunds
                .filter((refund) => refund.status !== 'failed')
                .reduce((total, refund) => total + Number(refund.amount), 0);
              const remaining = Math.max(
                0,
                Number(payment.amount) - capacityUsed
              );
              const hasUnallocatedProcessed = refunds.some(
                (refund) =>
                  refund.status === 'processed' && !refund.allocation_complete
              );
              const gatewayPayment = Boolean(
                payment.gateway_payment_id &&
                (payment.source === 'auto' || payment.source === 'payment_link')
              );
              const refundDisabledReason = !refundScanComplete
                ? 'Historical Razorpay refunds are still being reconciled.'
                : hasUnallocatedProcessed
                  ? 'Line targeting is required before another refund can be safely allocated.'
                  : !isChargeableAmount(remaining)
                    ? 'This payment has no remaining refundable amount.'
                    : null;
              return (
                <div
                  key={payment.id}
                  className={cn(
                    'min-w-0 p-3',
                    payment.status === 'void' && 'opacity-65'
                  )}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">
                          {METHOD_LABEL[payment.method]}
                        </p>
                        {payment.status === 'void' ? (
                          <VoidedPaymentBadge
                            payment={payment}
                            voidedOn={
                              payment.voided_at
                                ? fmt.date(payment.voided_at)
                                : null
                            }
                          />
                        ) : null}
                        {payment.source === 'auto' ? (
                          <Badge variant="info">
                            <Repeat className="size-3" /> Auto
                          </Badge>
                        ) : payment.source === 'payment_link' ? (
                          <Badge variant="info">
                            <Link2 className="size-3" /> Payment link
                          </Badge>
                        ) : null}
                      </div>
                      <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
                        <span className="tabular-nums">
                          {fmt.dateTime(payment.paid_at)}
                        </span>
                        {payment.user_id ? (
                          <>
                            <span aria-hidden="true">·</span>
                            {staffNameById.has(payment.user_id) ? (
                              <span className="inline-flex items-center gap-1.5">
                                <span>Recorded by</span>
                                <UserAvatar
                                  name={
                                    staffNameById.get(payment.user_id) ?? '?'
                                  }
                                  src={staffAvatarById.get(payment.user_id)}
                                  size="xs"
                                />
                                <span>
                                  {staffNameById.get(payment.user_id)}
                                </span>
                              </span>
                            ) : (
                              <span>Recorded by Former teammate</span>
                            )}
                          </>
                        ) : payment.source ===
                          'auto' ? null : payment.source === 'payment_link' ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>Collected by Razorpay</span>
                          </>
                        ) : (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>Recorder unavailable</span>
                          </>
                        )}
                      </div>
                      {payment.note ? (
                        <p className="text-muted-foreground mt-2 text-xs">
                          Note: {payment.note}
                        </p>
                      ) : null}
                      {payment.screenshot_url ||
                      payment.screenshot_path ||
                      (payment.status === 'void' && payment.void_reason) ? (
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                          {payment.screenshot_url || payment.screenshot_path ? (
                            <PaymentProofLink payment={payment} />
                          ) : null}
                          {payment.status === 'void' && payment.void_reason ? (
                            <span className="text-muted-foreground">
                              Void reason: {payment.void_reason}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <p
                        className={cn(
                          'font-medium tabular-nums',
                          payment.status === 'void' && 'line-through'
                        )}
                      >
                        {fmt.money(payment.amount)}
                      </p>
                      {payment.status === 'paid' &&
                      payment.source !== 'auto' &&
                      payment.source !== 'payment_link' &&
                      !payment.gateway_payment_id &&
                      canVoid &&
                      onVoidPayment ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onVoidPayment(payment)}
                        >
                          <RotateCcw className="size-3.5" /> Void
                        </Button>
                      ) : null}
                      {payment.status === 'paid' &&
                      gatewayPayment &&
                      canRefund ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={Boolean(refundDisabledReason)}
                          title={refundDisabledReason ?? undefined}
                          onClick={() => setRefundPayment(payment)}
                        >
                          <RotateCcw className="size-3.5" /> Refund
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {refunds.length > 0 ? (
                    <div className="border-border divide-border mt-3 divide-y border-t">
                      {refunds.map((refund) => {
                        const refundStatus =
                          PAYMENT_REFUND_STATUS_PRESENTATION[refund.status];
                        const eventAt = paymentRefundEventAt(refund);
                        const hasAuditDetails = Boolean(
                          refund.reason ||
                          refund.gateway_refund_id ||
                          refund.requested_by
                        );

                        return (
                          <div
                            key={refund.id}
                            className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2.5 py-3 text-xs"
                          >
                            <span className="bg-muted text-muted-foreground mt-0.5 flex size-6 items-center justify-center rounded-md">
                              <RotateCcw className="size-3" />
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                  <PaymentRefundStatusBadge
                                    status={refund.status}
                                  />
                                  <span className="font-medium">
                                    {paymentRefundOutcome(refund)}
                                  </span>
                                </div>
                                <span className="shrink-0 font-semibold tabular-nums">
                                  {refund.status === 'processed' ? '−' : ''}
                                  {fmt.money(refund.amount)}
                                </span>
                              </div>

                              <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                                <time
                                  dateTime={eventAt}
                                  className="tabular-nums"
                                >
                                  {refundStatus.eventLabel}{' '}
                                  {fmt.dateTime(eventAt)}
                                </time>
                                {refund.source === 'razorpay_dashboard' ? (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>Razorpay Dashboard</span>
                                  </>
                                ) : null}
                              </p>

                              {hasAuditDetails ? (
                                <dl className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">
                                  {refund.reason ? (
                                    <div className="min-w-0 sm:col-span-2">
                                      <dt className="text-muted-foreground">
                                        Reason
                                      </dt>
                                      <dd className="mt-0.5">
                                        {refund.reason}
                                      </dd>
                                    </div>
                                  ) : null}
                                  {refund.gateway_refund_id ? (
                                    <div className="min-w-0">
                                      <dt className="text-muted-foreground">
                                        Provider reference
                                      </dt>
                                      <dd className="mt-0.5 font-mono break-all">
                                        {refund.gateway_refund_id}
                                      </dd>
                                    </div>
                                  ) : null}
                                  {refund.requested_by ? (
                                    <div className="min-w-0">
                                      <dt className="text-muted-foreground">
                                        Requested by
                                      </dt>
                                      <dd className="mt-0.5">
                                        {staffNameById.get(
                                          refund.requested_by
                                        ) ?? 'Former teammate'}
                                      </dd>
                                    </div>
                                  ) : null}
                                </dl>
                              ) : null}

                              {canRefund &&
                              refund.source === 'razorpay_dashboard' &&
                              refund.status === 'processed' &&
                              !refund.disposition ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="mt-3"
                                  onClick={() =>
                                    setClassification({ payment, refund })
                                  }
                                >
                                  {refund.allocation_complete
                                    ? 'Classify refund'
                                    : 'Resolve refund review'}
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {refundPayment ? (
        <GatewayRefundDialog
          key={refundPayment.id}
          payment={refundPayment}
          amount={Math.max(
            0,
            Number(refundPayment.amount) -
              (refundsByPayment.get(refundPayment.id) ?? [])
                .filter((refund) => refund.status !== 'failed')
                .reduce((total, refund) => total + Number(refund.amount), 0)
          )}
          invoiceReference={currentInvoice.reference}
          memberName={memberName}
          open
          onOpenChange={(next) => {
            if (!next) setRefundPayment(null);
          }}
          onCompleted={() => setRefreshKey((key) => key + 1)}
        />
      ) : null}
      {classification ? (
        <GatewayRefundDialog
          key={classification.refund.id}
          payment={classification.payment}
          refund={classification.refund}
          amount={Number(classification.refund.amount)}
          invoiceReference={currentInvoice.reference}
          memberName={memberName}
          open
          onOpenChange={(next) => {
            if (!next) setClassification(null);
          }}
          onCompleted={() => setRefreshKey((key) => key + 1)}
        />
      ) : null}
    </div>
  );
}

export function InvoiceDetailDialog({
  invoice,
  open,
  onOpenChange,
  canRecord,
  canVoid = false,
  member,
  onRecord,
  onVoidPayment,
}: {
  invoice: InvoiceDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canRecord: boolean;
  canVoid?: boolean;
  member?: Membership | null;
  onRecord: () => void;
  onVoidPayment?: (payment: Payment) => void;
}) {
  const { fmt } = useLocale();
  const upi = useUpiConfig();
  const [financialInvoice, setFinancialInvoice] =
    useState<InvoiceDetail | null>(invoice);
  const activeInvoice =
    financialInvoice?.id === invoice?.id ? financialInvoice : invoice;
  const handleFinancialChange = useCallback(
    (patch: Partial<InvoiceDetail>) => {
      if (!invoice) return;
      setFinancialInvoice((current) =>
        current?.id === invoice.id
          ? { ...current, ...patch }
          : { ...invoice, ...patch }
      );
    },
    [invoice]
  );
  const collectible =
    !!activeInvoice &&
    activeInvoice.state === 'open' &&
    !activeInvoice.requires_refund_review &&
    isChargeableAmount(
      activeInvoice.collectible_balance ?? activeInvoice.balance
    ) &&
    canRecord;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-[35rem]">
        <DialogHeader className="min-w-0">
          <DialogTitle size="lg" className="flex flex-wrap items-center gap-2">
            <span>{invoice ? `Invoice ${invoice.reference}` : 'Invoice'}</span>
            {activeInvoice ? (
              <FinanceInvoiceStatusBadge
                state={activeInvoice.state}
                paymentState={invoicePaymentState(activeInvoice)}
                lifecycle={activeInvoice.lifecycle}
                overdue={activeInvoice.overdue}
                requiresRefundReview={activeInvoice.requires_refund_review}
              />
            ) : null}
          </DialogTitle>
          <DialogDescription>
            {invoice?.source ? invoiceSourceLabel(invoice.source) : 'Invoice'} ·
            issued {invoice ? fmt.date(invoice.created_at) : '—'}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 min-h-0 min-w-0 overflow-y-auto px-1 py-1">
          {invoice ? (
            <InvoiceDetailBody
              key={invoice.id}
              invoice={invoice}
              member={member ?? invoice.membership ?? null}
              onFinancialChange={handleFinancialChange}
              canVoid={canVoid}
              onVoidPayment={onVoidPayment}
            />
          ) : null}
        </div>

        <DialogFooter className="min-w-0 sm:flex-wrap">
          {collectible ? (
            <>
              <PaymentLinkActions
                key={invoice!.id}
                invoice={activeInvoice!}
                member={member ?? activeInvoice!.membership ?? null}
              />
              <CopyUpiLinkButton
                upi={upi}
                amount={Number(
                  activeInvoice!.collectible_balance ?? activeInvoice!.balance
                )}
                note={`Invoice ${activeInvoice!.reference}`}
                size="default"
              />
              <Button type="button" onClick={onRecord}>
                <Wallet className="size-4" /> Record payment
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
