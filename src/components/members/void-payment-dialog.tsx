"use client";

import { useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/hooks/use-locale";
import type { Payment } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function VoidPaymentDialog({
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
  const supabase = createClient();
  const { fmt } = useLocale();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  if (!payment) return null;
  const activePayment = payment;

  async function voidPayment() {
    if (!reason.trim()) return toast.error("Enter a reason for the correction");
    setSaving(true);
    const { error } = await supabase.rpc("void_membership_payment", {
      p_payment_id: activePayment.id,
      p_reason: reason.trim(),
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Payment voided; the balance has been recalculated");
    onOpenChange(false);
    onVoided();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Void payment?</DialogTitle>
          <DialogDescription>
            Reverse the {fmt.money(activePayment.amount)} entry from{" "}
            {fmt.date(activePayment.paid_at)}. The ledger row is retained for audit history and the
            period balance is reopened.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="void-payment-reason">Reason</Label>
          <Input
            id="void-payment-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Duplicate or incorrectly recorded payment"
            autoFocus
          />
        </div>
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
            variant="destructive"
            onClick={voidPayment}
            disabled={saving || !reason.trim()}
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            Void payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
