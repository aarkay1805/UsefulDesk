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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from '@/components/ui/table';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { canRefundGatewayPayments } from '@/lib/auth/roles';
import { getErrorMessage } from '@/lib/errors';
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
} from '@/types';
import {
  CopyUpiLinkButton,
  useUpiConfig,
} from '../members/copy-upi-link-button';
import {
  InvoicePaymentBadge,
  VoidedPaymentBadge,
} from '../members/membership-status-badge';
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
> & { membership?: Membership | null };

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
  const showCredit = isChargeableAmount(currentInvoice.credit_applied ?? 0);
  const hasBalance = isChargeableAmount(currentInvoice.balance);
  const showAmountPaid = isChargeableAmount(currentInvoice.amount_paid);
  const processedRefundAmount = Number(
    currentInvoice.processed_refund_amount ?? 0
  );
  const memberName =
    member?.contact?.name ??
    currentInvoice.membership?.contact?.name ??
    'Deleted member';

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
    <div className="space-y-5">
      {currentInvoice.requires_refund_review ? (
        <Alert>
          <ShieldAlert />
          <AlertTitle>Refund review</AlertTitle>
          <AlertDescription>
            Razorpay has processed a refund that is not fully classified. The
            invoice is not collectible, and payment links, reminders, and due
            follow-ups stay blocked until a supported full refund is classified.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <p className="font-medium">Items</p>
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
        <Table>
          <TableBody>
            <TableRow>
              <TableHead scope="row" className="pl-3">
                Invoice total
              </TableHead>
              <TableCell className="pr-3 text-right font-semibold tabular-nums">
                {fmt.money(currentInvoice.fee_amount)}
              </TableCell>
            </TableRow>
            {showAmountPaid ? (
              <TableRow>
                <TableHead scope="row" className="pl-3">
                  Paid
                </TableHead>
                <TableCell className="pr-3 text-right font-medium tabular-nums">
                  {fmt.money(currentInvoice.amount_paid)}
                </TableCell>
              </TableRow>
            ) : null}
            {isChargeableAmount(
              Number(currentInvoice.gross_amount_paid ?? 0) -
                Number(currentInvoice.amount_paid ?? 0)
            ) ? (
              <TableRow>
                <TableHead scope="row" className="pl-3">
                  Gross collected
                </TableHead>
                <TableCell className="pr-3 text-right font-medium tabular-nums">
                  {fmt.money(currentInvoice.gross_amount_paid ?? 0)}
                </TableCell>
              </TableRow>
            ) : null}
            {isChargeableAmount(processedRefundAmount) ? (
              <TableRow>
                <TableHead scope="row" className="pl-3">
                  Processed refunds
                </TableHead>
                <TableCell className="pr-3 text-right font-medium tabular-nums">
                  −{fmt.money(processedRefundAmount)}
                </TableCell>
              </TableRow>
            ) : null}
            {isChargeableAmount(
              Number(currentInvoice.invoice_adjustment_amount ?? 0)
            ) ? (
              <TableRow>
                <TableHead scope="row" className="pl-3">
                  Invoice adjustments
                </TableHead>
                <TableCell className="pr-3 text-right font-medium tabular-nums">
                  −{fmt.money(currentInvoice.invoice_adjustment_amount ?? 0)}
                </TableCell>
              </TableRow>
            ) : null}
            {showCredit ? (
              <TableRow>
                <TableHead scope="row" className="pl-3">
                  Credit applied
                </TableHead>
                <TableCell className="pr-3 text-right font-medium tabular-nums">
                  {fmt.money(currentInvoice.credit_applied ?? 0)}
                </TableCell>
              </TableRow>
            ) : null}
            {hasBalance ? (
              <TableRow>
                <TableHead scope="row" className="pl-3">
                  Balance due
                </TableHead>
                <TableCell className="text-amber-foreground pr-3 text-right font-semibold tabular-nums">
                  {fmt.money(currentInvoice.balance)}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-2">
        <p className="font-medium">
          {payments.length === 1 ? 'Payment' : 'Payments'}
        </p>
        {payments.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No payments recorded for this invoice.
          </p>
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
                    'flex items-start gap-3 p-3',
                    payment.status === 'void' && 'opacity-65'
                  )}
                >
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
                                name={staffNameById.get(payment.user_id) ?? '?'}
                                src={staffAvatarById.get(payment.user_id)}
                                className="size-5"
                                fallbackClassName="text-[9px]"
                              />
                              <span>{staffNameById.get(payment.user_id)}</span>
                            </span>
                          ) : (
                            <span>Recorded by Former teammate</span>
                          )}
                        </>
                      ) : payment.source === 'auto' ? null : payment.source ===
                        'payment_link' ? (
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
                    {refunds.length > 0 ? (
                      <div className="border-border mt-3 space-y-2 border-t pt-3">
                        {refunds.map((refund) => (
                          <div key={refund.id} className="text-xs">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge
                                variant={
                                  refund.status === 'processed'
                                    ? 'success'
                                    : refund.status === 'failed'
                                      ? 'destructive'
                                      : 'warning'
                                }
                              >
                                Refund · {refund.status}
                              </Badge>
                              <span className="font-medium tabular-nums">
                                −{fmt.money(refund.amount)}
                              </span>
                              {refund.disposition ? (
                                <span className="text-muted-foreground">
                                  {refund.disposition === 'reopen_balance'
                                    ? 'Balance reopened'
                                    : 'Charge reduced'}
                                </span>
                              ) : null}
                            </div>
                            <p className="text-muted-foreground mt-1">
                              {refund.reason
                                ? `Reason: ${refund.reason}`
                                : refund.allocation_complete
                                  ? 'Refund review · classification required'
                                  : 'Refund review · line targeting required'}
                              {refund.gateway_refund_id
                                ? ` · ${refund.gateway_refund_id}`
                                : ''}
                              {refund.source === 'razorpay_dashboard'
                                ? ' · Razorpay Dashboard'
                                : refund.requested_by
                                  ? ` · ${staffNameById.get(refund.requested_by) ?? 'Former teammate'}`
                                  : ''}
                            </p>
                            {canRefund &&
                            refund.source === 'razorpay_dashboard' &&
                            refund.status === 'processed' &&
                            !refund.disposition &&
                            refund.allocation_complete ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="mt-2"
                                onClick={() =>
                                  setClassification({ payment, refund })
                                }
                              >
                                Classify refund
                              </Button>
                            ) : null}
                          </div>
                        ))}
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
              );
            })}
          </div>
        )}
      </div>

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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>{invoice ? `Invoice ${invoice.reference}` : 'Invoice'}</span>
            {activeInvoice ? (
              activeInvoice.state === 'void' ? (
                <Badge variant="neutral">Void</Badge>
              ) : activeInvoice.requires_refund_review ? (
                <Badge variant="warning">Refund review</Badge>
              ) : (
                <InvoicePaymentBadge
                  state={invoicePaymentState(activeInvoice)}
                />
              )
            ) : null}
          </DialogTitle>
          <DialogDescription>
            {invoice?.source ? invoiceSourceLabel(invoice.source) : 'Invoice'} ·
            issued {invoice ? fmt.date(invoice.created_at) : '—'}
          </DialogDescription>
        </DialogHeader>

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

        <DialogFooter showCloseButton>
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
