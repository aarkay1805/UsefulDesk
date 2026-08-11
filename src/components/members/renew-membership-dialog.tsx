'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { getErrorMessage } from '@/lib/errors';
import { useLocale } from '@/hooks/use-locale';
import { daysBetween } from '@/lib/memberships/expiry';
import { optionEndDate, renewalFee } from '@/lib/memberships/pricing';
import type { CheckoutSelection, Membership, PaymentMethod } from '@/types';
import { useMembershipPlans } from './use-membership-plans';
import { PlanOptionPicker } from './plan-option-picker';
import { ProductsServicesPicker } from './products-services-picker';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'other', label: 'Other' },
];

interface RenewMembershipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  membership: Membership;
  onSaved: () => void;
  /** Existing invoice balances that remain due after this renewal. */
  outstandingBalance?: number;
  /** 'convert' reuses this flow for the trial→paid conversion: the new
   *  paid period starts today (a trial's remaining days aren't carried
   *  forward), and the row is flipped off trial with converted_at
   *  stamped. Defaults to the plain 'renew' behaviour. */
  variant?: 'renew' | 'convert';
}

export function RenewMembershipDialog({
  open,
  onOpenChange,
  membership,
  onSaved,
  outstandingBalance = 0,
  variant = 'renew',
}: RenewMembershipDialogProps) {
  const { fmt } = useLocale();
  const { plans } = useMembershipPlans(true);
  const isConvert = variant === 'convert';

  const [planId, setPlanId] = useState(membership.plan_id ?? '');
  const [optionId, setOptionId] = useState<string | null>(
    membership.pricing_option_id ?? null
  );
  const [feeAmount, setFeeAmount] = useState(
    String(membership.fee_amount ?? '')
  );
  const [collectPayment, setCollectPayment] = useState(true);
  const [collectAmount, setCollectAmount] = useState(
    String(membership.fee_amount ?? '')
  );
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [saving, setSaving] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID()
  );
  const [selections, setSelections] = useState<CheckoutSelection[]>([]);

  const selectedPlan = plans.find((p) => p.id === planId);
  const selectedOption =
    selectedPlan?.pricing_options?.find(
      (o) => o.id === optionId && o.is_active
    ) ?? null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setPlanId(membership.plan_id ?? '');
      setOptionId(membership.pricing_option_id ?? null);
      setFeeAmount(String(membership.fee_amount ?? ''));
      setCollectPayment(true);
      setCollectAmount(String(membership.fee_amount ?? ''));
      setMethod('cash');
      setIdempotencyKey(crypto.randomUUID());
      setSelections([]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, membership]);

  // Seed the fee (and the amount to collect) from the picked billing
  // option. A renewal bills the option price — never the joining fee, so
  // this must override the open-effect's fee_amount seed (which embeds
  // the setup fee on a first-cycle member). Keyed on the RESOLVED option
  // id, not optionId: at mount/open the plans list may not be loaded yet,
  // and the membership's pre-set optionId never changes on the default
  // path, so an optionId-keyed effect never fires and the joining fee
  // would be re-billed. No-option (legacy) rows keep the fee_amount seed.
  const selectedOptionId = selectedOption?.id ?? null;
  useEffect(() => {
    if (!open || !selectedOptionId || !selectedOption) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      const fee = renewalFee(selectedOption);
      setFeeAmount(String(fee));
      setCollectAmount(String(fee));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedOptionId]);

  // New period extends from the later of current expiry or today, so a
  // member who renews early keeps their unexpired days. A conversion
  // always starts today — a trial's leftover days aren't paid time.
  const today = fmt.today();
  const base =
    !isConvert &&
    membership.end_date &&
    daysBetween(today, membership.end_date) > 0
      ? membership.end_date
      : today;
  const newEnd = selectedOption ? optionEndDate(base, selectedOption) : null;
  const addOnTotal = selections.reduce(
    (sum, selection) =>
      sum + Number(selection.unit_amount ?? 0) * (selection.quantity ?? 1),
    0
  );

  async function handleRenew() {
    if (!selectedPlan || !selectedOption || !newEnd) {
      return toast.error('Pick a plan and billing option');
    }
    const fee =
      feeAmount === '' ? renewalFee(selectedOption) : Number(feeAmount);
    if (!Number.isFinite(fee) || fee < 0)
      return toast.error('Enter a valid fee');

    // Collected now; a partial amount leaves the new period 'due'.
    const invoiceTotal = fee + addOnTotal;
    const collected = collectPayment
      ? collectAmount === ''
        ? invoiceTotal
        : Number(collectAmount)
      : 0;
    if (collectPayment && (!Number.isFinite(collected) || collected < 0)) {
      return toast.error('Enter a valid amount');
    }
    if (collected > invoiceTotal) {
      return toast.error('Collected amount cannot exceed the invoice total');
    }

    setSaving(true);
    try {
      const response = await fetch('/api/member-checkouts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: isConvert ? 'convert' : 'membership_renewal',
          contact_id: membership.contact_id,
          membership_id: membership.id,
          membership: {
            plan_id: planId,
            pricing_option_id: optionId,
            period_start: base,
            period_end: newEnd,
            fee_amount: fee,
          },
          selections,
          collection: {
            amount: collected,
            method,
            paid_at: new Date().toISOString(),
          },
          idempotency_key: idempotencyKey,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Checkout failed');

      toast.success(
        isConvert ? 'Trial converted to member' : 'Membership renewed'
      );
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to renew'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {isConvert ? 'Convert trial to member' : 'Renew membership'}
          </DialogTitle>
          <DialogDescription>
            {isConvert
              ? 'Start this trial on a paid plan and record the first payment.'
              : "Extend this member's plan and record the renewal."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!isConvert && outstandingBalance > 0 && (
            <p className="text-amber-foreground rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              {fmt.money(outstandingBalance)} is still outstanding from existing
              invoices. Renewing opens a separate next invoice; this balance
              will remain due.
            </p>
          )}

          <PlanOptionPicker
            idPrefix="rn"
            plans={plans}
            planId={planId}
            optionId={optionId}
            onChange={(sel) => {
              setPlanId(sel.planId);
              setOptionId(sel.optionId);
            }}
          />

          {newEnd && (
            <div className="border-border bg-muted/40 rounded-lg border px-3 py-2 text-sm">
              <span className="text-muted-foreground">New expiry: </span>
              <span className="text-foreground font-medium">
                {fmt.date(newEnd)}
              </span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rn-fee" className="text-muted-foreground">
              Fee
            </Label>
            <Input
              id="rn-fee"
              type="number"
              min={0}
              value={feeAmount}
              onChange={(e) => setFeeAmount(e.target.value)}
            />
          </div>

          <ProductsServicesPicker
            value={selections}
            onChange={setSelections}
            membershipEnd={newEnd}
            defaultStartDate={base}
          />

          <div className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm font-medium">
            <span>Combined invoice</span>
            <span className="tabular-nums">
              {fmt.money(Number(feeAmount || 0) + addOnTotal)}
            </span>
          </div>

          <div className="border-border bg-muted/40 space-y-2 rounded-lg border p-3">
            <label className="text-foreground flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={collectPayment}
                onChange={(e) => setCollectPayment(e.target.checked)}
                className="accent-primary size-4"
              />
              {isConvert
                ? 'Record the first payment'
                : 'Record payment for this renewal'}
            </label>
            {collectPayment && (
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  min={0}
                  value={collectAmount}
                  onChange={(e) => setCollectAmount(e.target.value)}
                  placeholder="Amount"
                  className="h-8"
                />
                <Select
                  value={method}
                  onValueChange={(v) => setMethod(v as PaymentMethod)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleRenew}
            disabled={saving || !selectedPlan || !selectedOption}
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {isConvert ? 'Convert' : 'Renew'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
