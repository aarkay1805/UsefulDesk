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
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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
  const [collectionTiming, setCollectionTiming] = useState<'now' | 'later'>(
    'later'
  );
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
    collectionTiming === 'now' && collectAmount.trim() === ''
      ? 'Enter an amount to collect'
      : collectionTiming === 'now' &&
          (!Number.isFinite(parsedCollectAmount) || parsedCollectAmount <= 0)
        ? 'Enter a valid amount to collect'
        : collectionTiming === 'now' && parsedCollectAmount > cashDue
          ? `Amount cannot exceed ${fmt.money(cashDue)}`
          : null;
  const validCollectAmount =
    collectionTiming === 'later' || collectAmountError
      ? 0
      : parsedCollectAmount;
  const amountRemaining = Math.max(cashDue - validCollectAmount, 0);

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
      setCollectionTiming('later');
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
          <section aria-label="Products & services" className="min-w-0">
            <ProductsServicesPicker
              value={selections}
              onChange={setSelections}
              membershipEnd={membership.end_date}
              defaultStartDate={fmt.today()}
              title="Products & services"
              description={
                mode === 'sale'
                  ? ''
                  : 'Add one or more products or services to this invoice.'
              }
              presentation={mode === 'sale' ? 'catalogue' : 'builder'}
            />
          </section>
          {selections.length > 0 ? (
            <aside aria-label="Payment" className="min-w-0 lg:sticky lg:top-0">
              <Card size="sm">
                <CardHeader>
                  <CardTitle>Payment</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2 text-sm">
                    {creditApplied > 0 ? (
                      <>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-muted-foreground">
                            Invoice total
                          </span>
                          <span className="font-medium tabular-nums">
                            {fmt.money(total)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-muted-foreground">
                            Member credit
                          </span>
                          <span className="tabular-nums">
                            −{fmt.money(creditApplied)}
                          </span>
                        </div>
                        <Separator />
                        <div className="flex items-center justify-between gap-4 font-medium">
                          <span>Due now</span>
                          <span className="tabular-nums">
                            {fmt.money(cashDue)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center justify-between gap-4 font-medium">
                        <span>
                          Total · {selectedItemCount}{' '}
                          {selectedItemCount === 1 ? 'item' : 'items'}
                        </span>
                        <span className="tabular-nums">{fmt.money(total)}</span>
                      </div>
                    )}
                  </div>

                  {cashDue > 0 ? (
                    <>
                      <RadioGroup
                        aria-label="Collection timing"
                        value={collectionTiming}
                        onValueChange={(value) => {
                          if (!value) return;
                          const timing = value as 'now' | 'later';
                          setCollectionTiming(timing);
                          setCollectAmount(
                            timing === 'now' ? String(cashDue) : ''
                          );
                        }}
                        className="grid-cols-2 gap-3"
                      >
                        <Label className="cursor-pointer">
                          <RadioGroupItem value="now" />
                          Collect now
                        </Label>
                        <Label className="cursor-pointer">
                          <RadioGroupItem value="later" />
                          Collect later
                        </Label>
                      </RadioGroup>
                      {collectionTiming === 'now' ? (
                        <>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label htmlFor="purchase-collect-amount">
                                Amount
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
                          {validCollectAmount > 0 && amountRemaining > 0 ? (
                            <p className="text-muted-foreground text-xs">
                              <span className="text-foreground font-medium tabular-nums">
                                {fmt.money(amountRemaining)}
                              </span>{' '}
                              remains due
                            </p>
                          ) : null}
                        </>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      Member credit covers this invoice. No payment is needed
                      today.
                    </p>
                  )}
                </CardContent>
                <CardFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-start">
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
                    disabled={saving || !!collectAmountError}
                  >
                    {saving ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : null}
                    {saving ? (
                      'Creating invoice…'
                    ) : (
                      <>
                        Create invoice
                        <span className="tabular-nums">
                          · {fmt.money(total)}
                        </span>
                      </>
                    )}
                  </Button>
                </CardFooter>
              </Card>
            </aside>
          ) : null}
        </div>
      </div>
      {selections.length === 0 ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>
      ) : null}
    </form>
  );
}
