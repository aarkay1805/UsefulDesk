'use client';

import { useEffect, useState } from 'react';
import { Loader2, Wallet } from 'lucide-react';
import { toast } from 'sonner';

import { useLocale } from '@/hooks/use-locale';
import { createClient } from '@/lib/supabase/client';
import { currencySymbol } from '@/lib/currency';
import type { FinanceInvoiceRow } from '@/lib/finance/invoices';
import type { InvoiceLine, Payment, PaymentMethod } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CurrencyInput } from '@/components/ui/currency-input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function GenericInvoiceDetailDialog({
  invoice,
  open,
  onOpenChange,
  canRecord,
  onRecord,
}: {
  invoice: FinanceInvoiceRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canRecord: boolean;
  onRecord: () => void;
}) {
  const { fmt } = useLocale();
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !invoice) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const supabase = createClient();
      const [lineResult, paymentResult] = await Promise.all([
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
      ]);
      if (cancelled) return;
      setLines((lineResult.data as InvoiceLine[]) ?? []);
      setPayments((paymentResult.data as Payment[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [invoice, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{invoice?.reference ?? 'Invoice'}</DialogTitle>
          <DialogDescription>
            {invoice?.source?.replaceAll('_', ' ') ?? 'Membership invoice'} ·
            issued {invoice ? fmt.date(invoice.created_at) : '—'}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
            <Loader2 className="size-4 animate-spin" />
            Loading invoice…
          </div>
        ) : (
          <div className="space-y-4">
            <div className="divide-y rounded-lg border">
              {lines.map((line) => (
                <div
                  key={line.id}
                  className="flex items-start gap-3 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">
                        {line.description}
                        {line.quantity > 1 ? ` × ${line.quantity}` : ''}
                      </p>
                      <Badge variant="neutral">
                        {line.kind.replace('_', ' ')}
                      </Badge>
                    </div>
                    {line.service_start && line.service_end ? (
                      <p className="text-muted-foreground text-xs">
                        {fmt.date(line.service_start)}–
                        {fmt.date(line.service_end)}
                      </p>
                    ) : null}
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-medium tabular-nums">
                      {fmt.money(line.line_amount)}
                    </p>
                    {Number(line.credit_applied) > 0 ? (
                      <p className="text-muted-foreground text-xs">
                        {fmt.money(line.credit_applied)} credit
                      </p>
                    ) : null}
                    {Number(line.balance) > 0 ? (
                      <p className="text-amber-foreground text-xs">
                        {fmt.money(line.balance)} due
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            <dl className="grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm sm:grid-cols-4">
              <Summary
                label="Total"
                value={fmt.money(invoice?.fee_amount ?? 0)}
              />
              <Summary
                label="Cash paid"
                value={fmt.money(invoice?.amount_paid ?? 0)}
              />
              <Summary
                label="Credit"
                value={fmt.money(invoice?.credit_applied ?? 0)}
              />
              <Summary
                label="Balance"
                value={fmt.money(invoice?.balance ?? 0)}
                danger={Number(invoice?.balance ?? 0) > 0}
              />
            </dl>
            {payments.length > 0 ? (
              <div>
                <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
                  Collections
                </p>
                {payments.map((payment) => (
                  <div
                    key={payment.id}
                    className="flex justify-between border-t py-2 text-sm"
                  >
                    <span>
                      {fmt.dateTime(payment.paid_at)} ·{' '}
                      {payment.method.toUpperCase()}
                    </span>
                    <span className="tabular-nums">
                      {payment.status === 'void' ? 'Voided · ' : ''}
                      {fmt.money(payment.amount)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
        <DialogFooter showCloseButton>
          {invoice &&
          invoice.state === 'open' &&
          Number(invoice.balance) > 0 &&
          canRecord ? (
            <Button onClick={onRecord}>
              <Wallet className="size-4" />
              Record payment
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GenericRecordPaymentDialog({
  invoice,
  open,
  onOpenChange,
  onSaved,
}: {
  invoice: FinanceInvoiceRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { fmt, locale } = useLocale();
  const [amount, setAmount] = useState(invoice ? String(invoice.balance) : '');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!invoice) return;
    const parsed = Number(amount);
    if (
      !Number.isFinite(parsed) ||
      parsed <= 0 ||
      parsed > Number(invoice.balance)
    )
      return toast.error('Enter an amount within the invoice balance');
    setSaving(true);
    const { error } = await createClient().rpc('record_invoice_payment', {
      p_invoice_id: invoice.id,
      p_amount: parsed,
      p_method: method,
      p_paid_at: new Date().toISOString(),
      p_note: '',
      p_receipt_path: null,
      p_idempotency_key: crypto.randomUUID(),
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Payment recorded');
    onOpenChange(false);
    onSaved();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record invoice payment</DialogTitle>
          <DialogDescription>
            {invoice?.reference} · {fmt.money(invoice?.balance ?? 0)}{' '}
            outstanding
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Amount</Label>
            <CurrencyInput
              symbol={currencySymbol(locale.currency)}
              groupLocale={locale.locale}
              value={amount}
              onValueChange={setAmount}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Method</Label>
            <Select
              value={method}
              onValueChange={(value) => setMethod(value as PaymentMethod)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  ['cash', 'upi', 'card', 'bank', 'other'] as PaymentMethod[]
                ).map((value) => (
                  <SelectItem key={value} value={value}>
                    {value === 'upi'
                      ? 'UPI'
                      : value.charAt(0).toUpperCase() + value.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter showCloseButton>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}Record
            payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Summary({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd
        className={
          danger
            ? 'text-amber-foreground mt-0.5 font-medium tabular-nums'
            : 'mt-0.5 font-medium tabular-nums'
        }
      >
        {value}
      </dd>
    </div>
  );
}
