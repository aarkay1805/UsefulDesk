'use client';

import { useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
import { getErrorMessage } from '@/lib/errors';
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
  const { fmt } = useLocale();
  const classifying = Boolean(refund);
  const [disposition, setDisposition] =
    useState<PaymentRefundDisposition>('reopen_balance');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID()
  );

  async function submit() {
    if (reason.trim().length < 3) {
      toast.error('Enter a clear refund reason');
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
              ? { disposition, reason: reason.trim() }
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
        classifying
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
            {classifying ? 'Classify refund' : 'Issue full refund?'}
          </DialogTitle>
          <DialogDescription>
            {classifying
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
            disabled={saving || reason.trim().length < 3}
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            {classifying ? 'Apply classification' : 'Issue full refund'}
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
