'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Repeat, RotateCcw, Wallet } from 'lucide-react';

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
import { useLocale } from '@/hooks/use-locale';
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
  PaymentMethod,
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
>;

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank: 'Bank transfer',
  other: 'Other',
};

function InvoiceDetailBody({
  invoice,
  canVoid,
  onVoidPayment,
}: {
  invoice: InvoiceDetail;
  canVoid: boolean;
  onVoidPayment?: (payment: Payment) => void;
}) {
  const { fmt } = useLocale();
  const { nameById: staffNameById, avatarById: staffAvatarById } =
    useAccountStaff();
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [periods, setPeriods] = useState<MembershipPeriodInvoice[]>([]);
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

      const supabase = createClient();
      const [lineResult, paymentResult, periodResult] = await Promise.all([
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
      ]);
      if (cancelled) return;

      const error =
        lineResult.error ?? paymentResult.error ?? periodResult.error;
      if (error) {
        setLoadError(
          getErrorMessage(error, 'Invoice details could not be loaded')
        );
        setLoading(false);
        return;
      }

      setLines((lineResult.data as InvoiceLine[]) ?? []);
      setPayments((paymentResult.data as Payment[]) ?? []);
      setPeriods((periodResult.data as MembershipPeriodInvoice[]) ?? []);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [invoice.id]);

  const periodById = useMemo(
    () => new Map(periods.map((period) => [period.id, period])),
    [periods]
  );
  const showCredit = isChargeableAmount(invoice.credit_applied ?? 0);
  const hasBalance = isChargeableAmount(invoice.balance);
  const showAmountPaid = hasBalance && isChargeableAmount(invoice.amount_paid);

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
                {fmt.money(invoice.fee_amount)}
              </TableCell>
            </TableRow>
            {showAmountPaid ? (
              <TableRow>
                <TableHead scope="row" className="pl-3">
                  Paid
                </TableHead>
                <TableCell className="pr-3 text-right font-medium tabular-nums">
                  {fmt.money(invoice.amount_paid)}
                </TableCell>
              </TableRow>
            ) : null}
            {showCredit ? (
              <TableRow>
                <TableHead scope="row" className="pl-3">
                  Credit applied
                </TableHead>
                <TableCell className="pr-3 text-right font-medium tabular-nums">
                  {fmt.money(invoice.credit_applied ?? 0)}
                </TableCell>
              </TableRow>
            ) : null}
            {hasBalance ? (
              <TableRow>
                <TableHead scope="row" className="pl-3">
                  Balance due
                </TableHead>
                <TableCell className="text-amber-foreground pr-3 text-right font-semibold tabular-nums">
                  {fmt.money(invoice.balance)}
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
            {payments.map((payment) => (
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
                          payment.voided_at ? fmt.date(payment.voided_at) : null
                        }
                      />
                    ) : null}
                    {payment.source === 'auto' ? (
                      <Badge variant="info">
                        <Repeat className="size-3" /> Auto
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
                    ) : payment.source === 'auto' ? null : (
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
                  {payment.status === 'paid' && canVoid && onVoidPayment ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onVoidPayment(payment)}
                    >
                      <RotateCcw className="size-3.5" /> Void
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function InvoiceDetailDialog({
  invoice,
  open,
  onOpenChange,
  canRecord,
  canVoid = false,
  onRecord,
  onVoidPayment,
}: {
  invoice: InvoiceDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canRecord: boolean;
  canVoid?: boolean;
  onRecord: () => void;
  onVoidPayment?: (payment: Payment) => void;
}) {
  const { fmt } = useLocale();
  const upi = useUpiConfig();
  const collectible =
    !!invoice &&
    invoice.state === 'open' &&
    isChargeableAmount(invoice.balance) &&
    canRecord;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>{invoice ? `Invoice ${invoice.reference}` : 'Invoice'}</span>
            {invoice ? (
              invoice.state === 'void' ? (
                <Badge variant="neutral">Void</Badge>
              ) : (
                <InvoicePaymentBadge state={invoicePaymentState(invoice)} />
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
            canVoid={canVoid}
            onVoidPayment={onVoidPayment}
          />
        ) : null}

        <DialogFooter showCloseButton>
          {collectible ? (
            <>
              <CopyUpiLinkButton
                upi={upi}
                amount={Number(invoice!.balance)}
                note={`Invoice ${invoice!.reference}`}
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
