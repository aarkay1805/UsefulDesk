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
      ? 'There is nothing in this payment that can be refunded.'
      : normalizedAllocations === null
        ? 'Enter an amount above zero, like 500 or 499.50.'
        : exceedsLineCapacity
          ? 'An amount is more than what was paid for that item.'
          : allocatedPaise !== targetPaise
            ? `Assigned ${fmt.money(allocatedPaise / 100)} of ${fmt.money(amount)}.`
            : null;

  async function submit() {
    if (reason.trim().length < 3) {
      toast.error('Write why you are refunding');
      return;
    }
    if (allocationError || !normalizedAllocations) {
      toast.error(allocationError ?? 'Split the refund across the invoice items');
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
        throw new Error(body.error ?? 'Could not refund');
      }
      toast.success(
        targetingLines
          ? 'Refund sorted. Check is done.'
          : classifying
            ? 'Refund sorted. Invoice balance updated.'
            : 'Full refund sent to Razorpay'
      );
      setReason('');
      setIdempotencyKey(crypto.randomUUID());
      onOpenChange(false);
      onCompleted();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not refund'));
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
              ? 'Sort out refund'
              : classifying
                ? 'Sort out refund'
                : 'Issue full refund?'}
          </DialogTitle>
          <DialogDescription>
            {targetingLines
              ? 'Split the refund across the invoice items. Then choose what happens to the invoice.'
              : classifying
                ? 'Choose what this Razorpay refund does to the invoice.'
                : 'This refunds the full remaining amount through Razorpay. You cannot undo this.'}
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
              <p className="text-sm font-medium">Refund per item</p>
              <p className="text-muted-foreground mt-1 text-xs">
                You cannot change this later. Leave an item blank if nothing is refunded for it.
              </p>
            </div>
            {allocationOptions.length === 0 ? (
              <Alert variant="destructive">
                <AlertTitle>Could not load invoice items</AlertTitle>
                <AlertDescription>
                  Reload the invoice. If this keeps happening, leave the refund for checking.
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
          <Label htmlFor="gateway-refund-disposition">What happens to the invoice</Label>
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
              <SelectItem value="reopen_balance">Member still owes this</SelectItem>
              <SelectItem value="reduce_charge">Reduce the bill</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            {disposition === 'reopen_balance'
              ? 'The fee is still owed, so the refunded amount becomes due again.'
              : 'The bill goes down by the refund, so the member owes nothing more.'}
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
            <AlertTitle>The member may not get the money today</AlertTitle>
            <AlertDescription>
              A refund can take a few working days to reach the member. Razorpay may keep its fee.
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
              ? 'Sort out refund'
              : classifying
                ? 'Save'
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
