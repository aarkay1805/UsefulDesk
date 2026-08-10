'use client';

import { useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Textarea } from '@/components/ui/textarea';
import { useLocale } from '@/hooks/use-locale';
import { currencySymbol } from '@/lib/currency';
import { getErrorMessage } from '@/lib/errors';
import {
  normalizeRefundLineAllocations,
  refundAllocationTotalPaise,
} from '@/lib/payments/refund-allocation-input';
import type { Payment, PaymentRefund, PaymentRefundDisposition } from '@/types';

export function GatewayRefundDialog({
  payment,
  refund,
  amount,
  invoiceReference,
  memberName,
  open,
  onOpenChange,
  onCompleted,
}: {
  payment: Payment;
  refund?: PaymentRefund | null;
  amount: number;
  invoiceReference: string;
  memberName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted: () => void;
}) {
  const { fmt, locale } = useLocale();
  const classifying = Boolean(refund);
  const targetingLines = Boolean(refund && !refund.allocation_complete);
  const allocationOptions = refund?.allocation_options ?? [];
  const [disposition, setDisposition] =
    useState<PaymentRefundDisposition>('reopen_balance');
  const [reason, setReason] = useState('');
  const [lineAmounts, setLineAmounts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID()
  );
  const allocationDraft = allocationOptions
    .map((option) => ({
      invoiceLineId: option.invoice_line_id,
      amount: lineAmounts[option.invoice_line_id]?.trim() ?? '',
    }))
    .filter((allocation) => allocation.amount.length > 0);
  const normalizedAllocations = targetingLines
    ? normalizeRefundLineAllocations(allocationDraft)
    : [];
  const allocatedPaise = normalizedAllocations
    ? refundAllocationTotalPaise(normalizedAllocations)
    : 0;
  const targetPaise = Math.round(amount * 100);
  const exceedsLineCapacity = Boolean(
    normalizedAllocations?.some((allocation) => {
      const option = allocationOptions.find(
        (candidate) => candidate.invoice_line_id === allocation.invoiceLineId
      );
      return (
        !option ||
        Math.round(Number(allocation.amount) * 100) >
          Math.round(option.available_amount * 100)
      );
    })
  );
  const allocationError = !targetingLines
    ? null
    : allocationOptions.length === 0
      ? 'No eligible original payment lines are available.'
      : normalizedAllocations === null
        ? 'Enter a positive amount with no more than two decimal places.'
        : exceedsLineCapacity
          ? 'A line amount exceeds the payment originally assigned to it.'
          : allocatedPaise !== targetPaise
            ? `Assigned ${fmt.money(allocatedPaise / 100)} of ${fmt.money(amount)}.`
            : null;

  async function submit() {
    if (reason.trim().length < 3) {
      toast.error('Enter a clear refund reason');
      return;
    }
    if (allocationError || !normalizedAllocations) {
      toast.error(allocationError ?? 'Choose exact invoice-line allocations');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(
        classifying
          ? `/api/payments/razorpay/refunds/${refund!.id}/classify`
          : '/api/payments/razorpay/refunds',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            classifying
              ? {
                  disposition,
                  reason: reason.trim(),
                  ...(targetingLines
                    ? { allocations: normalizedAllocations }
                    : {}),
                }
              : {
                  paymentId: payment.id,
                  disposition,
                  reason: reason.trim(),
                  idempotencyKey,
                }
          ),
        }
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? 'Refund request failed');
      }
      toast.success(
        targetingLines
          ? 'Refund lines assigned and review cleared'
          : classifying
            ? 'Refund classified and invoice balances recalculated'
            : 'Full refund submitted to Razorpay'
      );
      setReason('');
      setIdempotencyKey(crypto.randomUUID());
      onOpenChange(false);
      onCompleted();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Refund request failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {targetingLines
              ? 'Resolve refund review'
              : classifying
                ? 'Classify refund'
                : 'Issue full refund?'}
          </DialogTitle>
          <DialogDescription>
            {targetingLines
              ? 'Assign every refunded paise to its original invoice line, then choose the accounting outcome.'
              : classifying
                ? 'Choose how this provider-processed refund changes the invoice.'
                : 'This sends an irreversible full remaining-payment refund to Razorpay.'}
          </DialogDescription>
        </DialogHeader>

        <div className="border-border divide-border divide-y rounded-lg border text-sm">
          <RefundFact label="Member" value={memberName} />
          <RefundFact label="Invoice" value={invoiceReference} />
          <RefundFact
            label="Original payment"
            value={`${fmt.money(payment.amount)} · ${fmt.dateTime(payment.paid_at)}`}
          />
          <RefundFact label="Refund amount" value={fmt.money(amount)} strong />
        </div>

        {targetingLines ? (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">Invoice line targeting</p>
              <p className="text-muted-foreground mt-1 text-xs">
                These allocations are append-only. Enter zero by leaving an
                unrelated line blank.
              </p>
            </div>
            {allocationOptions.length === 0 ? (
              <Alert variant="destructive">
                <AlertTitle>Line targeting unavailable</AlertTitle>
                <AlertDescription>
                  Reload the invoice. If this persists, keep the refund under
                  review for reconciliation.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-3">
                {allocationOptions.map((option) => {
                  const inputId = `gateway-refund-line-${option.invoice_line_id}`;
                  return (
                    <div key={option.invoice_line_id} className="space-y-1.5">
                      <div className="flex items-end justify-between gap-3">
                        <Label htmlFor={inputId}>{option.description}</Label>
                        <span className="text-muted-foreground text-xs tabular-nums">
                          Up to {fmt.money(option.available_amount)}
                        </span>
                      </div>
                      <CurrencyInput
                        id={inputId}
                        symbol={currencySymbol(
                          refund?.currency ?? locale.currency
                        )}
                        groupLocale={locale.locale}
                        value={lineAmounts[option.invoice_line_id] ?? ''}
                        onValueChange={(value) =>
                          setLineAmounts((current) => ({
                            ...current,
                            [option.invoice_line_id]: value,
                          }))
                        }
                        aria-invalid={Boolean(allocationError)}
                      />
                    </div>
                  );
                })}
                <p
                  className={
                    allocationError
                      ? 'text-destructive text-xs'
                      : 'text-muted-foreground text-xs'
                  }
                  role={allocationError ? 'alert' : undefined}
                >
                  {allocationError ??
                    `Assigned ${fmt.money(amount)} of ${fmt.money(amount)}.`}
                </p>
              </div>
            )}
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="gateway-refund-disposition">Invoice outcome</Label>
          <Select
            value={disposition}
            onValueChange={(value) =>
              setDisposition(value as PaymentRefundDisposition)
            }
          >
            <SelectTrigger id="gateway-refund-disposition" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="reopen_balance">Reopen balance</SelectItem>
              <SelectItem value="reduce_charge">Reduce charge</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            {disposition === 'reopen_balance'
              ? 'The charge remains valid, so the refunded amount becomes collectible again.'
              : 'An equal invoice adjustment reduces the charge, so the member is not chased.'}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="gateway-refund-reason">Reason</Label>
          <Textarea
            id="gateway-refund-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why is this payment being refunded?"
            maxLength={500}
          />
        </div>

        {!classifying ? (
          <Alert>
            <RotateCcw />
            <AlertTitle>Provider processing is not customer receipt</AlertTitle>
            <AlertDescription>
              A processed refund may still take several working days to reach
              the original payment method. Razorpay may not return the original
              transaction fee.
            </AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={classifying ? 'default' : 'destructive'}
            onClick={() => void submit()}
            disabled={
              saving || reason.trim().length < 3 || Boolean(allocationError)
            }
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            {targetingLines
              ? 'Resolve refund review'
              : classifying
                ? 'Apply classification'
                : 'Issue full refund'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RefundFact({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? 'font-semibold tabular-nums' : 'text-right'}>
        {value}
      </span>
    </div>
  );
}
