'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { useLocale } from '@/hooks/use-locale';
import { currencySymbol } from '@/lib/currency';
import { getErrorMessage } from '@/lib/errors';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type {
  CheckoutMode,
  CheckoutSelection,
  Membership,
  PaymentMethod,
} from '@/types';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ProductsServicesPicker } from './products-services-picker';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'other', label: 'Other' },
];

interface ProductServiceSaleCheckoutProps {
  membership: Membership;
  onSaved: () => void;
  onCancel: () => void;
  mode?: Extract<CheckoutMode, 'sale' | 'service_renewal'>;
  initialSelections?: CheckoutSelection[];
  onSavingChange?: (saving: boolean) => void;
  className?: string;
}

export function ProductServiceSaleCheckout({
  membership,
  onSaved,
  onCancel,
  mode = 'sale',
  initialSelections = [],
  onSavingChange,
  className,
}: ProductServiceSaleCheckoutProps) {
  const { fmt, locale } = useLocale();
  const supabase = createClient();
  const [selections, setSelections] =
    useState<CheckoutSelection[]>(initialSelections);
  const [collectAmount, setCollectAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [saving, setSaving] = useState(false);
  const [creditBalance, setCreditBalance] = useState(0);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const total = selections.reduce(
    (sum, selection) =>
      sum + Number(selection.unit_amount ?? 0) * (selection.quantity ?? 1),
    0
  );
  const selectedItemCount = selections.reduce(
    (sum, selection) => sum + (selection.quantity ?? 1),
    0
  );
  const creditApplied = Math.min(creditBalance, total);
  const cashDue = Math.max(total - creditApplied, 0);
  const parsedCollectAmount = Number(collectAmount);
  const collectAmountError =
    collectAmount.trim() !== '' &&
    (!Number.isFinite(parsedCollectAmount) || parsedCollectAmount < 0)
      ? 'Enter a valid amount to collect'
      : collectAmount.trim() !== '' && parsedCollectAmount > cashDue
        ? `Amount cannot exceed ${fmt.money(cashDue)}`
        : null;
  const validCollectAmount = collectAmountError
    ? 0
    : collectAmount.trim() === ''
      ? 0
      : parsedCollectAmount;
  const amountRemaining = Math.max(cashDue - validCollectAmount, 0);
  const selectedPreset =
    cashDue === 0
      ? []
      : validCollectAmount === cashDue
        ? ['full']
        : validCollectAmount === 0
          ? ['due']
          : [];

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('member_credit_balances')
        .select('balance')
        .eq('membership_id', membership.id);
      if (!cancelled) {
        setCreditBalance(
          (data ?? []).reduce(
            (sum, entry) => sum + Number(entry.balance ?? 0),
            0
          )
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [membership.id, supabase]);

  async function checkout() {
    if (selections.length === 0)
      return toast.error('Add at least one product or service');
    if (collectAmountError) return toast.error(collectAmountError);
    const amount = validCollectAmount;
    setSaving(true);
    onSavingChange?.(true);
    try {
      const response = await fetch('/api/member-checkouts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode,
          contact_id: membership.contact_id,
          membership_id: membership.id,
          selections,
          collection: {
            amount,
            method,
            paid_at: new Date().toISOString(),
          },
          idempotency_key: idempotencyKey,
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        credit_applied?: number;
        balance?: number;
      };
      if (!response.ok) throw new Error(result.error || 'Checkout failed');
      const credit = Number(result.credit_applied ?? 0);
      const balance = Number(result.balance ?? 0);
      toast.success(
        balance > 0
          ? `Sale saved · ${fmt.money(balance)} remains due`
          : credit > 0
            ? `Sale saved · ${fmt.money(credit)} credit applied`
            : 'Sale paid in full'
      );
      setSelections([]);
      setCollectAmount('');
      onSaved();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Checkout failed'));
    } finally {
      setSaving(false);
      onSavingChange?.(false);
    }
  }

  return (
    <form
      className={cn(
        'flex min-h-0 w-full min-w-0 flex-1 flex-col gap-4',
        className
      )}
      onSubmit={(event) => {
        event.preventDefault();
        void checkout();
      }}
    >
      <div className="-mx-1 min-h-0 min-w-0 flex-1 overflow-y-auto px-1 py-1">
        <div
          role="group"
          aria-label="Purchase checkout"
          className="min-w-0 space-y-4 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(20rem,3fr)] lg:items-start lg:gap-5 lg:space-y-0"
        >
          <section aria-label="Invoice items" className="min-w-0">
            <ProductsServicesPicker
              value={selections}
              onChange={setSelections}
              membershipEnd={membership.end_date}
              defaultStartDate={fmt.today()}
              title="Invoice items"
              description={
                mode === 'sale'
                  ? 'Use the quantity controls to build this invoice.'
                  : 'Add one or more products or services to this invoice.'
              }
              presentation={mode === 'sale' ? 'catalogue' : 'builder'}
            />
          </section>
          <aside aria-label="Payment" className="min-w-0 lg:sticky lg:top-0">
            <Card size="sm">
              <CardHeader>
                <CardTitle>Payment</CardTitle>
                <CardDescription>
                  {selections.length > 0
                    ? `${selectedItemCount} item${selectedItemCount === 1 ? '' : 's'} selected. Choose what to collect now.`
                    : 'Your invoice summary will appear here.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {selections.length === 0 ? (
                  <div className="rounded-lg border border-dashed px-3 py-6 text-center">
                    <p className="text-sm font-medium">No items selected</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      Use + beside a product or service to add it.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-muted-foreground">
                          Invoice total
                        </span>
                        <span className="font-medium tabular-nums">
                          {fmt.money(total)}
                        </span>
                      </div>
                      {creditApplied > 0 ? (
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-muted-foreground">
                            Member credit
                          </span>
                          <span className="tabular-nums">
                            −{fmt.money(creditApplied)}
                          </span>
                        </div>
                      ) : null}
                      <Separator />
                      <div className="flex items-center justify-between gap-4 font-medium">
                        <span>Due after credit</span>
                        <span className="tabular-nums">
                          {fmt.money(cashDue)}
                        </span>
                      </div>
                    </div>

                    {cashDue > 0 ? (
                      <>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label htmlFor="purchase-collect-amount">
                              Collect now
                            </Label>
                            <CurrencyInput
                              id="purchase-collect-amount"
                              symbol={currencySymbol(locale.currency)}
                              groupLocale={locale.locale}
                              value={collectAmount}
                              onValueChange={setCollectAmount}
                              placeholder="0"
                              aria-invalid={!!collectAmountError}
                              aria-describedby={
                                collectAmountError
                                  ? 'purchase-collect-amount-error'
                                  : undefined
                              }
                            />
                            {collectAmountError ? (
                              <p
                                id="purchase-collect-amount-error"
                                className="text-destructive text-xs"
                                role="alert"
                              >
                                {collectAmountError}
                              </p>
                            ) : null}
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="purchase-payment-method">
                              Payment method
                            </Label>
                            <Select
                              value={method}
                              disabled={validCollectAmount <= 0}
                              onValueChange={(value) =>
                                value && setMethod(value as PaymentMethod)
                              }
                            >
                              <SelectTrigger
                                id="purchase-payment-method"
                                className="w-full"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {METHODS.map((item) => (
                                  <SelectItem
                                    key={item.value}
                                    value={item.value}
                                  >
                                    {item.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <ChipGroup
                          selectionMode="single"
                          value={selectedPreset}
                          onValueChange={(values) => {
                            if (values[0] === 'full') {
                              setCollectAmount(String(cashDue));
                            }
                            if (values[0] === 'due') setCollectAmount('');
                          }}
                        >
                          <Chip value="full">
                            Full {fmt.moneyShort(cashDue)}
                          </Chip>
                          <Chip value="due">Leave due</Chip>
                        </ChipGroup>
                        <p className="text-muted-foreground text-xs">
                          {amountRemaining > 0 ? (
                            <>
                              Remaining after this collection:{' '}
                              <span className="text-foreground font-medium tabular-nums">
                                {fmt.money(amountRemaining)}
                              </span>
                            </>
                          ) : (
                            'This collection settles the invoice.'
                          )}
                        </p>
                      </>
                    ) : (
                      <p className="text-muted-foreground text-sm">
                        Member credit covers this invoice. No payment is needed
                        today.
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={saving || selections.length === 0 || !!collectAmountError}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          {saving ? (
            'Creating invoice…'
          ) : (
            <>
              Create invoice
              {total > 0 ? (
                <span className="tabular-nums">· {fmt.money(total)}</span>
              ) : null}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
