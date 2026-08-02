'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
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

function Summary({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5 font-medium tabular-nums">{children}</dd>
    </div>
  );
}

function PaymentRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-right text-sm font-medium">{children}</dd>
    </div>
  );
}

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
    <div className="space-y-4">
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
                      <Badge variant="neutral">
                        {line.kind.replaceAll('_', ' ')}
                      </Badge>
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
                        Regular expiry {fmt.date(period.standard_period_end)} ·
                        +{bonusMonths} {bonusMonths === 1 ? 'month' : 'months'}
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
                <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <Summary label="Cash paid">
                    {fmt.money(line.amount_paid)}
                  </Summary>
                  <Summary label="Credit">
                    {fmt.money(line.credit_applied)}
                  </Summary>
                  <Summary label="Balance">
                    <span
                      className={
                        isChargeableAmount(line.balance)
                          ? 'text-amber-foreground'
                          : undefined
                      }
                    >
                      {fmt.money(line.balance)}
                    </span>
                  </Summary>
                </dl>
              </div>
            );
          })
        )}
      </div>

      <dl className="border-border grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm sm:grid-cols-5">
        <Summary label="Total">{fmt.money(invoice.fee_amount)}</Summary>
        <Summary label="Cash paid">{fmt.money(invoice.amount_paid)}</Summary>
        <Summary label="Credit">
          {fmt.money(invoice.credit_applied ?? 0)}
        </Summary>
        <Summary label="Balance">
          <span
            className={
              isChargeableAmount(invoice.balance)
                ? 'text-amber-foreground'
                : undefined
            }
          >
            {fmt.money(invoice.balance)}
          </span>
        </Summary>
        <Summary label="Payment">
          {invoice.state === 'void' ? (
            <Badge variant="neutral">Void</Badge>
          ) : (
            <InvoicePaymentBadge state={invoicePaymentState(invoice)} />
          )}
        </Summary>
      </dl>

      <div>
        <p className="text-muted-foreground mb-2 text-xs font-medium uppercase">
          Collections
        </p>
        {payments.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No payments recorded for this invoice.
          </p>
        ) : (
          <div className="space-y-3">
            {payments.map((payment) => (
              <div
                key={payment.id}
                className={payment.status === 'void' ? 'opacity-65' : undefined}
              >
                <div className="mb-1.5 flex items-center gap-2">
                  {payment.status === 'void' ? (
                    <VoidedPaymentBadge
                      payment={payment}
                      voidedOn={
                        payment.voided_at ? fmt.date(payment.voided_at) : null
                      }
                    />
                  ) : (
                    <Badge variant="success">Paid</Badge>
                  )}
                  {payment.source === 'auto' ? (
                    <Badge variant="info">
                      <Repeat className="size-3" /> Auto
                    </Badge>
                  ) : null}
                  {payment.status === 'paid' && canVoid && onVoidPayment ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      onClick={() => onVoidPayment(payment)}
                    >
                      <RotateCcw className="size-3.5" /> Void
                    </Button>
                  ) : null}
                </div>
                <dl className="border-border divide-border divide-y rounded-lg border">
                  <PaymentRow label="Paid on">
                    {fmt.dateTime(payment.paid_at)}
                  </PaymentRow>
                  <PaymentRow label="Method">
                    {METHOD_LABEL[payment.method]}
                  </PaymentRow>
                  <PaymentRow label="Amount">
                    <span
                      className={
                        payment.status === 'void'
                          ? 'tabular-nums line-through'
                          : 'tabular-nums'
                      }
                    >
                      {fmt.money(payment.amount)}
                    </span>
                  </PaymentRow>
                  <PaymentRow label="Recorded by">
                    {!payment.user_id ? (
                      'Auto-pay'
                    ) : staffNameById.has(payment.user_id) ? (
                      <span className="inline-flex items-center gap-1.5">
                        <UserAvatar
                          name={staffNameById.get(payment.user_id) ?? '?'}
                          src={staffAvatarById.get(payment.user_id)}
                          className="size-5"
                          fallbackClassName="text-[9px]"
                        />
                        {staffNameById.get(payment.user_id)}
                      </span>
                    ) : (
                      'Former teammate'
                    )}
                  </PaymentRow>
                  {payment.note ? (
                    <PaymentRow label="Note">{payment.note}</PaymentRow>
                  ) : null}
                  {payment.screenshot_url || payment.screenshot_path ? (
                    <PaymentRow label="Receipt">
                      <PaymentProofLink payment={payment} />
                    </PaymentRow>
                  ) : null}
                  {payment.status === 'void' && payment.void_reason ? (
                    <PaymentRow label="Void reason">
                      <span className="text-muted-foreground">
                        {payment.void_reason}
                      </span>
                    </PaymentRow>
                  ) : null}
                </dl>
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
          <DialogTitle>{invoice?.reference ?? 'Invoice'}</DialogTitle>
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
