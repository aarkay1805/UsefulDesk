'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { UserAvatar } from '@/components/ui/user-avatar';
import {
  ResolvableAction,
  type ActionBlocker,
} from '@/components/ui/resolvable-action';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { canRefundGatewayPayments } from '@/lib/auth/roles';
import { getErrorMessage } from '@/lib/errors';
import {
  invoiceCollectionActionState,
  invoiceHeadline,
  invoiceRefundActionState,
  invoiceSummaryRows,
  invoiceVoidActionState,
  PAYMENT_REFUND_STATUS_PRESENTATION,
  paymentRefundEventAt,
  paymentRefundOutcome,
} from '@/lib/finance/invoice-detail-presentation';
import type { FinanceInvoiceRow } from '@/lib/finance/invoices';
import {
  financeInvoiceReference,
  invoiceSourceLabel,
} from '@/lib/finance/invoices';
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
import { InvoiceDocumentActions } from './invoice-document-actions';

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
  | 'invoice_number'
  | 'seller_snapshot'
  | 'customer_snapshot'
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

function invoiceActionBlocker(
  blocker: ReturnType<typeof invoiceCollectionActionState>['blocker'],
  canResolveRefundReview: boolean,
  onResolveRefundReview: () => void
): ActionBlocker | null {
  if (blocker === 'permission') {
    return {
      title: 'Admin access required',
      description:
        'Only an agent, admin, or owner can record payments for this invoice.',
    };
  }
  if (blocker === 'refund_review') {
    return {
      title: 'Refund review blocks collection',
      description:
        'An admin must resolve the processed refund before this invoice can collect another payment.',
      ...(canResolveRefundReview
        ? {
            resolution: {
              label: 'Resolve refund review',
              onResolve: onResolveRefundReview,
            },
          }
        : {}),
    };
  }
  return null;
}

export function InvoiceRecordPaymentAction({
  invoice,
  canRecord,
  canResolveRefundReview,
  onRecord,
  onResolveRefundReview,
  variant = 'default',
  size = 'default',
  compact = false,
}: {
  invoice: Parameters<typeof invoiceCollectionActionState>[0];
  canRecord: boolean;
  canResolveRefundReview: boolean;
  onRecord: () => void;
  onResolveRefundReview: () => void;
  variant?: 'default' | 'ghost';
  size?: 'default' | 'sm';
  compact?: boolean;
}) {
  const state = invoiceCollectionActionState(invoice, canRecord);
  if (!state.show) return null;
  return (
    <ResolvableAction
      trigger={
        <Button type="button" variant={variant} size={size}>
          <Wallet className={size === 'sm' ? 'size-3.5' : 'size-4'} />
          {compact ? 'Record' : 'Record payment'}
        </Button>
      }
      onAction={onRecord}
      blocker={invoiceActionBlocker(
        state.blocker,
        canResolveRefundReview,
        onResolveRefundReview
      )}
    />
  );
}

export function InvoicePaymentActions({
  payment,
  refunds,
  refundScanComplete,
  canRefund,
  canVoid,
  onRefund,
  onVoid,
  onResolveLineTarget,
}: {
  payment: Payment;
  refunds: PaymentRefund[];
  refundScanComplete: boolean;
  canRefund: boolean;
  canVoid: boolean;
  onRefund: () => void;
  onVoid?: () => void;
  onResolveLineTarget: (refund: PaymentRefund) => void;
}) {
  const voidState = invoiceVoidActionState(payment, canVoid);
  const refundState = invoiceRefundActionState(
    payment,
    refunds,
    refundScanComplete,
    canRefund
  );
  const unresolvedRefund = refunds.find(
    (refund) => refund.status === 'processed' && !refund.allocation_complete
  );
  const permissionBlocker: ActionBlocker = {
    title: 'Admin access required',
    description: 'Only an admin or owner can correct recorded payments.',
  };
  const refundBlocker: ActionBlocker | null =
    refundState.blocker === 'permission'
      ? permissionBlocker
      : refundState.blocker === 'line_target_required' && unresolvedRefund
        ? {
            title: 'Refund review required',
            description:
              'Assign the processed refund to invoice lines before issuing another refund.',
            resolution: {
              label: 'Resolve refund review',
              onResolve: () => onResolveLineTarget(unresolvedRefund),
            },
          }
        : null;

  return (
    <>
      {voidState.show && onVoid ? (
        <ResolvableAction
          trigger={
            <Button type="button" variant="ghost" size="sm">
              <RotateCcw className="size-3.5" /> Void
            </Button>
          }
          onAction={onVoid}
          blocker={
            voidState.blocker === 'permission' ? permissionBlocker : null
          }
        />
      ) : null}
      {refundState.show ? (
        <ResolvableAction
          trigger={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={refundState.pending}
            >
              <RotateCcw className="size-3.5" /> Refund
            </Button>
          }
          onAction={onRefund}
          blocker={refundBlocker}
          disabled={refundState.pending}
        />
      ) : null}
    </>
  );
}

