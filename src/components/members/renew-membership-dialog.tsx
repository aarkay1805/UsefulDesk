'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { currencySymbol } from '@/lib/currency';
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
import { Checkbox } from '@/components/ui/checkbox';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Label } from '@/components/ui/label';
import { UserAvatar } from '@/components/ui/user-avatar';
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
  const { fmt, locale } = useLocale();
  const { plans, loading } = useMembershipPlans(true);
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
  const invoiceTotal = Number(feeAmount || 0) + addOnTotal;
  const displayName = membership.contact?.name || 'Unnamed member';
  const currentPlan =
    membership.plan ?? plans.find((plan) => plan.id === membership.plan_id);

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
      <DialogContent className="flex h-[min(96vh,900px)] max-h-[96vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(960px,calc(100vw-2rem))]">
        <DialogHeader className="border-border shrink-0 border-b p-5">
          <DialogTitle size="lg">
            {isConvert ? 'Convert trial to member' : 'Renew membership'}
          </DialogTitle>
          <DialogDescription>
            {isConvert
              ? 'Start this trial on a paid plan and record the first payment.'
              : "Extend this member's plan and record the renewal."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleRenew();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <aside className="border-border border-b p-5 md:border-r md:border-b-0">
              <div className="flex items-center gap-4">
                <UserAvatar
                  size="lg"
                  name={displayName}
                  src={membership.contact?.avatar_url}
                />
                <div className="min-w-0 space-y-0.5">
                  <p className="text-foreground truncate font-medium">
                    {displayName}
                  </p>
                  <p className="text-muted-foreground truncate text-sm">
                    {membership.contact?.phone || 'No phone number'}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Member ID{' '}
                    <span className="font-mono tabular-nums">
                      {membership.member_number}
                    </span>
                  </p>
                </div>
              </div>

              <div className="mt-7">
                <p className="text-foreground mb-3 text-sm font-semibold">
                  Current membership
                </p>
                <dl className="border-border divide-border divide-y overflow-hidden rounded-lg border">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-3 py-2.5 text-sm">
                    <dt className="text-muted-foreground">Plan</dt>
                    <dd className="text-foreground max-w-40 truncate text-right font-medium">
                      {currentPlan?.name || 'Not available'}
                    </dd>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-3 py-2.5 text-sm">
                    <dt className="text-muted-foreground">
                      {isConvert ? 'Trial ends' : 'Current expiry'}
                    </dt>
                    <dd className="text-foreground text-right font-medium">
                      {fmt.date(membership.end_date)}
                    </dd>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-3 py-2.5 text-sm">
                    <dt className="text-muted-foreground">Current fee</dt>
                    <dd className="text-foreground text-right font-medium tabular-nums">
                      {isConvert
                        ? 'No charge'
                        : fmt.money(membership.fee_amount)}
                    </dd>
                  </div>
                </dl>
              </div>

              {!isConvert && outstandingBalance > 0 && (
                <div className="text-amber-foreground mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
                  <p className="font-medium tabular-nums">
                    {fmt.money(outstandingBalance)} still due
                  </p>
                  <p className="mt-1 text-xs leading-relaxed">
                    Existing invoices stay due. This renewal creates a separate
                    invoice for the next term.
                  </p>
                </div>
              )}
            </aside>

            <div className="min-w-0 space-y-6 p-5">
              <section className="border-border space-y-4 rounded-lg border p-4">
                <p className="text-foreground text-sm font-semibold">
                  Membership details
                </p>
                <PlanOptionPicker
                  idPrefix="rn"
                  plans={plans}
                  planId={selectedPlan ? planId : ''}
                  optionId={selectedPlan ? optionId : null}
                  disabled={loading}
                  footer={
                    loading ? (
                      <p className="text-muted-foreground text-xs">
                        Loading membership plans…
                      </p>
                    ) : undefined
                  }
                  onChange={(selection) => {
                    setPlanId(selection.planId);
                    setOptionId(selection.optionId);
                  }}
                />

                {newEnd && (
                  <dl className="border-border bg-muted/40 grid gap-3 rounded-lg border px-3 py-2.5 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-muted-foreground text-xs">Starts</dt>
                      <dd className="text-foreground mt-0.5 font-medium">
                        {fmt.date(base)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">Expires</dt>
                      <dd className="text-foreground mt-0.5 font-medium">
                        {fmt.date(newEnd)}
                      </dd>
                    </div>
                  </dl>
                )}

                <div className="space-y-2">
                  <Label htmlFor="rn-fee">Fee for this term</Label>
                  <CurrencyInput
                    id="rn-fee"
                    min={0}
                    symbol={currencySymbol(locale.currency)}
                    groupLocale={locale.locale}
                    value={feeAmount}
                    onValueChange={setFeeAmount}
                    placeholder="0"
                  />
                </div>
              </section>

              <ProductsServicesPicker
                value={selections}
                onChange={setSelections}
                membershipEnd={newEnd}
                defaultStartDate={base}
              />

              <section className="border-border space-y-4 rounded-lg border p-4">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-foreground text-sm font-semibold">
                    Payment
                  </p>
                  <div className="text-right">
                    <p className="text-muted-foreground text-xs">
                      Combined invoice
                    </p>
                    <p className="text-foreground font-medium tabular-nums">
                      {fmt.money(invoiceTotal)}
                    </p>
                  </div>
                </div>

                <Label htmlFor="rn-collect-payment">
                  <Checkbox
                    id="rn-collect-payment"
                    checked={collectPayment}
                    onCheckedChange={(checked) =>
                      setCollectPayment(checked === true)
                    }
                  />
                  {isConvert
                    ? 'Record the first payment'
                    : 'Record payment for this renewal'}
                </Label>

                {collectPayment && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="rn-collect-amount">
                        Amount collected
                      </Label>
                      <CurrencyInput
                        id="rn-collect-amount"
                        min={0}
                        symbol={currencySymbol(locale.currency)}
                        groupLocale={locale.locale}
                        value={collectAmount}
                        onValueChange={setCollectAmount}
                        placeholder="0"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rn-payment-method">Payment method</Label>
                      <Select
                        value={method}
                        onValueChange={(value) =>
                          value && setMethod(value as PaymentMethod)
                        }
                      >
                        <SelectTrigger
                          id="rn-payment-method"
                          className="w-full"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYMENT_METHODS.map((paymentMethod) => (
                            <SelectItem
                              key={paymentMethod.value}
                              value={paymentMethod.value}
                            >
                              {paymentMethod.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </section>
            </div>
          </div>

          <DialogFooter className="border-border m-0 shrink-0">
            <p className="text-muted-foreground mr-auto hidden self-center text-xs sm:block">
              {isConvert ? 'Paid membership' : 'New term'} starts{' '}
              {fmt.date(base)}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving || loading || !selectedPlan || !selectedOption}
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {isConvert ? 'Convert trial to member' : 'Renew membership'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
