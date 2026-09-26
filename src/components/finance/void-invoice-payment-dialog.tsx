'use client';

import { useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLocale } from '@/hooks/use-locale';
import { getErrorMessage } from '@/lib/errors';
import { createClient } from '@/lib/supabase/client';
import type { Payment } from '@/types';

export function VoidInvoicePaymentDialog({
  payment,
  open,
  onOpenChange,
  onVoided,
}: {
  payment: Payment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVoided: () => void;
}) {
  const { fmt } = useLocale();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  if (!payment) return null;
  const activePayment = payment;

  function handleOpenChange(next: boolean) {
    if (!next) setReason('');
    onOpenChange(next);
  }

  async function voidPayment() {
    if (!reason.trim()) {
      toast.error('Write why you are cancelling it');
      return;
    }
    setSaving(true);
    try {
      const { error } = await createClient().rpc('void_invoice_payment', {
        p_payment_id: activePayment.id,
        p_reason: reason.trim(),
      });
      if (error) throw error;
      toast.success(
        'Payment cancelled. Invoice balance updated.'
      );
      handleOpenChange(false);
      onVoided();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not cancel the payment'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Cancel this payment?</DialogTitle>
          <DialogDescription>
            This removes the{' '}
            <span className="tabular-nums">
              {fmt.money(activePayment.amount)}
            </span>{' '}
            payment from {fmt.date(activePayment.paid_at)}. It stays in history,
            and the amount becomes due again on the invoice.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="void-invoice-payment-reason">Reason</Label>
          <Input
            id="void-invoice-payment-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Example: Added twice by mistake"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={voidPayment}
            disabled={saving || !reason.trim()}
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            Cancel payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