export function InvoiceRefundReviewFocusIntent({
  invoiceId,
  active,
  ready,
  onConsumed,
}: {
  invoiceId: string;
  active: boolean;
  ready: boolean;
  onConsumed?: () => void;
}) {
  const consumedInvoiceId = useRef<string | null>(null);

  useEffect(() => {
    if (!active) {
      consumedInvoiceId.current = null;
      return;
    }
    if (consumedInvoiceId.current === invoiceId) return;
    if (!ready) {
      consumedInvoiceId.current = invoiceId;
      onConsumed?.();
      return;
    }
    const target = document.getElementById(
      `invoice-refund-review-${invoiceId}`
    );
    if (!target) return;

    consumedInvoiceId.current = invoiceId;
    target.scrollIntoView({ block: 'center' });
    target.focus();
    onConsumed?.();
  }, [active, invoiceId, onConsumed, ready]);

  return null;
}

function InvoiceDetailBody({
  invoice,
  member,
  onFinancialChange,
  canVoid,
  onVoidPayment,
  focusRefundReview,
  onRefundReviewFocusConsumed,
}: {
  invoice: InvoiceDetail;
  member?: Membership | null;
  onFinancialChange: (patch: Partial<InvoiceDetail>) => void;
  canVoid: boolean;
  onVoidPayment?: (payment: Payment) => void;
  focusRefundReview: boolean;
  onRefundReviewFocusConsumed?: () => void;
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
        reference: financeInvoiceReference(invoiceResult.data),
        invoice_number: invoiceResult.data.invoice_number,
        seller_snapshot: invoiceResult.data.seller_snapshot,
        customer_snapshot: invoiceResult.data.customer_snapshot,
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
  // The headline names the figure; the ledger below derives it. So this line
  // carries only what the ledger cannot say — why the number is not simply
  // collectible. `balance_due` and `settled` previously restated the exact
  // Invoice total / Collected / Balance due rows rendered a few pixels down,
  // which is what made one number read as three different facts.
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
    if (headline.detail === 'nothing_to_collect') return 'Nothing to collect';
    return null;
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
    <div className="min-w-0 space-y-8">
      <InvoiceRefundReviewFocusIntent
        invoiceId={currentInvoice.id}
        active={focusRefundReview}
        ready={Boolean(currentInvoice.requires_refund_review)}
        onConsumed={onRefundReviewFocusConsumed}
      />
      {currentInvoice.requires_refund_review ? (
        <Alert id={`invoice-refund-review-${currentInvoice.id}`} tabIndex={-1}>
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

      {/* Masthead, not a card. Who and how much sit on the dialog's own
          content edge so the title, the item names, the summary labels and
          the payment rows all share one left rule instead of the four
          different indents four nested boxes used to produce. */}
      <div className="border-border grid gap-4 border-b pb-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
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
          {/* The MetricCard recipe verbatim — the same label/value pairing the
              owner reads on the Finance KPI tiles behind this dialog. */}
          <p className="text-muted-foreground text-sm font-medium">
            {headline.label}
          </p>
          <p className="text-foreground mt-2 text-[28px] leading-none font-bold tabular-nums">
            {fmt.money(headline.amount)}
          </p>
          {headlineDetail ? (
            <p className="text-muted-foreground mt-2 text-xs">
              {headlineDetail}
            </p>
          ) : null}
        </div>
      </div>

      {/* Two columns from `lg`: the invoice on the left — what is owed and what
          it is made of — and the money that has actually moved on the right.
          The rail is fixed rather than fractional because the dialog is capped
          at 54rem, so a fraction would only ever restate one width. Below `lg`
          the columns stack in reading order and the vertical rule leaves grid
          flow entirely, which is why there is no horizontal twin: the stacked
          layout is already separated by the section heading and its own rule. */}
      <div className="grid gap-y-8 lg:grid-cols-[minmax(0,1fr)_auto_19rem] lg:gap-x-6 lg:gap-y-0">
        {/* Items and totals are one ledger, not two boxes: the summary is the
            foot of this list, so it shares its amount column and its rules. */}
        <div className="min-w-0 space-y-2">
          <h3 className="text-base font-medium">Invoice items</h3>
          <div className="divide-border border-border divide-y border-y">
            {lines.length === 0 ? (
              <p className="text-muted-foreground py-3">
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
                    className={cn(
                      'grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 py-3',
                      line.state === 'void' && 'opacity-65'
                    )}
                  >
                    <div className="min-w-0">
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
                        <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                          {fmt.date(line.service_start)} –{' '}
                          {fmt.date(line.service_end)}
                        </p>
                      ) : null}
                      {bonusMonths > 0 && period?.standard_period_end ? (
                        <p className="text-muted-foreground mt-1 text-xs">
                          Regular expiry {fmt.date(period.standard_period_end)}{' '}
                          · +{bonusMonths}{' '}
                          {bonusMonths === 1 ? 'month' : 'months'}
                        </p>
                      ) : null}
                      {line.override_reason ? (
                        <p className="text-muted-foreground mt-1 text-xs">
                          Price override: {line.override_reason}
                        </p>
                      ) : null}
                    </div>
                    <div className="text-right">
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
                        <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                          {discountLabel} −{fmt.money(discountAmount)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Totals cluster tightly (they are one derivation, so no rule
            between them) and the balance is set off by the rule and a size
            step — the ledger's terminus, not a tinted chip inside a box. */}
          <dl className="pt-1">
            {summaryRows.map((row) => (
              <div
                key={row.key}
                className={cn(
                  'grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 py-1',
                  row.emphasis && 'border-border mt-1 border-t pt-2 pb-0'
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
                    row.emphasis && 'text-base font-semibold',
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

        <Separator orientation="vertical" className="hidden lg:block" />

        {/* `@container/payments` and not a viewport breakpoint: the refund audit
            grid below has to answer to this rail's 304px, not to the 1024px
            viewport that put it there. */}
        <section
          className="@container/payments min-w-0 space-y-2"
          aria-labelledby="payment-history-heading"
        >
          <h3 id="payment-history-heading" className="text-base font-medium">
            Payment history
          </h3>
          {payments.length === 0 ? (
            <p className="text-muted-foreground border-border border-t py-3">
              No payments recorded for this invoice.
            </p>
          ) : (
            <div className="divide-border border-border divide-y border-t">
              {payments.map((payment) => {
                const refunds = refundsByPayment.get(payment.id) ?? [];
                return (
                  <div
                    key={payment.id}
                    className={cn(
                      'min-w-0 py-3',
                      payment.status === 'void' && 'opacity-65'
                    )}
                  >
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4">
                      <div className="min-w-0">
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
                            'auto' ? null : payment.source ===
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
                            {payment.screenshot_url ||
                            payment.screenshot_path ? (
                              <PaymentProofLink payment={payment} />
                            ) : null}
                            {payment.status === 'void' &&
                            payment.void_reason ? (
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
                        {/* Box-aligned to the money column, not label-aligned:
                          a negative margin to optically pull the ghost label
                          onto the column pushes past the scroller's padding
                          box and gives the dialog a horizontal scrollbar. */}
                        <InvoicePaymentActions
                          payment={payment}
                          refunds={refunds}
                          refundScanComplete={refundScanComplete}
                          canRefund={canRefund}
                          canVoid={canVoid}
                          onRefund={() => setRefundPayment(payment)}
                          onVoid={
                            onVoidPayment
                              ? () => onVoidPayment(payment)
                              : undefined
                          }
                          onResolveLineTarget={(refund) =>
                            setClassification({ payment, refund })
                          }
                        />
                      </div>
                    </div>
                    {/* Refunds belong to their payment, so they hang from it on
                      an indented rule rather than opening a third box. */}
                    {refunds.length > 0 ? (
                      <div className="border-border divide-border mt-3 ml-4 divide-y border-t">
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
                                  <dl className="mt-3 grid gap-x-4 gap-y-2 @sm/payments:grid-cols-2">
                                    {refund.reason ? (
                                      <div className="min-w-0 @sm/payments:col-span-2">
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
  focusRefundReview = false,
  onRefundReviewFocusConsumed,
}: {
  invoice: InvoiceDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canRecord: boolean;
  canVoid?: boolean;
  member?: Membership | null;
  onRecord: () => void;
  onVoidPayment?: (payment: Payment) => void;
  focusRefundReview?: boolean;
  onRefundReviewFocusConsumed?: () => void;
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
  const collectionState = activeInvoice
    ? invoiceCollectionActionState(activeInvoice, canRecord)
    : null;
  const focusCurrentRefundReview = useCallback(() => {
    if (!activeInvoice) return;
    const target = document.getElementById(
      `invoice-refund-review-${activeInvoice.id}`
    );
    target?.scrollIntoView({ block: 'center' });
    target?.focus();
  }, [activeInvoice]);
  const collectionBlocker = collectionState
    ? invoiceActionBlocker(
        collectionState.blocker,
        canVoid,
        focusCurrentRefundReview
      )
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-[35rem] lg:max-w-[54rem] xl:max-w-[60rem]">
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
              focusRefundReview={focusRefundReview}
              onRefundReviewFocusConsumed={onRefundReviewFocusConsumed}
            />
          ) : null}
        </div>

        {/* One horizontal strip, one hierarchy step. Every secondary is a
            ghost button, so the five ways to chase or send this invoice read as
            one quiet toolbar and Record payment is the only emphasised control
            in the dialog. `contents` on the document actions dissolves their own
            flex wrapper so all five flow as siblings at one gap rather than as a
            block of three plus a block of two.

            The strip starts on the dialog's own left content edge — the same
            rule the title, the item names and the section headings use — and the
            primary takes the free space with `ml-auto`. `sm:justify-start`
            overrides the master's `sm:justify-end`, which is load-bearing: once
            the primary wraps there is no `ml-auto` item left on the first line,
            so `justify-end` would right-align the strip at `lg` while `ml-auto`
            left-aligns it at `xl` — the same six controls under two alignments.
            Six buttons measure 858px, so they share a line only once the dialog
            reaches `xl`; below that the primary wraps to its own line and
            `ml-auto` keeps it on the right.

            Nothing stretches to fill a short line any more. That rule existed
            because a stranded outline pill on its own row read as broken, and
            it cannot survive `contents`: a `> button` selector reaches the three
            collection links but not the paperwork, which is still a DOM child of
            its own wrapper — so one row grew a stretched UPI link beside a
            natural-width Download invoice. Ghost buttons have no edge to strand,
            so the strip simply wraps at its natural widths. */}
        <DialogFooter className="min-w-0 flex-row flex-wrap items-center justify-start gap-2 sm:justify-start">
          {activeInvoice && collectionState?.show ? (
            <>
              <PaymentLinkActions
                key={activeInvoice.id}
                invoice={activeInvoice}
                member={member ?? activeInvoice.membership ?? null}
                collectionBlocker={collectionBlocker}
              />
              <CopyUpiLinkButton
                upi={upi}
                amount={Number(
                  activeInvoice.collectible_balance ?? activeInvoice.balance
                )}
                note={`Invoice ${activeInvoice.reference}`}
                size="default"
                variant="ghost"
                blocker={collectionBlocker}
              />
            </>
          ) : null}

          {activeInvoice ? (
            <InvoiceDocumentActions
              key={activeInvoice.id}
              invoice={activeInvoice}
              // Outline only when they are the whole footer: a settled invoice
              // has no primary to anchor the band, and two borderless actions
              // alone in a muted bar read as disabled.
              variant={collectionState?.show ? 'ghost' : 'outline'}
              className="contents"
              onResolveRefundReview={
                canVoid ? focusCurrentRefundReview : undefined
              }
              customerPhone={
                member?.contact?.phone ??
                activeInvoice.membership?.contact?.phone ??
                activeInvoice.contact?.phone
              }
            />
          ) : null}

          {activeInvoice && collectionState?.show ? (
            <div className="ml-auto flex min-w-0 justify-end">
              <InvoiceRecordPaymentAction
                invoice={activeInvoice}
                canRecord={canRecord}
                canResolveRefundReview={canVoid}
                onRecord={onRecord}
                onResolveRefundReview={focusCurrentRefundReview}
              />
            </div>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
